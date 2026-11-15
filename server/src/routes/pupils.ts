import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import { auditLogs, pupils, pupilBehaviorActions, schoolClasses } from '../db/schema.js';
import { assertPasswordCurrent, badRequest, forbid, getClassAccess, getPupil, hasPersistedTeacherActor, MAX_POSTGRES_INTEGER, parseIdParam, requireAuth, safeTeacherId } from '../lib/guards.js';
import { BEHAVIOR_STAGES, computePupilBehaviorStage } from '../lib/behavior-stages.js';
import { totalCardDemotionSteps } from '../lib/rank-demotion.js';
import { demoteBy, isRank, RANKS, type Rank } from '../lib/ranking.js';
import { getLatestRound } from '../lib/rounds.js';
import { broadcastToClass } from '../ws/live-sync.js';

function isCardInRound(
  createdAt: Date | string | null | undefined,
  round: { startsOn?: Date | string | null; endsOn?: Date | string | null } | null,
): boolean {
  if (!round?.startsOn && !round?.endsOn) return true;
  if (!createdAt) return false;
  const ts = new Date(createdAt).getTime();
  if (Number.isNaN(ts)) return false;
  if (round.startsOn) {
    const startTs = new Date(round.startsOn).getTime();
    if (!Number.isNaN(startTs) && ts < startTs) return false;
  }
  if (round.endsOn) {
    const endTs = new Date(round.endsOn).getTime();
    if (!Number.isNaN(endTs) && ts > endTs) return false;
  }
  return true;
}

function majorityProposedRank(rows: Array<{ proposed_status?: string | null }>): Rank | null {
  const counts: Record<Rank, number> = { Lehrling: 0, Geselle: 0, Meister: 0 };
  for (const row of rows) {
    if (isRank(row.proposed_status)) {
      counts[row.proposed_status] += 1;
    }
  }
  const top = Math.max(counts.Lehrling, counts.Geselle, counts.Meister);
  if (top <= 0) return null;
  // Require a strict modal leader so ties do not bias upward.
  const leaders = RANKS.filter((rank) => counts[rank] === top);
  return leaders.length === 1 ? leaders[0]! : null;
}


/**
 * Pupil roster management.
 *
 * Access rule (matches README §3): the administrator and the homeroom heads of the
 * affected class. These endpoints previously required only a valid token, so any
 * teacher could rename, reassign or archive a pupil in a class they do not teach.
 */
