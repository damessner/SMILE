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
hasPersistedTeacherActor,
isHeadmasterUser,
isSchoolLeader,
LW_CLASS_ID,
MAX_POSTGRES_INTEGER,
parseIdParam,
requireAuth,
safeTeacherId,
type Identity,
} from '../lib/guards.js';
import { canActOnTimeout, timeoutVisibility } from '../lib/lw-duty.js';
import { timeoutExpiry } from '../lib/period-times.js';
import { resolveRetroactiveOccurrence } from '../lib/retroactive-timeout.js';
import { broadcastToClass } from '../ws/live-sync.js';
import {
  queueClassEventNotification,
  queueTimeoutEscalationNotification,
} from '../lib/notification-events.js';

export const timeoutRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/timeouts — send a pupil to the Lernwerkstatt.
   *
   * `taskAssignment` is required for a disciplinary `timeout` (which also files the
   * linked red card). A `cooldown` is a consequence-free referral: it records a
   * note-only card and a Lernwerkstatt incident, creates no red card, and does not
   * count toward timeout escalation milestones or behaviour stages.
   *
   * Writes happen in one transaction so a pupil can never end up with a card but no
   * Lernwerkstatt record (the previous two-step write could fail halfway).
   */
  fastify.post(
    '/',
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
            kind: { enum: ['timeout', 'cooldown'] },
            taskAssignment: { type: 'string', nullable: true, maxLength: 2000 },
            retroactive: { type: 'boolean' },
            retroactiveDate: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            retroactivePeriod: { type: 'integer', minimum: 1, maximum: 10 },
          },
        },
      },
    },
    async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const {
      pupilId,
      classId,
      kind: rawKind,
      taskAssignment,
      retroactive,
      retroactiveDate,
      retroactivePeriod,
    } = (request.body ?? {}) as {
      pupilId?: number;
      classId?: number;
      kind?: 'timeout' | 'cooldown';
      taskAssignment?: string | null;
      retroactive?: boolean;
      retroactiveDate?: string;
      retroactivePeriod?: number;
    };
    const kind = rawKind ?? 'timeout';
    const isCooldown = kind === 'cooldown';
    const isRetroactive = retroactive === true;

    if (!pupilId || !classId) {
      return badRequest(reply, 'Schüler*in und Klasse sind zwingend erforderlich.');
    }
    if (isRetroactive && isCooldown) {
      return badRequest(reply, 'Ein Cool-Down kann nicht nachträglich erfasst werden.');
    }
    let occurrence = null;
    if (isRetroactive) {
      if (!retroactiveDate || !retroactivePeriod) {
        return badRequest(reply, 'Für einen Nachtrag sind Datum und Schulstunde erforderlich.');
      }
      const resolved = resolveRetroactiveOccurrence(
        retroactiveDate,
        retroactivePeriod,
        new Date(),
        config.retroactiveTimeoutMaxDays,
      );
      if (!resolved.ok) return badRequest(reply, resolved.error);
      occurrence = resolved.occurrence;
    }
    const cleanTask = taskAssignment?.trim() ?? '';
    if (!isCooldown && !cleanTask) {
      return badRequest(reply, 'Für ein Time-Out ist ein konkreter Arbeitsauftrag erforderlich.');
    }
    const storedTask = cleanTask || 'Cool-Down';
    if (storedTask.length > 2000) return badRequest(reply, 'Der Arbeitsauftrag ist zu lang.');

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRecord) {
      return reply.status(403).send({
        error: 'Sie unterrichten diese Klasse nicht und dürfen dort kein Time-Out auslösen.',
      });
    }

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');

    // `behavior_cards.teacher_id` and `timeout_incidents.sent_by_teacher_id` are NOT NULL
    // foreign keys. The former `?? 0` wrote a phantom teacher row instead of failing, so a
    // card could be attributed to nobody. An account without a persisted teacher record
    // cannot be the actor of this write, so refuse before anything is inserted.
    // Bound to a const so the `is number` narrowing survives into the transaction callback.
    const actorId = user.teacherId;
    if (!hasPersistedTeacherActor(actorId)) {
      return reply.status(503).send({
        error:
          'Das Auslösen eines Time-Outs ist nicht verfügbar, weil Ihrem Konto kein Lehrkraftdatensatz zugeordnet ist.',
        code: 'SYSTEM_ACTOR_NOT_CONFIGURED',
      });
    }

    if (isRetroactive && occurrence) {
      const [duplicate] = await db
        .select({ id: timeoutIncidents.id })
        .from(timeoutIncidents)
        .where(
          and(
            eq(timeoutIncidents.pupilId, pupilId),
            eq(timeoutIncidents.classId, classId),
            eq(timeoutIncidents.kind, 'timeout'),
            eq(timeoutIncidents.sentAt, occurrence.occurredAt),
          ),
        )
        .limit(1);
      if (duplicate) {
        return reply.status(409).send({
          error: 'Für diese Stunde ist für diesen Schüler bereits ein Time-Out erfasst.',
          code: 'TIMEOUT_ALREADY_RECORDED',
        });
      }
    }

    const result = await db.transaction(async (tx) => {
      // A Time-Out is its own consequence. It does NOT create a red card:
      // only an explicit red card demotes the rank.
      let cooldownCard: typeof behaviorCards.$inferSelect | null = null;

      if (isCooldown) {
        const [card] = await tx
          .insert(behaviorCards)
          .values({
            pupilId,
            classId,
            teacherId: actorId,
            cardType: 'cooldown',
            note: cleanTask ? `[COOL-DOWN LW] ${cleanTask}` : '[COOL-DOWN LW]',
          })
          .returning();
        cooldownCard = card ?? null;
      }

      const [incident] = await tx
        .insert(timeoutIncidents)
        .values({
          pupilId,
          classId,
          sentByTeacherId: actorId,
          taskAssignment: storedTask,
          kind,
          status: isRetroactive ? 'resolved' : 'active',
          redCardId: null,
          ...(isRetroactive && occurrence
            ? {
                sentAt: occurrence.occurredAt,
                recordedAt: new Date(),
                retroactive: true,
                resolvedAt: occurrence.periodEnd,
                resolvedBy: actorId,
                resolutionNote: 'Nachträglich erfasst',
                expiresAt: occurrence.periodEnd,
              }
            : { expiresAt: timeoutExpiry() }),
        })
        .returning();

      // A Cool-Down is intentionally consequence-free: it must not advance the
      // 3/6/9 escalation ladder. Only real Time-Outs are counted.
      const [countRow] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(timeoutIncidents)
        .where(and(
          eq(timeoutIncidents.pupilId, pupilId),
          eq(timeoutIncidents.kind, 'timeout'),
        ));
      const totalTimeouts = countRow?.count ?? 0;
      const isEscalationTriggered =
        !isCooldown &&
        totalTimeouts > 0 &&
        totalTimeouts % config.escalationStep === 0;

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: isCooldown
          ? 'COOLDOWN_ISSUED'
          : isRetroactive
            ? 'TIMEOUT_RETROACTIVE_RECORDED'
            : 'TIMEOUT_ISSUED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: {
          classId,
          kind,
          taskAssignment: storedTask,
          redCardId: null,
          cooldownCardId: cooldownCard?.id ?? null,
          totalTimeouts,
          isEscalationTriggered,
          retroactive: isRetroactive,
          ...(occurrence
            ? {
                period: occurrence.period,
                occurredAt: occurrence.occurredAt.toISOString(),
                recordedAt: new Date().toISOString(),
              }
            : {}),
        },
      });

      return { cooldownCard, incident, totalTimeouts, isEscalationTriggered };
    });

    if (!isCooldown) {
      queueClassEventNotification({
        type: 'timeout',
        classId,
        pupilName: pupil.fullName,
        teacherId: actorId,
        note: storedTask,
        occurredAt: occurrence?.occurredAt,
        retroactive: isRetroactive,
      });
    }
    if (result.cooldownCard) {
      broadcastToClass(classId, {
        type: 'CARD_ISSUED',
        card: result.cooldownCard,
        alertTriggered: false,
      });
      queueClassEventNotification({
        type: 'cooldown',
        classId,
        pupilName: pupil.fullName,
        teacherId: actorId,
        note: cleanTask || null,
      });
    }
    if (result.isEscalationTriggered) {
      queueTimeoutEscalationNotification({
        classId,
        pupilName: pupil.fullName,
        teacherId: actorId,
        totalTimeouts: result.totalTimeouts,
        note: storedTask,
        occurredAt: occurrence?.occurredAt,
        retroactive: isRetroactive,
      });
    }
    broadcastToClass(classId, {
      type: 'TIMEOUT_ISSUED',
      incident: result.incident,
      redCard: null,
      cooldownCard: result.cooldownCard,
      kind,
      totalTimeouts: result.totalTimeouts,
      isEscalationTriggered: result.isEscalationTriggered,
    });
    broadcastToClass(LW_CLASS_ID, {
      type: 'TIMEOUT_ISSUED',
      incident: result.incident,
      redCard: null,
      cooldownCard: result.cooldownCard,
      kind,
      totalTimeouts: result.totalTimeouts,
      isEscalationTriggered: result.isEscalationTriggered,
    });

    return reply.status(201).send({
      success: true,
      kind,
      retroactive: isRetroactive,
      incident: result.incident,
      redCard: null,
      cooldownCard: result.cooldownCard,
      totalTimeouts: result.totalTimeouts,
      isEscalationTriggered: result.isEscalationTriggered,
    });
  });

