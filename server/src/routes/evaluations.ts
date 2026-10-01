import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  assessmentRubrics,
  auditLogs,
  evaluationItems,
  evaluations,
  observationRounds,
  pupils,
  rubricCriteria,
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
import { broadcastToClass } from '../ws/live-sync.js';

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
    if (!ALLOWED_RATINGS.has(defaultRating)) {
      return badRequest(reply, 'Unbekannter Standardwert.');
    }

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRate) {
      return reply.status(403).send({
        error: 'Sie unterrichten in dieser Klasse kein Hauptfach und dürfen hier nicht bewerten.',
      });
    }

    const round = await getOpenRound();
    if (!round) return badRequest(reply, 'Kein aktiver Bewertungszeitraum');

    const [rubric] = await db
      .select()
      .from(assessmentRubrics)
      .where(eq(assessmentRubrics.isDefault, true))
      .limit(1);
    if (!rubric) return badRequest(reply, 'Kein Bewertungsraster gefunden.');

    const criteria = await db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubric.id));

    const targets = criteria.flatMap((c) => {
      const items = Array.isArray(c.items) ? (c.items as Array<{ key?: string }>) : [];
      return items
        .filter((i) => i?.key)
        .map((i) => ({ criterionId: c.id, itemKey: i.key! }));
    });

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
            subjectCode,
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
        payload: { subjectCode, defaultRating, items: touched },
      });
    });

    broadcastToClass(classId, {
      type: 'BATCH_DEFAULTS_APPLIED',
      subjectCode,
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

    const { pupilId, classId, subjectCode, proposedStatus, nextStep, comment } =
      (request.body ?? {}) as {
        pupilId?: number;
        classId?: number;
        subjectCode?: string;
        proposedStatus?: string;
        nextStep?: string;
        comment?: string;
      };

    if (!pupilId || !classId || !subjectCode) {
      return badRequest(reply, 'pupilId, classId und subjectCode sind erforderlich.');
    }
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

    const [evaluation] = await db
      .insert(evaluations)
      .values({
        roundId: round.id,
        pupilId,
        classId,
        subjectCode,
        teacherId: user.teacherId ?? 0,
        proposedStatus: proposedStatus ?? null,
        nextStep: nextStep ?? null,
        comment: comment ?? null,
      })
      .onConflictDoUpdate({
        target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
        set: {
          proposedStatus: proposedStatus !== undefined ? proposedStatus : null,
          nextStep: nextStep !== undefined ? nextStep : null,
          comment: comment !== undefined ? comment : null,
          updatedAt: new Date(),
        },
      })
      .returning();

    broadcastToClass(classId, {
      type: 'STATUS_UPDATED',
      pupilId,
      subjectCode,
      proposedStatus: evaluation.proposedStatus,
      nextStep: evaluation.nextStep,
      comment: evaluation.comment,
    });

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

    const { pupilId, classId, subjectCode = 'SD', proposedStatus, nextStep, comment } =
      (request.body ?? {}) as {
        pupilId?: number;
        classId?: number;
        subjectCode?: string;
        proposedStatus?: string;
        nextStep?: string;
        comment?: string;
      };

    if (!pupilId || !classId) return badRequest(reply, 'pupilId und classId sind erforderlich.');
    if (!proposedStatus || !isRank(proposedStatus)) {
      return badRequest(reply, 'Ein gültiger proposedStatus ist erforderlich.');
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

    const [evaluation] = await db
      .insert(evaluations)
      .values({
        roundId: round.id,
        pupilId,
        classId,
        subjectCode,
        teacherId: user.teacherId ?? 0,
        proposedStatus,
        nextStep: nextStep ?? null,
        comment: comment ?? null,
        isSubmitted: true,
        submittedAt: new Date(),
        submittedByTeacherId: user.teacherId ?? null,
      })
      .onConflictDoUpdate({
        target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
        set: {
          isSubmitted: true,
          submittedAt: new Date(),
          submittedByTeacherId: user.teacherId ?? null,
          proposedStatus,
          nextStep: nextStep !== undefined ? nextStep : null,
          comment: comment !== undefined ? comment : null,
          updatedAt: new Date(),
        },
      })
      .returning();

    await db.insert(auditLogs).values({
      actorId: user.teacherId ?? null,
      action: 'PUPIL_RANKING_SUBMITTED',
      entity: 'pupil',
      entityId: String(pupilId),
      payload: { classId, subjectCode, proposedStatus },
    });

    broadcastToClass(classId, {
      type: 'PUPIL_RANKING_SUBMITTED',
      pupilId,
      classId,
      subjectCode,
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

    const { pupilId, classId, subjectCode = 'SD' } = (request.body ?? {}) as {
      pupilId?: number;
      classId?: number;
      subjectCode?: string;
    };
    if (!pupilId || !classId) return badRequest(reply, 'pupilId und classId sind erforderlich.');

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
          eq(evaluations.subjectCode, subjectCode),
        ),
      )
      .returning();

    if (!evaluation) return reply.status(404).send({ error: 'Keine Einreichung gefunden.' });

    await db.insert(auditLogs).values({
      actorId: user.teacherId ?? null,
      action: 'PUPIL_RANKING_REOPENED',
      entity: 'pupil',
      entityId: String(pupilId),
      payload: { classId, subjectCode },
    });

    broadcastToClass(classId, { type: 'PUPIL_RANKING_REOPENED', pupilId, subjectCode });

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

    const { pupilId, classId, subjectCode = 'SD', items } = (request.body ?? {}) as {
      pupilId?: number;
      classId?: number;
      subjectCode?: string;
      items?: Array<{ criterionId: string; itemKey: string; rating: string }>;
    };

    if (!pupilId || !classId) return badRequest(reply, 'pupilId und classId sind erforderlich.');
    if (!Array.isArray(items) || items.length === 0) {
      return badRequest(reply, 'Es wurden keine Bewertungen übermittelt.');
    }
    if (items.length > 200) return badRequest(reply, 'Zu viele Bewertungen auf einmal.');

    for (const it of items) {
      if (!it?.itemKey || !ALLOWED_RATINGS.has(it.rating)) {
        return badRequest(reply, 'Unbekanntes Beobachtungsmerkmal oder ungültiger Bewertungswert.');
      }
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

    const updatedItems = await db.transaction(async (tx) => {
      const [evaluation] = await tx
        .insert(evaluations)
        .values({
          roundId: round.id,
          pupilId,
          classId,
          subjectCode,
          teacherId: user.teacherId ?? 0,
        })
        .onConflictDoUpdate({
          target: [evaluations.roundId, evaluations.pupilId, evaluations.classId, evaluations.subjectCode],
          set: { updatedAt: new Date() },
        })
        .returning();

      const out: Array<typeof evaluationItems.$inferSelect> = [];

      for (const it of items) {
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
      items: updatedItems,
    });

    return reply.send({ success: true, items: updatedItems });
  });
};

const ALLOWED_RATINGS = new Set(['crown', 'smile', 'strain', 'sad', 'restart', '+', '++', '-', 'o', 'n.b.', '']);

/** Exported for tests. */
export { getOpenRound, ALLOWED_RATINGS };