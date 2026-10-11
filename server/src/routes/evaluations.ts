import type { FastifyPluginAsync, FastifyReply } from 'fastify';
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
  canRateSubject,
  findPupilInClass,
  getClassAccess,
  hasPersistedTeacherActor,
  MAX_POSTGRES_INTEGER,
  requireAuth,
} from '../lib/guards.js';
import { isRank, type Rank } from '../lib/ranking.js';
import { isValidRating, loadRubricIndex, VALID_RATINGS, validateBatchItems } from '../lib/rubric.js';
import { normalizeKnownSubject, normalizeSubject } from '../utils/subject.js';
import { broadcastToClass } from '../ws/live-sync.js';
import { getClassRoundLockState } from '../lib/class-round-lock.js';
import { getLatestRound } from '../lib/rounds.js';

/**
 * Ceiling on the number of ratings one batch request may carry.
 *
 * The real raster has 18 items, so this is far above any legitimate UI write. It
 * exists to bound the work one request can ask for, not as the integrity check —
 * that is the rubric lookup inside `validateBatchItems`.
 */
const MAX_BATCH_ITEMS = 200;

class BatchItemVersionConflict extends Error {
  constructor(readonly itemKey: string) {
    super(`Stale rating version for ${itemKey}`);
    this.name = 'BatchItemVersionConflict';
  }
}

/**
 * Deterministically pick the open observation round.
 *
 * Checks the latest round by creation date. If that round is locked or does not exist,
 * returns null. Never falls back to an older unlocked round.
 */
async function getOpenRound() {
  const round = await getLatestRound();
  if (!round || round.isLocked) return null;
  return round;
}

/**
 * Sends HTTP 423 if the class conference is locked for the given observation round.
 */
export async function rejectIfClassRoundLocked(
  reply: FastifyReply,
  roundId: string,
  classId: number,
): Promise<boolean> {
  const isLocked = await getClassRoundLockState(roundId, classId);
  if (isLocked) {
    reply.status(423).send({
      error: 'Die Klassenkonferenz ist gesperrt. Bewertungen können nicht mehr geändert werden.',
      code: 'CLASS_CONFERENCE_LOCKED',
    });
    return true;
  }
  return false;
}

function deadlinePassed(): boolean {
  return new Date() > config.submissionDeadline;
}