/**
* GET /api/timeouts/active — live LW list.
*
* The Lernwerkstatt is a room, not a class: pupils arrive there from whichever class
* the teacher who clicked was standing in. So school-wide visibility is granted by being
* on duty in the running period (`timetable_lessons`, class 999), not by teaching the
* offending class — see `lib/lw-duty.ts` for why the obvious alternative breaks the board.
* Every other teacher sees only their own classes, which is what `/history` already does.
*
* The scope is applied in SQL *before* `LIMIT`, never by filtering rows afterwards:
* filtering after the limit silently drops the caller's rows that fall outside the
* globally newest 100.
*/
fastify.get('/active', { preValidation: [fastify.authenticate] }, async (request, reply) => {
const user = requireAuth(request);
const scope = await timeoutVisibility(user);
if (scope.forbidden) {
return forbid(reply);
}
// A teacher who is not on duty and has no classes at all cannot be shown anything;
// answering without a query keeps "no access" indistinguishable from "nothing going on".
if (!scope.onDuty && scope.classIds?.length === 0) {
return reply.send([]);
}

const rows = await getPool().query(
`SELECT ti.id,
ti.pupil_id,
ti.class_id,
ti.sent_by_teacher_id,
ti.sent_at,
ti.expires_at,
ti.task_assignment,
ti.kind,
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
AND (ti.expires_at IS NULL OR ti.expires_at > NOW())
AND ($1::bool OR sc.id = ANY($2::int[]))
ORDER BY ti.sent_at DESC
LIMIT 100`,
[scope.onDuty, scope.classIds],
);
return reply.send(rows.rows);
});

