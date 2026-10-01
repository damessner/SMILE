import type { FastifyPluginAsync } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { auditLogs, pupils, schoolClasses } from '../db/schema.js';
import { assertPasswordCurrent, badRequest, forbid, getClassAccess, getPupil, parseIdParam, requireAuth } from '../lib/guards.js';

/**
 * Pupil roster management.
 *
 * Access rule (matches README §3): the administrator and the homeroom heads of the
 * affected class. These endpoints previously required only a valid token, so any
 * teacher could rename, reassign or archive a pupil in a class they do not teach.
 */
export const pupilRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST /api/pupils — add a pupil to a class. */
  fastify.post('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
      actorId: user.teacherId ?? null,
      action: 'ADD_PUPIL',
      entity: 'pupil',
      entityId: String(newPupil.id),
      payload: { fullName: newPupil.fullName, classId },
    });

    return reply.status(201).send(newPupil);
  });

  /** PUT /api/pupils/:id — edit name and/or move to another class. */
  fastify.put('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
      actorId: user.teacherId ?? null,
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
  fastify.delete('/:id', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
      actorId: user.teacherId ?? null,
      action: 'ARCHIVE_PUPIL',
      entity: 'pupil',
      entityId: String(pid),
      payload: { fullName: existing.fullName, classId: existing.classId },
    });

    return reply.send({ success: true, message: 'Schüler wurde archiviert', pupil: archived });
  });
};