import type { FastifyPluginAsync } from 'fastify';
import {
  assertPasswordCurrent,
  badRequest,
  getClassAccess,
  findPupilInClass,
  requireAuth,
  safeTeacherId,
  MAX_POSTGRES_INTEGER,
} from '../lib/guards.js';
import { webuntis } from '../lib/webuntis/client.js';
import { db } from '../db/index.js';
import { auditLogs } from '../db/schema.js';

export const webuntisRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/webuntis/status — WebUntis connection and environment status.
   */
  fastify.get('/status', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const status = await webuntis.getStatus();
    return reply.send(status);
  });

  /**
   * POST /api/webuntis/environment — switch between production and playground.
   */
  fastify.post(
    '/environment',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['environment'],
          additionalProperties: false,
          properties: {
            environment: { enum: ['production', 'playground'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const { environment } = request.body as { environment: 'production' | 'playground' };
      webuntis.setEnvironment(environment);
      const status = await webuntis.getStatus();
      return reply.send(status);
    },
  );

  /**
   * GET /api/webuntis/classes — get classes known to WebUntis.
   */
  fastify.get('/classes', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const classes = await webuntis.getClasses();
    return reply.send({ classes });
  });

  /**
   * GET /api/webuntis/absences — get absences for a date and optionally class.
   */
  fastify.get(
    '/absences',
    {
      preValidation: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as { date?: string; classId?: number };
      const targetDate = query.date ? new Date(query.date) : new Date();
      if (Number.isNaN(targetDate.getTime())) {
        return badRequest(reply, 'Ungültiges Datum.');
      }

      if (query.classId) {
        const access = await getClassAccess(user, query.classId);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      }

      const absences = await webuntis.getAbsences(targetDate, query.classId);
      return reply.send({ absences });
    },
  );

  /**
   * GET /api/webuntis/timetable — get timetable lessons and teaching content for a date.
   */
  fastify.get(
    '/timetable',
    {
      preValidation: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            date: { type: 'string' },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as { date?: string; classId?: number };
      const targetDate = query.date ? new Date(query.date) : new Date();
      if (Number.isNaN(targetDate.getTime())) {
        return badRequest(reply, 'Ungültiges Datum.');
      }

      if (query.classId) {
        const access = await getClassAccess(user, query.classId);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      }

      const lessons = await webuntis.getDailyTimetable(targetDate, query.classId);
      return reply.send({ lessons });
    },
  );

  /**
   * POST /api/webuntis/teaching-content — submit lesson topic (Lehrstoff).
   */
  fastify.post(
    '/teaching-content',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['lessonId', 'text'],
          additionalProperties: false,
          properties: {
            lessonId: { type: 'integer', minimum: 1 },
            text: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const { lessonId, text } = request.body as { lessonId: number; text: string };
      const cleanText = text.trim();
      if (!cleanText) {
        return badRequest(reply, 'Lehrstoff darf nicht leer sein.');
      }

      const res = await webuntis.saveLessonTopic({ lessonId, text: cleanText });
      if (!res.success) {
        return reply.status(502).send({ error: 'Lehrstoff konnte nicht an WebUntis übermittelt werden.' });
      }

      await db.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'WEBUNTIS_TEACHING_CONTENT_SAVED',
        entity: 'lesson',
        entityId: String(lessonId),
        payload: { lessonId, text: cleanText },
      });

      return reply.send({ success: true });
    },
  );

  /**
   * GET /api/webuntis/events — get recent Klassenbucheinträge.
   */
  fastify.get(
    '/events',
    {
      preValidation: [fastify.authenticate],
      schema: {
        querystring: {
          type: 'object',
          properties: {
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            categoryId: { type: 'integer' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as { classId?: number; categoryId?: number };
      if (query.classId) {
        const access = await getClassAccess(user, query.classId);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      }

      const events = await webuntis.getRecentEvents(query.classId, query.categoryId);
      return reply.send({ events });
    },
  );

  /**
   * POST /api/webuntis/events — manual Klassenbucheintrag creation into WebUntis.
   */
  fastify.post(
    '/events',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['studentId', 'classId', 'text'],
          additionalProperties: false,
          properties: {
            studentId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            text: { type: 'string', minLength: 1, maxLength: 2000 },
            categoryId: { type: 'integer', minimum: 1 },
            date: { type: 'string' },
            time: { type: 'string' },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const { studentId, classId, text, categoryId, date, time } = request.body as {
        studentId: number;
        classId: number;
        text: string;
        categoryId?: number;
        date?: string;
        time?: string;
      };

      const access = await getClassAccess(user, classId);
      if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      if (!access.canRecord) {
        return reply.status(403).send({ error: 'Sie dürfen für diese Klasse keine Klassenbucheinträge erstellen.' });
      }

      const pupil = await findPupilInClass(studentId, classId);
      if (!pupil) {
        return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');
      }

      const cleanText = text.trim();
      const res = await webuntis.createKlassenbuchEntry({
        studentId,
        classId,
        text: cleanText,
        categoryId: categoryId || 2,
        date: date ? new Date(date) : new Date(),
        time,
      });

      if (!res.success) {
        return reply.status(502).send({ error: 'Klassenbucheintrag konnte nicht in WebUntis angelegt werden.' });
      }

      await db.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'WEBUNTIS_EVENT_CREATED',
        entity: 'pupil',
        entityId: String(studentId),
        payload: {
          classId,
          categoryId: categoryId || 2,
          text: cleanText,
        },
      });

      return reply.status(201).send({ success: true, eventId: res.eventId });
    },
  );
};