/**
* POST /api/timeouts/:id/resolve — the duty teacher releases the pupil.
*
* Same rule as `GET /active`, deliberately: a supervisor who can see a pupil in the
* room must be able to release them. The previous check was `getClassAccess(...).canRecord`,
* which read as if any teacher could do this ("that is the LW duty roster") but in fact
* refused the on-duty supervisor for every class they do not teach — the duty board showed
* the pupil and then answered 403.
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

if (!(await canActOnTimeout(user, existing.classId))) {
return reply.status(403).send({
error:
'Sie sind für diese Klasse nicht zuständig und haben heute keine Lernwerkstatt-Aufsicht.',
});
}

    // Closing the pupil's time-out and recording who closed it are one write: a release
    // with no audit row would let a pupil appear in the room without a trace of who
    // ended it, and the audit row must not claim a release that rolled back.
    const resolved = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(timeoutIncidents)
        .set({
          status: 'resolved',
          resolvedAt: new Date(),
          resolvedBy: safeTeacherId(user.teacherId),
          resolutionNote: cleanNote || 'Arbeitsauftrag in Lernwerkstatt erledigt',
        })
        .where(and(eq(timeoutIncidents.id, id), eq(timeoutIncidents.status, 'active')))
        .returning();

      if (!updated) return null;

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'TIMEOUT_RESOLVED',
        entity: 'timeout_incident',
        entityId: id,
        payload: { pupilId: existing.pupilId, classId: existing.classId },
      });

      return updated;
    });

    if (!resolved) return badRequest(reply, 'Dieser Time-Out wurde soeben abgeschlossen.');

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
              ti.recorded_at,
              ti.retroactive,
              ti.task_assignment,
              ti.kind,
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
        WHERE (ti.sent_at >= NOW() - INTERVAL '48 hours'
               OR (ti.retroactive = true AND ti.recorded_at >= NOW() - INTERVAL '48 hours'))
          AND ($1::int[] IS NULL OR sc.id = ANY($1::int[]))
        ORDER BY ti.recorded_at DESC, ti.sent_at DESC
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
        WHERE ti.kind = 'timeout'
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

      // A leader must not be able to record a parent-contact milestone the pupil
      // never reached (for example 999). Count the actual incidents first.
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(timeoutIncidents)
        .where(eq(timeoutIncidents.pupilId, pupilId));
      const totalTimeouts = countRow?.count ?? 0;
      if (milestoneCount > totalTimeouts) {
        return badRequest(
          reply,
          `Meilenstein ${milestoneCount} wurde noch nicht erreicht (${totalTimeouts} Time-Outs).`,
        );
      }

      // `handled_by` is a NOT NULL foreign key. An administrator without a linked teacher
      // record (the old code wrote `?? 0`) would otherwise record the acknowledgement as
      // handled by a phantom row, which is indistinguishable from a real teacher.
      const actorId = user.teacherId;
      if (!hasPersistedTeacherActor(actorId)) {
        return reply.status(503).send({
          error:
            'Das Bestätigen einer Eskalation ist nicht verfügbar, weil Ihrem Konto kein Lehrkraftdatensatz zugeordnet ist.',
          code: 'SYSTEM_ACTOR_NOT_CONFIGURED',
        });
      }

      // Parent contact and its audit row commit together: this is the record that the
      // school informed the parents, and it must not exist without the acknowledgement.
      const escalation = await db.transaction(async (tx) => {
        // The unique index on (pupil_id, milestone_count) makes this idempotent.
        const [acknowledged] = await tx
          .insert(timeoutEscalations)
          .values({
            pupilId,
            milestoneCount,
            handledBy: actorId,
            notes: cleanNotes || 'Eltern verständigt & Nachholtermin am Nachmittag vereinbart',
          })
          .onConflictDoUpdate({
            target: [timeoutEscalations.pupilId, timeoutEscalations.milestoneCount],
            set: {
              handledBy: actorId,
              handledAt: new Date(),
              // Omitting notes on a repeat acknowledgement must not erase the
              // parent-contact record that was already stored.
              ...(cleanNotes ? { notes: cleanNotes } : {}),
            },
          })
          .returning();

        await tx.insert(auditLogs).values({
          actorId: safeTeacherId(user.teacherId),
          action: 'TIMEOUT_ESCALATION_RESOLVED',
          entity: 'pupil',
          entityId: String(pupilId),
          payload: { milestoneCount, notes: acknowledged.notes },
        });

        return acknowledged;
      });

      return reply.status(201).send({ success: true, escalation });
    },
  );
};

/** Exported for tests. */
export { LW_CLASS_ID, isSchoolLeader };