export const pupilRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST /api/pupils — add a pupil to a class. */
  fastify.post(
    '/',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['classId', 'fullName'],
          additionalProperties: false,
          properties: {
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            fullName: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { classId, fullName } = (request.body ?? {}) as { classId?: number; fullName?: string };

    if (!classId || !fullName?.trim()) {
      return badRequest(reply, 'Klasse und Schülername sind erforderlich.');
    }
    if (fullName.trim().length > 200) {
      return badRequest(reply, 'Der Name ist zu lang.');
    }

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canManagePupils) {
      return forbid(reply, 'Nur die Schulleitung oder der Klassenvorstand darf Schülerdaten anlegen.');
    }

    // Atomic ID allocation. The previous MAX(id)+1 raced under concurrent requests
    // and could collide with an existing pupil. The audit row commits with the
    // mutation, so a pupil cannot be created without a trace.
    const newPupil = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(pupils)
        .values({
          id: sql`nextval('pupil_id_seq')`,
          classId,
          fullName: fullName.trim(),
          isArchived: false,
        })
        .returning();

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'ADD_PUPIL',
        entity: 'pupil',
        entityId: String(created.id),
        payload: { fullName: created.fullName, classId },
      });

      return created;
    });

    broadcastToClass(newPupil.classId, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: newPupil.classId,
      pupilId: newPupil.id,
    });

    return reply.status(201).send(newPupil);
  });

  /** PUT /api/pupils/:id — edit name and/or move to another class. */
  fastify.put(
    '/:id',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            fullName: { type: 'string', minLength: 1, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { id } = request.params as { id: string };
    const pid = parseIdParam(id, 'id');
    if (!pid) return badRequest(reply, 'Ungültige Schüler-ID.');

    const { fullName, classId } = (request.body ?? {}) as { fullName?: string; classId?: number };
    if (fullName !== undefined && !fullName.trim()) {
      return badRequest(reply, 'Der Name darf nicht leer sein.');
    }
    if (fullName && fullName.trim().length > 200) {
      return badRequest(reply, 'Der Name ist zu lang.');
    }

    const existing = await getPupil(pid);
    if (!existing) return reply.status(404).send({ error: 'Schüler nicht gefunden' });

    // Must be allowed in the current class...
    const currentAccess = await getClassAccess(user, existing.classId);
    if (!currentAccess.canManagePupils) {
      return forbid(reply, 'Nur die Schulleitung oder der Klassenvorstand darf Schülerdaten ändern.');
    }

    // ...and, when moving the pupil, in the destination class too.
    if (classId !== undefined && classId !== existing.classId) {
      const targetAccess = await getClassAccess(user, classId);
      if (!targetAccess.exists) return reply.status(404).send({ error: 'Zielklasse nicht gefunden' });
      if (!targetAccess.canManagePupils) {
        return forbid(reply, 'Sie dürfen Schüler nicht in diese Zielklasse verschieben.');
      }
    }

    const updates: Partial<typeof pupils.$inferInsert> = {};
    if (fullName !== undefined && fullName.trim()) updates.fullName = fullName.trim();
    if (classId !== undefined) updates.classId = classId;

    if (Object.keys(updates).length === 0) {
      return badRequest(reply, 'Keine Änderung übermittelt.');
    }

    const updatedPupil = await db.transaction(async (tx) => {
      const [updated] = await tx
        .update(pupils)
        .set(updates)
        .where(sql`${pupils.id} = ${pid}`)
        .returning();

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'UPDATE_PUPIL',
        entity: 'pupil',
        entityId: String(pid),
        payload: {
          previous: { fullName: existing.fullName, classId: existing.classId },
          updated: { fullName: updated.fullName, classId: updated.classId },
        },
      });

      return updated;
    });

    broadcastToClass(updatedPupil.classId, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: updatedPupil.classId,
      pupilId: updatedPupil.id,
    });
    if (updatedPupil.classId !== existing.classId) {
      broadcastToClass(existing.classId, {
        type: 'PUPIL_ROSTER_CHANGED',
        classId: existing.classId,
        pupilId: updatedPupil.id,
      });
    }

    return reply.send(updatedPupil);
  });

  /** DELETE /api/pupils/:id — soft-delete (archive). History is preserved. */
  fastify.delete('/:id', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { id } = request.params as { id: string };
    const pid = parseIdParam(id, 'id');
    if (!pid) return badRequest(reply, 'Ungültige Schüler-ID.');

    const existing = await getPupil(pid);
    if (!existing) return reply.status(404).send({ error: 'Schüler nicht gefunden' });

    const access = await getClassAccess(user, existing.classId);
    if (!access.canManagePupils) {
      return forbid(reply, 'Nur die Schulleitung oder der Klassenvorstand darf Schüler archivieren.');
    }
    if (existing.isArchived) {
      return badRequest(reply, 'Dieser Schüler ist bereits archiviert.');
    }

    const archived = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(pupils)
        .set({ isArchived: true })
        .where(sql`${pupils.id} = ${pid}`)
        .returning();

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'ARCHIVE_PUPIL',
        entity: 'pupil',
        entityId: String(pid),
        payload: { fullName: existing.fullName, classId: existing.classId },
      });

      return row;
    });

    broadcastToClass(existing.classId, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: existing.classId,
      pupilId: pid,
    });

    return reply.send({ success: true, message: 'Schüler wurde archiviert', pupil: archived });
  });

  /**
   * GET /api/pupils/:id/behavior-profile — get behavioral staging, cards, timeouts, and actions.
   */
  fastify.get('/:id/behavior-profile', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { id } = request.params as { id: string };
    const pid = parseIdParam(id, 'id');
    if (!pid) return badRequest(reply, 'Ungültige Schüler-ID.');

    const pupil = await getPupil(pid);
    if (!pupil) return reply.status(404).send({ error: 'Schüler nicht gefunden' });

    const access = await getClassAccess(user, pupil.classId);
    if (!access.canRead) {
      return reply.status(403).send({ error: 'Keine Zugriffsberechtigung für diese Klasse' });
    }

    const [classResult, round, cardRows, timeoutRows, actionRows] = await Promise.all([
      db
        .select({ id: schoolClasses.id, name: schoolClasses.name, grade: schoolClasses.grade })
        .from(schoolClasses)
        .where(eq(schoolClasses.id, pupil.classId))
        .limit(1),
      getLatestRound(),
      // Exclude consequence-free cooldown cards so only real red/yellow/green cards count.
      getPool().query(
        `SELECT bc.id, bc.card_type, bc.note, bc.created_at, bc.teacher_id,
                t.short_name AS teacher_short, COALESCE(t.full_name, 'Lehrkraft') AS teacher_name
           FROM behavior_cards bc
           LEFT JOIN teachers t ON t.id = bc.teacher_id
          WHERE bc.pupil_id = $1
            AND bc.revoked_at IS NULL
            AND bc.card_type IN ('green', 'yellow', 'red')
          ORDER BY bc.created_at DESC`,
        [pid]
      ),
      getPool().query(
        `SELECT ti.id, ti.sent_at, ti.recorded_at, ti.retroactive, ti.task_assignment, ti.kind, ti.status, ti.resolved_at, ti.resolution_note,
                t.short_name AS sent_by_short
           FROM timeout_incidents ti
           LEFT JOIN teachers t ON t.id = ti.sent_by_teacher_id
          WHERE ti.pupil_id = $1
          ORDER BY ti.sent_at DESC`,
        [pid]
      ),
      getPool().query(
        `SELECT pba.id, pba.pupil_id, pba.stage_level, pba.stage_title, pba.status,
                pba.action_date, pba.teacher_id, pba.notes, pba.created_at,
                t.short_name AS teacher_short, COALESCE(t.full_name, 'Lehrkraft') AS teacher_name
           FROM pupil_behavior_actions pba
           LEFT JOIN teachers t ON t.id = pba.teacher_id
          WHERE pba.pupil_id = $1
          ORDER BY pba.action_date DESC, pba.created_at DESC`,
        [pid]
      ),
    ]);
    const [classRow] = classResult;

    const greenCount = cardRows.rows.filter((c: any) => c.card_type === 'green').length;
    const yellowCount = cardRows.rows.filter((c: any) => c.card_type === 'yellow').length;
    const redCount = cardRows.rows.filter((c: any) => c.card_type === 'red').length;
    // A consequence-free Cool-Down is not a Time-Out for behaviour staging.
    const timeoutCount = timeoutRows.rows.filter(
      (row: { kind?: string | null }) => row.kind !== 'cooldown',
    ).length;

    const calculation = computePupilBehaviorStage(greenCount, yellowCount, redCount, timeoutCount);

    // Resolve rank strictly within the latest round: confirmed final_ranks first,
    // then majority evaluations.proposed_status demoted by active cards, else 'Geselle'.
    let currentRank: Rank = 'Geselle';
    const roundId = round?.id ?? null;
    if (roundId) {
      const rankRows = await getPool().query<{ rank: string }>(
        `SELECT rank FROM final_ranks WHERE pupil_id = $1 AND round_id = $2 ORDER BY confirmed_at DESC LIMIT 1`,
        [pid, roundId]
      );
      const confirmedRank = rankRows.rows[0]?.rank;
      if (isRank(confirmedRank)) {
        currentRank = confirmedRank;
      } else {
        const evalRows = await getPool().query<{ proposed_status: string | null }>(
          `SELECT proposed_status
             FROM evaluations
            WHERE pupil_id = $1 AND round_id = $2 AND proposed_status IS NOT NULL`,
          [pid, roundId]
        );
        const majorityRank = majorityProposedRank(evalRows.rows);
        if (majorityRank) {
          const yellowInRoundCount = cardRows.rows.filter(
            (c: { card_type?: string; created_at?: Date | string | null }) =>
              c.card_type === 'yellow' && isCardInRound(c.created_at, round),
          ).length;
          currentRank = demoteBy(majorityRank, totalCardDemotionSteps(redCount, yellowInRoundCount));
        }
      }
    }

    return reply.send({
      pupil: {
        id: pupil.id,
        fullName: pupil.fullName,
        classId: pupil.classId,
        className: classRow?.name || '',
        currentRank,
      },
      stages: BEHAVIOR_STAGES,
      calculation,
      cards: cardRows.rows,
      timeouts: timeoutRows.rows,
      actions: actionRows.rows,
    });
  });

  /**
   * POST /api/pupils/:id/behavior-actions — record an action taken for a behavior stage.
   */
  fastify.post(
    '/:id/behavior-actions',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['stageLevel', 'stageTitle'],
          additionalProperties: false,
          properties: {
            stageLevel: { type: 'integer', minimum: -10, maximum: 10 },
            stageTitle: { type: 'string', minLength: 1, maxLength: 100 },
            notes: { type: 'string', nullable: true, maxLength: 1000 },
            status: { enum: ['pending', 'completed', 'acknowledged'] },
          },
        },
      },
    },
    async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { id } = request.params as { id: string };
    const pid = parseIdParam(id, 'id');
    if (!pid) return badRequest(reply, 'Ungültige Schüler-ID.');

    const pupil = await getPupil(pid);
    if (!pupil) return reply.status(404).send({ error: 'Schüler nicht gefunden' });

    const access = await getClassAccess(user, pupil.classId);
    if (!access.canRecord && !access.isKv && !access.isHeadmaster && !access.isAdmin) {
      return forbid(reply, 'Keine Berechtigung zum Dokumentieren von Verhaltensmaßnahmen für diese Klasse.');
    }

    const { stageLevel, stageTitle, notes, status } = (request.body ?? {}) as {
      stageLevel?: number;
      stageTitle?: string;
      notes?: string;
      status?: 'pending' | 'completed' | 'acknowledged';
    };

    if (
      typeof stageLevel !== 'number' ||
      !Number.isSafeInteger(stageLevel) ||
      stageLevel < -10 ||
      stageLevel > 10 ||
      !stageTitle?.trim()
    ) {
      return badRequest(reply, 'Gültige Stufe (-10 bis +10) und Titel der Maßnahme sind erforderlich.');
    }

    // Bound to a const so the `is number` narrowing survives into the transaction
    // callback. `pupil_behavior_actions.teacher_id` is a NOT NULL foreign key; the
    // former `?? 0` attributed the record to a phantom teacher row instead of failing.
    const actorId = user.teacherId;
    if (!hasPersistedTeacherActor(actorId)) {
      return reply.status(503).send({
        error:
          'Das Dokumentieren einer Verhaltensmaßnahme ist nicht verfügbar, weil Ihrem Konto kein Lehrkraftdatensatz zugeordnet ist.',
        code: 'SYSTEM_ACTOR_NOT_CONFIGURED',
      });
    }

    const action = await db.transaction(async (tx) => {
      const [recorded] = await tx
        .insert(pupilBehaviorActions)
        .values({
          pupilId: pid,
          stageLevel,
          stageTitle: stageTitle.trim(),
          status: status || 'completed',
          teacherId: actorId,
          notes: notes?.trim() || null,
        })
        .returning();

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'BEHAVIOR_STAGE_ACTION_RECORDED',
        entity: 'pupil',
        entityId: String(pid),
        payload: {
          actionId: recorded.id,
          stageLevel,
          stageTitle,
          notes: notes?.trim(),
        },
      });

      return recorded;
    });

    broadcastToClass(pupil.classId, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: pupil.classId,
      pupilId: pid,
    });

    return reply.status(201).send(action);
  });

  /**
   * DELETE /api/pupils/:id/behavior-actions/:actionId — revoke/delete an action record.
   */
  fastify.delete('/:id/behavior-actions/:actionId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { id, actionId } = request.params as { id: string; actionId: string };
    const pid = parseIdParam(id, 'id');
    if (!pid) return badRequest(reply, 'Ungültige Schüler-ID.');
    if (!actionId || !/^[0-9a-f-]{36}$/i.test(actionId)) {
      return badRequest(reply, 'Ungültige Maßnahmen-ID.');
    }

    const pupil = await getPupil(pid);
    if (!pupil) return reply.status(404).send({ error: 'Schüler nicht gefunden' });

    // Select the action by BOTH id AND pupilId to prevent cross-pupil IDOR
    const [existing] = await db
      .select()
      .from(pupilBehaviorActions)
      .where(and(eq(pupilBehaviorActions.id, actionId), eq(pupilBehaviorActions.pupilId, pid)))
      .limit(1);

    if (!existing) return reply.status(404).send({ error: 'Maßnahme nicht gefunden' });

    const access = await getClassAccess(user, pupil.classId);
    const isAuthor = user.teacherId != null && existing.teacherId === user.teacherId;
    if (!isAuthor && !access.isKv && !access.isHeadmaster && !access.isAdmin) {
      return forbid(reply, 'Nur der Ersteller, KV oder Schulleitung darf diese Maßnahme löschen.');
    }

    await db.transaction(async (tx) => {
      await tx.delete(pupilBehaviorActions).where(eq(pupilBehaviorActions.id, actionId));
      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'BEHAVIOR_STAGE_ACTION_DELETED',
        entity: 'pupil',
        entityId: String(pid),
        payload: { actionId, stageLevel: existing.stageLevel, stageTitle: existing.stageTitle },
      });
    });

    broadcastToClass(pupil.classId, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: pupil.classId,
      pupilId: pid,
    });

    return reply.send({ success: true });
  });
};
