import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, or, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  auditLogs,
  evaluationItems,
  evaluations,
  observationRounds,
  pupils,
} from '../db/schema.js';
import { config } from '../config.js';
import {
  assertPasswordCurrent,
  badRequest,
  findPupilInClass,
  getClassAccess,
  requireAuth,
} from '../lib/guards.js';
import { isRank } from '../lib/ranking.js';
import { isValidRating, loadRubricIndex, validateBatchItems } from '../lib/rubric.js';
import { normalizeSubject } from '../utils/subject.js';
import { broadcastToClass } from '../ws/live-sync.js';

/**
 * Ceiling on the number of ratings one batch request may carry.
 *
 * The real raster has 18 items, so this is far above any legitimate UI write. It
 * exists to bound the work one request can ask for, not as the integrity check —
 * that is the rubric lookup inside `validateBatchItems`.
 */
const MAX_BATCH_ITEMS = 200;

/**
 * Deterministically pick the open observation round.
 *
 * The old code used `.where(isLocked = false).limit(1)` with no ORDER BY, so which
 * round a write landed in was undefined whenever more than one round existed.
 */
async function getOpenRound() {
  const [round] = await db
    .select()
    .from(observationRounds)
    .where(eq(observationRounds.isLocked, false))
    .orderBy(desc(observationRounds.createdAt))
    .limit(1);
  return round ?? null;
}

function deadlinePassed(): boolean {
  return new Date() > config.submissionDeadline;
}

/**
 * Does this `/status` write have to reach the rest of the class?
 *
 * A comment is the one field that is *not* rendered live: it is the per-pupil
 * justification typed into the grid's own textarea, and a co-teacher's screen shows
 * nothing derived from it. The conference comment autosave writes one subject at a
 * time, so a single Gesamt-mode blur is N `/status` calls, and each one used to
 * broadcast `STATUS_UPDATED` - which every connected client answers with a full
 * `loadClassData` (`App.tsx`). That made one pupil's new justification cost N
 * class-wide refetches for every co-teacher, on the hottest shared surface in the
 * app, and this branch is what introduced that traffic. Nothing is lost by staying
 * quiet, so a comment-only write stays local; the database write is unchanged.
 *
 * A write carrying a rank or a next step is a real status change and still
 * broadcasts. An explicit `null` counts: clearing a rank is a change.
 */
export function shouldBroadcastStatusUpdate(payload: {
  proposedStatus?: string | null;
  nextStep?: string | null;
}): boolean {
  return payload.proposedStatus !== undefined || payload.nextStep !== undefined;
}

