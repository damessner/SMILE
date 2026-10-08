import type { FastifyPluginAsync } from 'fastify';
import { and, eq, sql } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import { auditLogs, pupils, pupilBehaviorActions, schoolClasses } from '../db/schema.js';
import { assertPasswordCurrent, badRequest, forbid, getClassAccess, getPupil, MAX_POSTGRES_INTEGER, parseIdParam, requireAuth, safeTeacherId } from '../lib/guards.js';
import { BEHAVIOR_STAGES, computePupilBehaviorStage } from '../lib/behavior-stages.js';


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
    // and could collide with an existing pupil.
    const [newPupil] = await db
      .insert(pupils)
      .values({
        id: sql`nextval('pupil_id_seq')`,
        classId,
        fullName: fullName.trim(),
        isArchived: false,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'ADD_PUPIL',
      entity: 'pupil',
      entityId: String(newPupil.id),
      payload: { fullName: newPupil.fullName, classId },
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

    const [updatedPupil] = await db
      .update(pupils)
      .set(updates)
      .where(sql`${pupils.id} = ${pid}`)
      .returning();

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'UPDATE_PUPIL',
      entity: 'pupil',
      entityId: String(pid),
      payload: {
        previous: { fullName: existing.fullName, classId: existing.classId },
        updated: { fullName: updatedPupil.fullName, classId: updatedPupil.classId },
      },
    });

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

    const [archived] = await db
      .update(pupils)
      .set({ isArchived: true })
      .where(sql`${pupils.id} = ${pid}`)
      .returning();

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'ARCHIVE_PUPIL',
      entity: 'pupil',
      entityId: String(pid),
      payload: { fullName: existing.fullName, classId: existing.classId },
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

    const [classRow] = await db
      .select({ id: schoolClasses.id, name: schoolClasses.name, grade: schoolClasses.grade })
      .from(schoolClasses)
      .where(eq(schoolClasses.id, pupil.classId))
      .limit(1);

    // Get current rank from final_ranks
    const rankRows = await getPool().query(
      `SELECT rank FROM final_ranks WHERE pupil_id = $1 ORDER BY confirmed_at DESC LIMIT 1`,
      [pid]
    );
    const currentRank = rankRows.rows[0]?.rank || 'Geselle';

    // Get active cards
    const cardRows = await getPool().query(
      `SELECT bc.id, bc.card_type, bc.note, bc.created_at, bc.teacher_id,
              t.short_name AS teacher_short, COALESCE(t.full_name, 'Lehrkraft') AS teacher_name
         FROM behavior_cards bc
         LEFT JOIN teachers t ON t.id = bc.teacher_id
        WHERE bc.pupil_id = $1 AND bc.revoked_at IS NULL
        ORDER BY bc.created_at DESC`,
      [pid]
    );

    // Get timeouts
    const timeoutRows = await getPool().query(
      `SELECT ti.id, ti.sent_at, ti.task_assignment, ti.status, ti.resolved_at, ti.resolution_note,
              t.short_name AS sent_by_short
         FROM timeout_incidents ti
         LEFT JOIN teachers t ON t.id = ti.sent_by_teacher_id
        WHERE ti.pupil_id = $1
        ORDER BY ti.sent_at DESC`,
      [pid]
    );

    const greenCount = cardRows.rows.filter((c: any) => c.card_type === 'green').length;
    const yellowCount = cardRows.rows.filter((c: any) => c.card_type === 'yellow').length;
    const redCount = cardRows.rows.filter((c: any) => c.card_type === 'red').length;
    const timeoutCount = timeoutRows.rows.length;

    const calculation = computePupilBehaviorStage(greenCount, yellowCount, redCount, timeoutCount);

    // Get documented actions
    const actionRows = await getPool().query(
      `SELECT pba.id, pba.pupil_id, pba.stage_level, pba.stage_title, pba.status,
              pba.action_date, pba.teacher_id, pba.notes, pba.created_at,
              t.short_name AS teacher_short, COALESCE(t.full_name, 'Lehrkraft') AS teacher_name
         FROM pupil_behavior_actions pba
         LEFT JOIN teachers t ON t.id = pba.teacher_id
        WHERE pba.pupil_id = $1
        ORDER BY pba.action_date DESC, pba.created_at DESC`,
      [pid]
    );

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

    const [action] = await db
      .insert(pupilBehaviorActions)
      .values({
        pupilId: pid,
        stageLevel,
        stageTitle: stageTitle.trim(),
        status: status || 'completed',
        teacherId: user.teacherId ?? 0,
        notes: notes?.trim() || null,
      })
      .returning();

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'BEHAVIOR_STAGE_ACTION_RECORDED',
      entity: 'pupil',
      entityId: String(pid),
      payload: {
        actionId: action.id,
        stageLevel,
        stageTitle,
        notes: notes?.trim(),
      },
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

    return reply.send({ success: true });
  });
};
