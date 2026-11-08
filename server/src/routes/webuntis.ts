import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  assertPasswordCurrent,
  badRequest,
  getClassAccess,
  findPupilInClass,
  requireAuth,
  safeTeacherId,
  MAX_POSTGRES_INTEGER,
} from '../lib/guards.js';
import {
  webuntis,
  WebUntisClient,
  getWebUntisClientForUser,
  invalidateWebUntisUserCache,
} from '../lib/webuntis/client.js';
import { encryptSecret } from '../lib/webuntis/crypto.js';
import { db } from '../db/index.js';
import { auditLogs, userWebuntisAccounts } from '../db/schema.js';
import { config } from '../config.js';

export const webuntisRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/webuntis/status — WebUntis connection and environment status.
   */
  fastify.get('/status', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const client = await getWebUntisClientForUser(user.id);
    const status = await client.getStatus();
    return reply.send(status);
  });

  /**
   * GET /api/webuntis/account — get personal connected WebUntis account details for current teacher.
   */
  fastify.get('/account', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const [account] = await db
      .select({
        id: userWebuntisAccounts.id,
        untisUsername: userWebuntisAccounts.untisUsername,
        teacherShort: userWebuntisAccounts.teacherShort,
        school: userWebuntisAccounts.school,
        server: userWebuntisAccounts.server,
        authMethod: userWebuntisAccounts.authMethod,
        lastVerifiedAt: userWebuntisAccounts.lastVerifiedAt,
      })
      .from(userWebuntisAccounts)
      .where(eq(userWebuntisAccounts.userId, user.id))
      .limit(1);

    if (!account) {
      return reply.send({ connected: false });
    }

    return reply.send({
      connected: true,
      account: {
        username: account.untisUsername,
        teacherShort: account.teacherShort,
        school: account.school,
        server: account.server,
        authMethod: account.authMethod,
        lastVerifiedAt: account.lastVerifiedAt.toISOString(),
      },
    });
  });

  /**
   * POST /api/webuntis/account/connect — verify and link personal WebUntis credentials.
   */
  fastify.post(
    '/account/connect',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['username', 'secret'],
          additionalProperties: false,
          properties: {
            server: { type: 'string' },
            school: { type: 'string' },
            username: { type: 'string', minLength: 1, maxLength: 100 },
            secret: { type: 'string', minLength: 1, maxLength: 500 },
            authMethod: { enum: ['password', 'loginkey'] },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const body = request.body as {
        server?: string;
        school?: string;
        username: string;
        secret: string;
        authMethod?: 'password' | 'loginkey';
      };

      const server = (body.server?.trim() || config.webuntis.server).replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      const school = body.school?.trim() || config.webuntis.school;
      const username = body.username.trim();
      const secret = body.secret.trim();
      const authMethod = body.authMethod || 'password';

      const verification = await WebUntisClient.verifyCredentials({
        server,
        school,
        username,
        secret,
        authMethod,
      });

      if (!verification.valid) {
        return badRequest(reply, verification.error || 'Verbindung zu WebUntis fehlgeschlagen.');
      }

      const encrypted = encryptSecret(secret);

      await db
        .insert(userWebuntisAccounts)
        .values({
          userId: user.id,
          untisUsername: username,
          encryptedSecret: encrypted.encrypted,
          secretIv: encrypted.iv,
          secretAuthTag: encrypted.authTag,
          school,
          server,
          personId: verification.personId,
          teacherShort: verification.teacherShort || username.toUpperCase(),
          authMethod,
          lastVerifiedAt: new Date(),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: userWebuntisAccounts.userId,
          set: {
            untisUsername: username,
            encryptedSecret: encrypted.encrypted,
            secretIv: encrypted.iv,
            secretAuthTag: encrypted.authTag,
            school,
            server,
            personId: verification.personId,
            teacherShort: verification.teacherShort || username.toUpperCase(),
            authMethod,
            lastVerifiedAt: new Date(),
            updatedAt: new Date(),
          },
        });

      invalidateWebUntisUserCache(user.id);

      await db.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'WEBUNTIS_ACCOUNT_CONNECTED',
        entity: 'user',
        entityId: String(user.id),
        payload: {
          username,
          school,
          server,
          teacherShort: verification.teacherShort,
        },
      });

      return reply.send({
        success: true,
        teacherShort: verification.teacherShort,
        teacherName: verification.teacherName,
        personId: verification.personId,
      });
    },
  );

  /**
   * POST /api/webuntis/account/disconnect — disconnect personal WebUntis account.
   */
  fastify.post('/account/disconnect', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    await db.delete(userWebuntisAccounts).where(eq(userWebuntisAccounts.userId, user.id));
    invalidateWebUntisUserCache(user.id);

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'WEBUNTIS_ACCOUNT_DISCONNECTED',
      entity: 'user',
      entityId: String(user.id),
      payload: {},
    });

    return reply.send({ success: true });
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

    const client = await getWebUntisClientForUser(user.id);
    const classes = await client.getClasses();
    return reply.send({ classes });
  });

  /**
   * GET /api/webuntis/absences — get absences for a date and optionally class.
   */
  fastify.get(
    '/absences',
    {
      preValidation: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as { date?: string; classId?: string | number };
      const targetDate = query.date || new Date();

      const classIdNum = query.classId ? Number(query.classId) : undefined;
      if (classIdNum && Number.isFinite(classIdNum) && classIdNum > 0) {
        const access = await getClassAccess(user, classIdNum);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      }

      const client = await getWebUntisClientForUser(user.id);
      const absences = await client.getAbsences(targetDate, classIdNum);
      return reply.send({ absences });
    },
  );

  /**
   * GET /api/webuntis/timetable — get timetable lessons and teaching content for a date or date range.
   */
  fastify.get(
    '/timetable',
    {
      preValidation: [fastify.authenticate],
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as {
        date?: string;
        startDate?: string;
        endDate?: string;
        classId?: string | number;
      };

      const start = query.startDate || query.date || new Date();
      const end = query.endDate || query.date || start;

      const classIdNum = query.classId ? Number(query.classId) : undefined;
      if (classIdNum && Number.isFinite(classIdNum) && classIdNum > 0) {
        const access = await getClassAccess(user, classIdNum);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      }

      const client = await getWebUntisClientForUser(user.id);
      const lessons = await client.getTimetableRange(start, end, classIdNum);
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

      const client = await getWebUntisClientForUser(user.id);
      const res = await client.saveLessonTopic({ lessonId, text: cleanText });
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
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as { classId?: string | number; categoryId?: string | number };
      const classIdNum = query.classId ? Number(query.classId) : undefined;
      const categoryIdNum = query.categoryId ? Number(query.categoryId) : undefined;

      if (classIdNum && Number.isFinite(classIdNum) && classIdNum > 0) {
        const access = await getClassAccess(user, classIdNum);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      }

      const client = await getWebUntisClientForUser(user.id);
      const events = await client.getRecentEvents(classIdNum, categoryIdNum);
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
      const client = await getWebUntisClientForUser(user.id);
      const res = await client.createKlassenbuchEntry({
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