export const evaluationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/evaluations/batch-default — set a default rating for a whole class.
   *
   * The previous implementation only broadcast a WebSocket message and returned
   * success — it never wrote anything, so the UI reported "Standardwert angewendet"
   * while nothing was saved. It is now a real, transactional bulk write.
   */
  fastify.post('/batch-default', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;
    if (deadlinePassed()) return badRequest(reply, 'Die Abgabefrist ist abgelaufen.');

    const { classId, subjectCode, defaultRating = '+' } = (request.body ?? {}) as {
      classId?: number;
      subjectCode?: string;
      defaultRating?: string;
    };
    if (!classId || !subjectCode) {
      return badRequest(reply, 'classId und subjectCode sind erforderlich.');
    }
    const canonicalSubject = normalizeSubject(subjectCode).code;

    // Authorization first: a caller without `canRate` must get a 403, not a 400
    // about a rubric item key, and must not make the server read the rubric on
    // their behalf.
    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({
        error: 'Sie sind in dieser Klasse nicht als Lehrkraft eingeteilt.',
      });
    }

    // The rating allowlist lives in lib/rubric.ts so this route and the WebSocket
    // path cannot drift apart. `defaultRating` is a rating, not an item key, so it
    // is checked against the allowlist only.
    const rubricIndex = await loadRubricIndex();
    if (!isValidRating(rubricIndex, defaultRating)) {
      return badRequest(reply, 'Unbekannter Standardwert.');
    }

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Bewertungszeitraum');

    // The write targets are the index's own entries, not a second fold of the same
    // criteria. The inline version re-queried `rubric_criteria` and re-derived the
    // `itemKey`/`criterionId` pairing with its own filter, which disagreed with
    // `buildRubricIndex` on a blank key: `filter((i) => i?.key)` dropped it while the
    // index keeps every string key. Reading the index keeps one definition of "this
    // item key belongs to this criterion".
    //
    // The blank key is still filtered out here, deliberately: the index *records* it
    // (that is what it is for) and `validateBatchItems` refuses to write it, so this
    // route must not become the one path that does.
    const targets = [...rubricIndex.keyToCriterion]
      .filter(([itemKey]) => itemKey !== '')
      .map(([itemKey, criterionId]) => ({ criterionId, itemKey }));

    // A default rubric with no usable items is a broken install, not a no-op.
    if (targets.length === 0) return badRequest(reply, 'Kein Bewertungsraster gefunden.');

    const classPupils = await db
      .select({ id: pupils.id })
      .from(pupils)
      .where(and(eq(pupils.classId, classId), eq(pupils.isArchived, false)));

    if (classPupils.length === 0) return badRequest(reply, 'Diese Klasse hat keine aktiven Schüler.');

    let touched = 0;

    // One transaction for the whole class so a failure cannot leave half the roster
    // filled. The previous per-item select-then-upsert loop had neither.
    await db.transaction(async (tx) => {
      for (const pupil of classPupils) {
        const [evaluation] = await tx
          .insert(evaluations)
          .values({
            roundId: round.id,
            pupilId: pupil.id,
            classId,
            subjectCode: canonicalSubject,
            teacherId: user.teacherId ?? 0,
          })
          .onConflictDoUpdate({
            target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
            set: { updatedAt: new Date() },
          })
          .returning();

        for (const target of targets) {
          await tx
            .insert(evaluationItems)
            .values({
              evaluationId: evaluation.id,
              criterionId: target.criterionId,
              itemKey: target.itemKey,
              rating: defaultRating,
              version: 1,
              updatedByTeacherId: user.teacherId ?? null,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [evaluationItems.evaluationId, evaluationItems.itemKey],
              set: {
                rating: defaultRating,
                version: sql`${evaluationItems.version} + 1`,
                updatedByTeacherId: user.teacherId ?? null,
                updatedAt: new Date(),
              },
            });
          touched++;
        }
      }

      await tx.insert(auditLogs).values({
        actorId: user.teacherId ?? null,
        action: 'BATCH_DEFAULT_APPLIED',
        entity: 'class',
        entityId: String(classId),
        payload: { subjectCode: canonicalSubject, defaultRating, items: touched },
      });
    });

    broadcastToClass(classId, {
      type: 'BATCH_DEFAULTS_APPLIED',
      subjectCode: canonicalSubject,
      defaultRating,
      appliedBy: user.teacherId ?? null,
    });

    return reply.send({
      success: true,
      message: `Standardwert '${defaultRating}' auf ${touched} Merkmale angewendet.`,
      pupils: classPupils.length,
      items: touched,
    });
  });

  /** POST /api/evaluations/status — overall proposed rank, next step and comment. */
  fastify.post('/status', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { pupilId, classId, subjectCode = 'D', proposedStatus, nextStep, comment } =
      (request.body ?? {}) as {
        pupilId?: number;
        classId?: number;
        subjectCode?: string;
        proposedStatus?: string;
        nextStep?: string;
        comment?: string;
      };

    if (!pupilId || !classId) {
      return badRequest(reply, 'pupilId und classId sind erforderlich.');
    }
    const canonicalSubject = normalizeSubject(subjectCode).code;
    if (proposedStatus !== undefined && proposedStatus !== null && !isRank(proposedStatus)) {
      return badRequest(reply, 'proposedStatus muss ein gültiger Rang sein.');
    }

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Zeitraum');

    const statusUpdateSet: Record<string, any> = {
      updatedAt: new Date(),
    };
    if (proposedStatus !== undefined) statusUpdateSet.proposedStatus = proposedStatus;
    if (nextStep !== undefined) statusUpdateSet.nextStep = nextStep;
    if (comment !== undefined) statusUpdateSet.comment = comment;

    const [evaluation] = await db
      .insert(evaluations)
      .values({
        roundId: round.id,
        pupilId,
        classId,
        subjectCode: canonicalSubject,
        teacherId: user.teacherId ?? 0,
        proposedStatus: proposedStatus ?? null,
        nextStep: nextStep ?? null,
        comment: comment ?? null,
      })
      .onConflictDoUpdate({
        target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
        set: statusUpdateSet,
      })
      .returning();

    if (shouldBroadcastStatusUpdate({ proposedStatus, nextStep })) {
      broadcastToClass(classId, {
        type: 'STATUS_UPDATED',
        pupilId,
        classId,
        subjectCode: canonicalSubject,
        proposedStatus: evaluation.proposedStatus,
        nextStep: evaluation.nextStep,
        comment: evaluation.comment,
      });
    }

    return reply.send(evaluation);
  });

  /** POST /api/evaluations/submit — final ranking for a pupil. */
  fastify.post('/submit', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;
    if (deadlinePassed()) {
      return badRequest(
        reply,
        `Abgabefrist (${config.submissionDeadline.toISOString().slice(0, 10)}) ist abgelaufen.`,
      );
    }

    const { pupilId, classId, subjectCode = 'D', proposedStatus, nextStep, comment } =
      (request.body ?? {}) as {
        pupilId?: number;
        classId?: number;
        subjectCode?: string;
        proposedStatus?: string;
        nextStep?: string;
        comment?: string;
      };

    if (!pupilId || !classId) return badRequest(reply, 'pupilId und classId sind erforderlich.');
    const canonicalSubject = normalizeSubject(subjectCode).code;
    let finalProposedStatus = proposedStatus;
    if (!finalProposedStatus || !isRank(finalProposedStatus)) {
      finalProposedStatus = 'Geselle';
    }

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Zeitraum');

    const submitUpdateSet: Record<string, any> = {
      isSubmitted: true,
      submittedAt: new Date(),
      submittedByTeacherId: user.teacherId ?? null,
      proposedStatus: finalProposedStatus,
      updatedAt: new Date(),
    };
    if (nextStep !== undefined) submitUpdateSet.nextStep = nextStep;
    if (comment !== undefined) submitUpdateSet.comment = comment;

    const [evaluation] = await db
      .insert(evaluations)
      .values({
        roundId: round.id,
        pupilId,
        classId,
        subjectCode: canonicalSubject,
        teacherId: user.teacherId ?? 0,
        proposedStatus: finalProposedStatus,
        nextStep: nextStep ?? null,
        comment: comment ?? null,
        isSubmitted: true,
        submittedAt: new Date(),
        submittedByTeacherId: user.teacherId ?? null,
      })
      .onConflictDoUpdate({
        target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
        set: submitUpdateSet,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorId: user.teacherId ?? null,
      action: 'PUPIL_RANKING_SUBMITTED',
      entity: 'pupil',
      entityId: String(pupilId),
      payload: { classId, subjectCode: canonicalSubject, proposedStatus },
    });

    broadcastToClass(classId, {
      type: 'PUPIL_RANKING_SUBMITTED',
      pupilId,
      classId,
      subjectCode: canonicalSubject,
      proposedStatus: evaluation.proposedStatus,
      submittedBy: user.teacherId ?? null,
      submittedAt: evaluation.submittedAt,
    });

    return reply.send({ success: true, evaluation });
  });

  /** POST /api/evaluations/reopen — withdraw a submission before the deadline. */
  fastify.post('/reopen', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;
    if (deadlinePassed()) {
      return badRequest(reply, `Abgabefrist (${config.submissionDeadline.toISOString().slice(0, 10)}) ist abgelaufen.`);
    }

    const { pupilId, classId, subjectCode = 'D' } = (request.body ?? {}) as {
      pupilId?: number;
      classId?: number;
      subjectCode?: string;
    };
    if (!pupilId || !classId) return badRequest(reply, 'pupilId und classId sind erforderlich.');
    const canonicalSubject = normalizeSubject(subjectCode).code;

    const access = await getClassAccess(user, classId);
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Zeitraum');

    const [evaluation] = await db
      .update(evaluations)
      .set({ isSubmitted: false, updatedAt: new Date() })
      .where(
        and(
          eq(evaluations.roundId, round.id),
          eq(evaluations.pupilId, pupilId),
          eq(evaluations.classId, classId),
          or(
            eq(evaluations.subjectCode, canonicalSubject),
            canonicalSubject === 'D' ? eq(evaluations.subjectCode, 'SD') : sql`false`,
            canonicalSubject === 'E' ? eq(evaluations.subjectCode, 'SE') : sql`false`,
            canonicalSubject === 'M' ? eq(evaluations.subjectCode, 'SM') : sql`false`,
          ),
        ),
      )
      .returning();

    if (!evaluation) return reply.status(404).send({ error: 'Keine Einreichung gefunden.' });

    await db.insert(auditLogs).values({
      actorId: user.teacherId ?? null,
      action: 'PUPIL_RANKING_REOPENED',
      entity: 'pupil',
      entityId: String(pupilId),
      payload: { classId, subjectCode: canonicalSubject },
    });

    broadcastToClass(classId, { type: 'PUPIL_RANKING_REOPENED', pupilId, subjectCode: canonicalSubject });

    return reply.send({ success: true, evaluation });
  });

  /**
   * POST /api/evaluations/batch-items — rapid matrix entry.
   *
   * Now wrapped in a transaction and using the atomic version increment, matching the
   * WebSocket path. The previous read-then-write `version: existing.version + 1` was
   * application-side and could silently lose-update against a concurrent WS write.
   */
  fastify.post('/batch-items', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;
    if (deadlinePassed()) return badRequest(reply, 'Abgabefrist ist abgelaufen.');

    const { pupilId, classId, subjectCode = 'D', items } = (request.body ?? {}) as {
      pupilId?: number;
      classId?: number;
      subjectCode?: string;
      // Deliberately untyped beyond "unknown": the body is untrusted and
      // `validateBatchItems` narrows it. A client may still send `criterionId`,
      // but it is ignored — the criterion is derived from `itemKey`.
      items?: unknown;
    };

    if (!pupilId || !classId) return badRequest(reply, 'pupilId und classId sind erforderlich.');
    const canonicalSubject = normalizeSubject(subjectCode).code;

    // Authorization before validation: a caller who may not rate in this class gets
    // a 403, not a 400 about a rubric item key, and does not make the server read
    // the rubric on their behalf.
    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }

    // Every item key is looked up in the rubric and its criterion derived
    // server-side. The client-supplied `criterionId` is ignored, so a batch of
    // fabricated keys can no longer inflate a pupil's positive rating count.
    // Rejection happens before the transaction, so a forged batch never reaches a
    // write at all.
    const rubricIndex = await loadRubricIndex();
    const validation = validateBatchItems(items, rubricIndex, MAX_BATCH_ITEMS);
    if (!validation.ok) return badRequest(reply, validation.error);

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Zeitraum');

    const updatedItems = await db.transaction(async (tx) => {
      const [evaluation] = await tx
        .insert(evaluations)
        .values({
          roundId: round.id,
          pupilId,
          classId,
          subjectCode: canonicalSubject,
          teacherId: user.teacherId ?? 0,
        })
        .onConflictDoUpdate({
          target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
          set: { updatedAt: new Date() },
        })
        .returning();

      const out: Array<typeof evaluationItems.$inferSelect> = [];

      for (const it of validation.items) {
        const [row] = await tx
          .insert(evaluationItems)
          .values({
            evaluationId: evaluation.id,
            criterionId: it.criterionId,
            itemKey: it.itemKey,
            rating: it.rating,
            version: 1,
            updatedByTeacherId: user.teacherId ?? null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [evaluationItems.evaluationId, evaluationItems.itemKey],
            set: {
              rating: it.rating,
              // `version + 1` is evaluated by Postgres, so concurrent writers
              // cannot both read the same version and overwrite each other.
              version: sql`${evaluationItems.version} + 1`,
              updatedByTeacherId: user.teacherId ?? null,
              updatedAt: new Date(),
            },
          })
          .returning();

        out.push(row);
      }

      return out;
    });

    broadcastToClass(classId, {
      type: 'BATCH_ITEMS_UPDATED',
      pupilId,
      classId,
      subjectCode: canonicalSubject,
      items: updatedItems,
    });

    return reply.send({ success: true, items: updatedItems });
  });
};

/** Exported for tests. */
export { getOpenRound };