/** evaluation.teacher_id is required; never invent a sentinel actor FK. */
export function requireEvaluationActor(
  teacherId: number | null | undefined,
  reply: FastifyReply,
): number | null {
  if (hasPersistedTeacherActor(teacherId)) return teacherId;
  reply.status(503).send({
    error: 'Bewertungen sind nicht verfügbar, weil kein Lehrkraftkonto zur Erfassung zugeordnet ist.',
    code: 'SYSTEM_ACTOR_NOT_CONFIGURED',
  });
  return null;
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

/**
 * Resolve the rank a submission stores.
 *
 * "Not chosen" is legitimate (the grid allows submitting without picking a rank) and
 * becomes the neutral `Geselle`. A value that *is* present but is not a rank is a bug
 * in the caller — an older client enum, a typo, a truncated string — and the previous
 * code turned it into `Geselle` as well, so a pupil could silently be recorded one rank
 * below what the teacher submitted. Those are rejected instead of being reinterpreted.
 */
export function resolveProposedRank(
  proposedStatus: string | null | undefined,
): { ok: true; rank: Rank } | { ok: false } {
  if (proposedStatus === undefined || proposedStatus === null || proposedStatus === '') {
    return { ok: true, rank: 'Geselle' };
  }
  if (isRank(proposedStatus)) return { ok: true, rank: proposedStatus };
  return { ok: false };
}

export const evaluationRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/evaluations/batch-default — set a default rating for a whole class.
   *
   * The previous implementation only broadcast a WebSocket message and returned
   * success — it never wrote anything, so the UI reported "Standardwert angewendet"
   * while nothing was saved. It is now a real, transactional bulk write.
   * This is an explicit force-overwrite operation: the caller must acknowledge that
   * existing ratings in the selected class/subject will be replaced.
   */
  fastify.post(
    '/batch-default',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['classId', 'subjectCode', 'forceOverwrite'],
          additionalProperties: false,
          properties: {
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            subjectCode: { type: 'string', minLength: 1, maxLength: 32 },
            defaultRating: { enum: [...VALID_RATINGS] },
            forceOverwrite: { type: 'boolean', const: true },
          },
        },
      },
    },
    async (request, reply) => {
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
    const known = normalizeKnownSubject(subjectCode);
    if (!known) {
      return badRequest(reply, 'Ungültiges Unterrichtsfach.');
    }
    const canonicalSubject = known.code;

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
    if (!canRateSubject(access, canonicalSubject)) {
      return reply.status(403).send({
        error: 'Sie sind für dieses Fach in dieser Klasse nicht eingeteilt.',
      });
    }
    const teacherId = requireEvaluationActor(user.teacherId, reply);
    if (teacherId === null) return;

    // The rating allowlist lives in lib/rubric.ts so this route and the WebSocket
    // path cannot drift apart. `defaultRating` is a rating, not an item key, so it
    // is checked against the allowlist only.
    const rubricIndex = await loadRubricIndex();
    if (!isValidRating(rubricIndex, defaultRating)) {
      return badRequest(reply, 'Unbekannter Standardwert.');
    }

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Bewertungszeitraum');
    if (await rejectIfClassRoundLocked(reply, round.id, classId)) return;

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

    // Two statements for the whole class instead of one per pupil per item. The previous
    // nested loop issued ~540 sequential round trips (30 pupils x 18 rubric items) while
    // holding one transaction open, work PostgreSQL does in a single multi-row upsert.
    await db.transaction(async (tx) => {
      const rosterRows = await tx
        .insert(evaluations)
        .values(
          classPupils.map((pupil) => ({
            roundId: round.id,
            pupilId: pupil.id,
            classId,
            subjectCode: canonicalSubject,
            teacherId,
          })),
        )
        .onConflictDoUpdate({
          target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
          set: { updatedAt: new Date() },
        })
        .returning({ id: evaluations.id, pupilId: evaluations.pupilId });

      // `returning()` promises the rows, not their order, so the id is matched by pupil.
      const evaluationIdByPupil = new Map(rosterRows.map((row) => [row.pupilId, row.id]));

      const itemRows = classPupils.flatMap((pupil) => {
        const evaluationId = evaluationIdByPupil.get(pupil.id);
        if (!evaluationId) return [];
        return targets.map((target) => ({
          evaluationId,
          criterionId: target.criterionId,
          itemKey: target.itemKey,
          rating: defaultRating,
          version: 1,
          updatedByTeacherId: teacherId,
          updatedAt: new Date(),
        }));
      });

      if (itemRows.length > 0) {
        await tx
          .insert(evaluationItems)
          .values(itemRows)
          .onConflictDoUpdate({
            target: [evaluationItems.evaluationId, evaluationItems.itemKey],
            set: {
              rating: defaultRating,
              version: sql`${evaluationItems.version} + 1`,
              updatedByTeacherId: teacherId,
              updatedAt: new Date(),
            },
          });
      }
      touched = itemRows.length;

      await tx.insert(auditLogs).values({
        actorId: teacherId,
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
      appliedBy: teacherId,
    });

    return reply.send({
      success: true,
      message: `Standardwert '${defaultRating}' auf ${touched} Merkmale angewendet.`,
      pupils: classPupils.length,
      items: touched,
    });
  });

  /** POST /api/evaluations/status — overall proposed rank, next step and comment. */
  fastify.post(
    '/status',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['pupilId', 'classId'],
          additionalProperties: false,
          properties: {
            pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            subjectCode: { type: 'string', minLength: 1, maxLength: 32 },
            proposedStatus: { type: 'string', nullable: true, maxLength: 32 },
            nextStep: { type: 'string', nullable: true, maxLength: 500 },
            comment: { type: 'string', nullable: true, maxLength: 2000 },
            overrideReason: { type: 'string', nullable: true, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
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
    const known = normalizeKnownSubject(subjectCode);
    if (!known) {
      return badRequest(reply, 'Ungültiges Unterrichtsfach.');
    }
    const canonicalSubject = known.code;
    if (proposedStatus !== undefined && proposedStatus !== null && !isRank(proposedStatus)) {
      return badRequest(reply, 'proposedStatus muss ein gültiger Rang sein.');
    }
    if (deadlinePassed() && (proposedStatus !== undefined || nextStep !== undefined)) {
      return badRequest(reply, 'Abgabefrist ist abgelaufen. Rang und nächster Schritt können nicht mehr geändert werden.');
    }
    if (deadlinePassed() && comment === undefined) {
      return badRequest(reply, 'Abgabefrist ist abgelaufen. Nachträglich sind nur Kommentaränderungen möglich.');
    }

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }
    if (!canRateSubject(access, canonicalSubject)) {
      return reply.status(403).send({ error: 'Sie dürfen dieses Fach in dieser Klasse nicht bewerten.' });
    }
    const teacherId = requireEvaluationActor(user.teacherId, reply);
    if (teacherId === null) return;

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Zeitraum');
    if (await rejectIfClassRoundLocked(reply, round.id, classId)) return;

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
        teacherId,
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
  fastify.post(
    '/submit',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['pupilId', 'classId'],
          additionalProperties: false,
          properties: {
            pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            subjectCode: { type: 'string', minLength: 1, maxLength: 32 },
            proposedStatus: { type: 'string', nullable: true, maxLength: 32 },
            nextStep: { type: 'string', nullable: true, maxLength: 500 },
            comment: { type: 'string', nullable: true, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
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
    const known = normalizeKnownSubject(subjectCode);
    if (!known) return badRequest(reply, 'Ungültiges Unterrichtsfach.');
    const canonicalSubject = known.code;
    const resolvedRank = resolveProposedRank(proposedStatus);
    if (!resolvedRank.ok) {
      return badRequest(reply, 'Ungültiger Rangvorschlag. Erlaubt sind: Lehrling, Geselle, Meister.');
    }
    const finalProposedStatus = resolvedRank.rank;

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }
    if (!canRateSubject(access, canonicalSubject)) {
      return reply.status(403).send({ error: 'Sie dürfen dieses Fach in dieser Klasse nicht bewerten.' });
    }
    const teacherId = requireEvaluationActor(user.teacherId, reply);
    if (teacherId === null) return;

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Zeitraum');
    if (await rejectIfClassRoundLocked(reply, round.id, classId)) return;

    const submitUpdateSet: Record<string, any> = {
      isSubmitted: true,
      submittedAt: new Date(),
      submittedByTeacherId: teacherId,
      proposedStatus: finalProposedStatus,
      updatedAt: new Date(),
    };
    if (nextStep !== undefined) submitUpdateSet.nextStep = nextStep;
    if (comment !== undefined) submitUpdateSet.comment = comment;

    // Submission and audit row commit together. The previous two-step write could commit
    // the ranking and then fail before writing `PUPIL_RANKING_SUBMITTED`, leaving an
    // official-record change that the audit history never saw.
    const evaluation = await db.transaction(async (tx) => {
      const [submitted] = await tx
        .insert(evaluations)
        .values({
          roundId: round.id,
          pupilId,
          classId,
          subjectCode: canonicalSubject,
          teacherId,
          proposedStatus: finalProposedStatus,
          nextStep: nextStep ?? null,
          comment: comment ?? null,
          isSubmitted: true,
          submittedAt: new Date(),
          submittedByTeacherId: teacherId,
        })
        .onConflictDoUpdate({
          target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
          set: submitUpdateSet,
        })
        .returning();

      await tx.insert(auditLogs).values({
        actorId: teacherId,
        action: 'PUPIL_RANKING_SUBMITTED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: { classId, subjectCode: canonicalSubject, proposedStatus },
      });

      return submitted;
    });

    broadcastToClass(classId, {
      type: 'PUPIL_RANKING_SUBMITTED',
      pupilId,
      classId,
      subjectCode: canonicalSubject,
      proposedStatus: evaluation.proposedStatus,
      submittedBy: teacherId,
      submittedAt: evaluation.submittedAt,
    });

    return reply.send({ success: true, evaluation });
  });

  /** POST /api/evaluations/reopen — withdraw a submission before the deadline. */
  fastify.post(
    '/reopen',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['pupilId', 'classId'],
          additionalProperties: false,
          properties: {
            pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            subjectCode: { type: 'string', minLength: 1, maxLength: 32 },
          },
        },
      },
    },
    async (request, reply) => {
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
    const known = normalizeKnownSubject(subjectCode);
    if (!known) return badRequest(reply, 'Ungültiges Unterrichtsfach.');
    const canonicalSubject = known.code;

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }
    if (!canRateSubject(access, canonicalSubject)) {
      return reply.status(403).send({ error: 'Sie dürfen dieses Fach in dieser Klasse nicht bewerten.' });
    }

    // Reopening withdraws a submitted rating, so it is a rating write like every other
    // one here: without a persisted teacher actor there is nobody to attribute it to.
    const teacherId = requireEvaluationActor(user.teacherId, reply);
    if (teacherId === null) return;

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Zeitraum');
    if (await rejectIfClassRoundLocked(reply, round.id, classId)) return;

    // Withdrawal and its audit row commit together, and the audit row is only written when
    // a submission was actually withdrawn - the previous order could record a reopen for a
    // pupil who had never submitted.
    const evaluation = await db.transaction(async (tx) => {
      const [reopened] = await tx
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

      if (!reopened) return null;

      await tx.insert(auditLogs).values({
        actorId: teacherId,
        action: 'PUPIL_RANKING_REOPENED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: { classId, subjectCode: canonicalSubject },
      });

      return reopened;
    });

    if (!evaluation) return reply.status(404).send({ error: 'Keine Einreichung gefunden.' });

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
  fastify.post(
    '/batch-items',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['pupilId', 'classId', 'items'],
          additionalProperties: false,
          properties: {
            pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            subjectCode: { type: 'string', minLength: 1, maxLength: 32 },
            items: {
              type: 'array',
               maxItems: MAX_BATCH_ITEMS,
              items: {
                type: 'object',
                 required: ['itemKey', 'rating', 'version'],
                additionalProperties: false,
                properties: {
                  itemKey: { type: 'string', minLength: 1, maxLength: 64 },
                  rating: { enum: [...VALID_RATINGS] },
                  version: { type: 'integer', minimum: 0, maximum: MAX_POSTGRES_INTEGER },
                  criterionId: { type: 'string', maxLength: 36 },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
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
    const known = normalizeKnownSubject(subjectCode);
    if (!known) return badRequest(reply, 'Ungültiges Unterrichtsfach.');
    const canonicalSubject = known.code;

    // Authorization before validation: a caller who may not rate in this class gets
    // a 403, not a 400 about a rubric item key, and does not make the server read
    // the rubric on their behalf.
    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({ error: 'Sie dürfen in dieser Klasse nicht bewerten.' });
    }
    if (!canRateSubject(access, canonicalSubject)) {
      return reply.status(403).send({ error: 'Sie dürfen dieses Fach in dieser Klasse nicht bewerten.' });
    }
    const teacherId = requireEvaluationActor(user.teacherId, reply);
    if (teacherId === null) return;

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
    if (await rejectIfClassRoundLocked(reply, round.id, classId)) return;

    let updatedItems: Array<typeof evaluationItems.$inferSelect>;
    try {
      updatedItems = await db.transaction(async (tx) => {
        const [evaluation] = await tx
          .insert(evaluations)
          .values({
            roundId: round.id,
            pupilId,
            classId,
            subjectCode: canonicalSubject,
            teacherId,
          })
          .onConflictDoUpdate({
            target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
            set: { updatedAt: new Date() },
          })
          .returning();

        const out: Array<typeof evaluationItems.$inferSelect> = [];

        for (const it of validation.items) {
          if (it.version !== undefined && it.version > 0) {
            const [existingItem] = await tx
              .select({ id: evaluationItems.id })
              .from(evaluationItems)
              .where(and(
                eq(evaluationItems.evaluationId, evaluation.id),
                eq(evaluationItems.itemKey, it.itemKey),
              ))
              .limit(1);
            if (!existingItem) throw new BatchItemVersionConflict(it.itemKey);
          }

          const [row] = await tx
            .insert(evaluationItems)
            .values({
              evaluationId: evaluation.id,
              criterionId: it.criterionId,
              itemKey: it.itemKey,
              rating: it.rating,
              version: 1,
              updatedByTeacherId: teacherId,
              updatedAt: new Date(),
            })
            .onConflictDoUpdate({
              target: [evaluationItems.evaluationId, evaluationItems.itemKey],
              set: {
                rating: it.rating,
                // `version + 1` is evaluated by Postgres, so concurrent writers
                // cannot both read the same version and overwrite each other.
                version: sql`${evaluationItems.version} + 1`,
                updatedByTeacherId: teacherId,
                updatedAt: new Date(),
              },
                setWhere: eq(evaluationItems.version, it.version),
            })
            .returning();

          if (!row) {
            if (it.version !== undefined) throw new BatchItemVersionConflict(it.itemKey);
            throw new Error('Batch item upsert did not return a row.');
          }
          out.push(row);
        }

        return out;
      });
    } catch (error) {
      if (!(error instanceof BatchItemVersionConflict)) throw error;

      const [currentEvaluation] = await db
        .select({ id: evaluations.id })
        .from(evaluations)
        .where(and(
          eq(evaluations.roundId, round.id),
          eq(evaluations.pupilId, pupilId),
          eq(evaluations.classId, classId),
          eq(evaluations.subjectCode, canonicalSubject),
        ))
        .limit(1);
      const [current] = currentEvaluation
        ? await db
            .select()
            .from(evaluationItems)
            .where(and(
              eq(evaluationItems.evaluationId, currentEvaluation.id),
              eq(evaluationItems.itemKey, error.itemKey),
            ))
            .limit(1)
        : [];

      return reply.status(409).send({
        error: 'Bewertung wurde zwischenzeitlich geändert.',
        code: 'CONFLICT',
        evaluationId: currentEvaluation?.id,
        pupilId,
        classId,
        subjectCode: canonicalSubject,
        itemKey: error.itemKey,
        currentRating: current?.rating,
        currentVersion: current?.version,
        updatedAt: current?.updatedAt,
      });
    }

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
