import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import { auditLogs, behaviorCards, timeoutEscalations, timeoutIncidents } from '../db/schema.js';
import { config } from '../config.js';
import {
  assertPasswordCurrent,
  badRequest,
  findPupilInClass,
  forbid,
  getClassAccess,
  getGlobalAccess,
  getPupil,
  getTeacher,
  isHeadmasterUser,
  MAX_POSTGRES_INTEGER,
  parseIdParam,
  requireAuth,
  safeTeacherId,
  type Identity,
} from '../lib/guards.js';
import { broadcastToClass } from '../ws/live-sync.js';

/** Pseudo-class id for the Lernwerkstatt supervision view. */
const LW_CLASS_ID = 999;

/** True for the administrator and the headmasters (SLC, MED). */
async function isSchoolLeader(user: Identity): Promise<boolean> {
  if (user.role === 'admin') return true;
  if (!user.teacherId) return false;
  return isHeadmasterUser(user, await getTeacher(user.teacherId));
}

export const timeoutRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/timeouts — send a pupil to Time-Out and file the linked red card.
   *
   * Writes happen in one transaction so a pupil can never end up with a red card but
   * no timeout record (the previous two-step write could fail halfway).
   */
  fastify.post(
    '/',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['pupilId', 'classId', 'taskAssignment'],
          additionalProperties: false,
          properties: {
            pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            taskAssignment: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { pupilId, classId, taskAssignment } = (request.body ?? {}) as {
      pupilId?: number;
      classId?: number;
      taskAssignment?: string;
    };

    if (!pupilId || !classId || !taskAssignment?.trim()) {
      return badRequest(
        reply,
        'Schüler*in, Klasse und ein konkreter Arbeitsauftrag für die Lernwerkstatt sind zwingend erforderlich.',
      );
    }
    const cleanTask = taskAssignment.trim();
    if (cleanTask.length > 2000) return badRequest(reply, 'Der Arbeitsauftrag ist zu lang.');

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRecord) {
      return reply.status(403).send({
        error: 'Sie unterrichten diese Klasse nicht und dürfen dort kein Time-Out auslösen.',
      });
    }

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    const result = await db.transaction(async (tx) => {
      const [redCard] = await tx
        .insert(behaviorCards)
        .values({
          pupilId,
          classId,
          teacherId: user.teacherId ?? 0,
          cardType: 'red',
          note: `[TIME-OUT LW] Arbeitsauftrag: ${cleanTask}`,
        })
        .returning();

      const [incident] = await tx
        .insert(timeoutIncidents)
        .values({
          pupilId,
          classId,
          sentByTeacherId: user.teacherId ?? 0,
          taskAssignment: cleanTask,
          status: 'active',
          redCardId: redCard.id,
        })
        .returning();

      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(timeoutIncidents)
        .where(eq(timeoutIncidents.pupilId, pupilId));
      const totalTimeouts = countRow?.count ?? 1;

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'TIMEOUT_ISSUED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: {
          classId,
          taskAssignment: cleanTask,
          redCardId: redCard.id,
          totalTimeouts,
          isEscalationTriggered: totalTimeouts % config.escalationStep === 0,
        },
      });

      return { redCard, incident, totalTimeouts };
    });

    const isEscalationTriggered = result.totalTimeouts % config.escalationStep === 0;

    broadcastToClass(classId, { type: 'CARD_ISSUED', card: result.redCard, alertTriggered: true });
    broadcastToClass(classId, {
      type: 'TIMEOUT_ISSUED',
      incident: result.incident,
      redCard: result.redCard,
      totalTimeouts: result.totalTimeouts,
      isEscalationTriggered,
    });
    broadcastToClass(LW_CLASS_ID, {
      type: 'TIMEOUT_ISSUED',
      incident: result.incident,
      redCard: result.redCard,
      totalTimeouts: result.totalTimeouts,
      isEscalationTriggered,
    });

    return reply.status(201).send({
      success: true,
      incident: result.incident,
      redCard: result.redCard,
      totalTimeouts: result.totalTimeouts,
      isEscalationTriggered,
    });
  });

  /**
   * GET /api/timeouts/active — live LW list.
   *
   * Open to every authenticated teacher because the LW supervisor may be any teacher
   * on duty, but the underlying data (pupil name, reason for the timeout) is
   * inherently shared. Pupil names are returned; internal notes are not.
   */
  fastify.get('/active', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (user.role === 'pupil') {
      return forbid(reply);
    }
    const rows = await getPool().query(
      `SELECT ti.id,
              ti.pupil_id,
              ti.class_id,
              ti.sent_by_teacher_id,
              ti.sent_at,
              ti.task_assignment,
              ti.status,
              ti.red_card_id,
              p.full_name AS pupil_name,
              sc.name   AS class_name,
              COALESCE(t.short_name, 'SL') AS sent_by_short,
              COALESCE(t.full_name, 'Schulleitung') AS sent_by_name
         FROM timeout_incidents ti
         JOIN pupils p         ON p.id  = ti.pupil_id
         JOIN school_classes sc ON sc.id = ti.class_id
         LEFT JOIN teachers t  ON t.id  = ti.sent_by_teacher_id
        WHERE ti.status = 'active'
        ORDER BY ti.sent_at DESC
        LIMIT 100`,
    );
    return reply.send(rows.rows);
  });

  /**
   * POST /api/timeouts/:id/resolve — LW supervisor closes the timeout.
   *
   * Any teacher may close an active timeout (that is the LW duty roster), but only
   * within a class they are responsible for, or with school-wide authority.
   */
  fastify.post(
    '/:id/resolve',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            resolutionNote: { type: 'string', nullable: true, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { id } = request.params as { id: string };
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return badRequest(reply, 'Ungültige Time-Out-ID.');

    const { resolutionNote } = (request.body ?? {}) as { resolutionNote?: string };
    const cleanNote = resolutionNote?.trim();
    if (cleanNote && cleanNote.length > 2000) return badRequest(reply, 'Der Hinweis ist zu lang.');

    const [existing] = await db.select().from(timeoutIncidents).where(eq(timeoutIncidents.id, id)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Time-Out Eintrag nicht gefunden' });
    if (existing.status !== 'active') return badRequest(reply, 'Dieser Time-Out ist bereits abgeschlossen.');

    const access = await getClassAccess(user, existing.classId);
    if (!access.canRecord) {
      return reply.status(403).send({
        error: 'Sie unterrichten diese Klasse nicht und dürfen diesen Time-Out nicht abschließen.',
      });
    }

    const [resolved] = await db
      .update(timeoutIncidents)
      .set({
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: safeTeacherId(user.teacherId),
        resolutionNote: cleanNote || 'Arbeitsauftrag in Lernwerkstatt erledigt',
      })
      .where(and(eq(timeoutIncidents.id, id), eq(timeoutIncidents.status, 'active')))
      .returning();

    if (!resolved) return badRequest(reply, 'Dieser Time-Out wurde soeben abgeschlossen.');

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'TIMEOUT_RESOLVED',
      entity: 'timeout_incident',
      entityId: id,
      payload: { pupilId: existing.pupilId, classId: existing.classId },
    });

    broadcastToClass(existing.classId, { type: 'TIMEOUT_RESOLVED', incident: resolved });
    broadcastToClass(LW_CLASS_ID, { type: 'TIMEOUT_RESOLVED', incident: resolved });

    return reply.send({ success: true, incident: resolved });
  });

  /** GET /api/timeouts/history — recent timeouts, scoped to the caller's classes. */
  fastify.get('/history', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const global = await getGlobalAccess(user);
    if (global.classIds !== null && global.classIds.length === 0) return reply.send([]);

    const rows = await getPool().query(
      `SELECT ti.id,
              ti.pupil_id,
              ti.class_id,
              ti.sent_by_teacher_id,
              ti.sent_at,
              ti.task_assignment,
              ti.status,
              ti.resolved_at,
              ti.resolved_by,
              ti.resolution_note,
              p.full_name AS pupil_name,
              sc.name   AS class_name,
              COALESCE(t.short_name, 'SL')  AS sent_by_short,
              rt.short_name AS resolved_by_short
         FROM timeout_incidents ti
         JOIN pupils p          ON p.id  = ti.pupil_id
         JOIN school_classes sc ON sc.id = ti.class_id
         LEFT JOIN teachers t  ON t.id  = ti.sent_by_teacher_id
         LEFT JOIN teachers rt ON rt.id = ti.resolved_by
        WHERE ti.sent_at >= NOW() - INTERVAL '48 hours'
          AND ($1::int[] IS NULL OR sc.id = ANY($1::int[]))
        ORDER BY ti.sent_at DESC
        LIMIT 50`,
      [global.classIds],
    );
    return reply.send(rows.rows);
  });

  /**
   * GET /api/timeouts/escalations — pupils at 3, 6, 9, ... timeouts.
   *
   * Restricted to school leadership: this is the pupil-consequence view that drives
   * parent contact. It was previously readable by every teacher.
   */
  fastify.get('/escalations', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);

    if (!(await isSchoolLeader(user))) {
      return reply.status(403).send({ error: 'Nur die Schulleitung darf die Eskalationsübersicht einsehen.' });
    }

    const candidates = await getPool().query(
      `SELECT p.id AS pupil_id,
              p.full_name AS pupil_name,
              sc.id AS class_id,
              sc.name AS class_name,
              COUNT(ti.id)::int AS total_timeouts
         FROM timeout_incidents ti
         JOIN pupils p          ON p.id  = ti.pupil_id
         JOIN school_classes sc ON sc.id = ti.class_id
        GROUP BY p.id, p.full_name, sc.id, sc.name
       HAVING COUNT(ti.id) >= $1
        ORDER BY total_timeouts DESC, p.full_name ASC`,
      [config.escalationStep],
    );

    const [allEscalations, allTimeouts] = await Promise.all([
      db
        .select({
          pupilId: timeoutEscalations.pupilId,
          milestoneCount: timeoutEscalations.milestoneCount,
          handledAt: timeoutEscalations.handledAt,
          notes: timeoutEscalations.notes,
        })
        .from(timeoutEscalations),
      db
        .select({
          id: timeoutIncidents.id,
          pupilId: timeoutIncidents.pupilId,
          sentAt: timeoutIncidents.sentAt,
          taskAssignment: timeoutIncidents.taskAssignment,
          status: timeoutIncidents.status,
          resolvedAt: timeoutIncidents.resolvedAt,
        })
        .from(timeoutIncidents)
        .orderBy(desc(timeoutIncidents.sentAt)),
    ]);

    const pendingEscalations: unknown[] = [];
    const handledEscalations: unknown[] = [];

    for (const cand of candidates.rows) {
      const pupilEscalations = allEscalations.filter((e) => e.pupilId === cand.pupil_id);
      const pupilTimeouts = allTimeouts.filter((t) => t.pupilId === cand.pupil_id);
      const total = cand.total_timeouts;

      for (let m = config.escalationStep; m <= total; m += config.escalationStep) {
        const handled = pupilEscalations.find((e) => e.milestoneCount === m);
        if (handled) {
          handledEscalations.push({
            pupilId: cand.pupil_id,
            pupilName: cand.pupil_name,
            className: cand.class_name,
            milestoneCount: m,
            handledAt: handled.handledAt,
            notes: handled.notes,
            totalTimeouts: total,
          });
        } else {
          pendingEscalations.push({
            pupilId: cand.pupil_id,
            pupilName: cand.pupil_name,
            classId: cand.class_id,
            className: cand.class_name,
            milestoneCount: m,
            totalTimeouts: total,
            timeoutsHistory: pupilTimeouts,
            handledEscalations: pupilEscalations,
          });
        }
      }
    }

    return reply.send({
      pendingEscalations,
      handledEscalations,
      totalPendingCount: pendingEscalations.length,
    });
  });

  /**
   * POST /api/timeouts/escalations/acknowledge — school leadership records that the
   * parents were contacted.
   */
  fastify.post(
    '/escalations/acknowledge',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['pupilId', 'milestoneCount'],
          additionalProperties: false,
          properties: {
            pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            milestoneCount: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER, multipleOf: config.escalationStep },
            notes: { type: 'string', nullable: true, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const { pupilId, milestoneCount, notes } = (request.body ?? {}) as {
        pupilId?: number;
        milestoneCount?: number;
        notes?: string;
      };

      if (!pupilId || milestoneCount === undefined || milestoneCount === null) {
        return badRequest(reply, 'PupilId und Meilenstein (3, 6, 9...) sind erforderlich.');
      }
      if (
        typeof milestoneCount !== 'number' ||
        !Number.isSafeInteger(milestoneCount) ||
        milestoneCount <= 0 ||
        milestoneCount % config.escalationStep !== 0
      ) {
        return badRequest(reply, `Der Meilenstein muss eine positive Zahl und ein Vielfaches von ${config.escalationStep} sein.`);
      }

      const pupil = await getPupil(pupilId);
      if (!pupil) return reply.status(404).send({ error: 'Schüler nicht gefunden' });

      if (!(await isSchoolLeader(user))) {
        return reply.status(403).send({
          error: 'Nur die Schulleitung (SLC, MED) kann Elternverständigung & Nachholtermin bestätigen.',
        });
      }

      const cleanNotes = notes?.trim();
      if (cleanNotes && cleanNotes.length > 2000) return badRequest(reply, 'Der Hinweis ist zu lang.');

      // The unique index on (pupil_id, milestone_count) makes this idempotent.
      const [escalation] = await db
        .insert(timeoutEscalations)
        .values({
          pupilId,
          milestoneCount,
          handledBy: user.teacherId ?? 0,
          notes: cleanNotes || 'Eltern verständigt & Nachholtermin am Nachmittag vereinbart',
        })
        .onConflictDoUpdate({
          target: [timeoutEscalations.pupilId, timeoutEscalations.milestoneCount],
          set: { handledBy: user.teacherId ?? 0, handledAt: new Date(), notes: cleanNotes },
        })
        .returning();

      await db.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'TIMEOUT_ESCALATION_RESOLVED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: { milestoneCount, notes: escalation.notes },
      });

      return reply.status(201).send({ success: true, escalation });
    },
  );
};

/** Exported for tests. */
export { LW_CLASS_ID, isSchoolLeader };
