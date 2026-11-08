import type { FastifyPluginAsync, FastifyReply, FastifyRequest, RouteHandlerMethod } from 'fastify';
import { eq } from 'drizzle-orm';
import {
  assertPasswordCurrent,
  badRequest,
  findPupilInClass,
  forbid,
  getClassAccess,
  parsePositiveInt,
  requireAuth,
  safeTeacherId,
  isSchoolLeader,
  MAX_POSTGRES_INTEGER,
  type AuthUser,
} from '../lib/guards.js';
import {
  WebUntisClient,
  getWebUntisClientForUser,
  getWebUntisServiceClient,
  invalidateWebUntisUserCache,
  normalizeWebUntisHost,
  parseDateOnly,
  type ResolvedWebUntisClient,
} from '../lib/webuntis/client.js';
import { encryptSecret } from '../lib/webuntis/crypto.js';
import { asWebUntisError, isWebUntisError, WebUntisError } from '../lib/webuntis/errors.js';
import { buildWebUntisScope, scopeClassIds } from '../lib/webuntis/scope.js';
import { db } from '../db/index.js';
import { auditLogs, userWebuntisAccounts } from '../db/schema.js';
import { config } from '../config.js';

/** Map the WebUntis error contract onto an HTTP response. */
function sendWebUntisError(reply: FastifyReply, err: unknown): FastifyReply {
  const mapped = asWebUntisError(err);
  return reply.status(mapped.status).send({ error: mapped.message, code: mapped.code });
}

/** Wrap a handler so a thrown WebUntisError keeps its status and stable code. */
function webuntisHandler(
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>,
): RouteHandlerMethod {
  return async (request, reply) => {
    try {
      return await handler(request, reply);
    } catch (err) {
      return sendWebUntisError(reply, err);
    }
  };
}

function dedupeById<T extends { id: number }>(items: T[]): T[] {
  const seen = new Set<number>();
  const result: T[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    result.push(item);
  }
  return result;
}

/**
 * Read client for the caller.
 *
 * The shared service account is a leadership-only, read-only fallback. It is
 * never used for a teacher and never used for a write: that silent substitution
 * made every teacher read the whole school and write as `untis_monitor`.
 */
async function resolveReadClient(user: AuthUser): Promise<ResolvedWebUntisClient | null> {
  const personal = await getWebUntisClientForUser(user.id);
  if (personal) return personal;

  if (await isSchoolLeader(user)) {
    const service = getWebUntisServiceClient();
    if (service) return { client: service, account: 'service' };
  }
  return null;
}

/** Write client: always the caller's personal account. */
async function resolveWriteClient(user: AuthUser): Promise<ResolvedWebUntisClient | null> {
  return getWebUntisClientForUser(user.id);
}

function notConnected(reply: FastifyReply): FastifyReply {
  return reply.status(409).send({
    error:
      'Für dieses Konto ist kein persönliches WebUntis-Konto verknüpft. ' +
      'Bitte verknüpfen Sie zuerst Ihr WebUntis-Konto.',
    code: 'WEBUNTIS_NOT_CONNECTED',
  });
}

export const webuntisRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/webuntis/status — connection state for the caller.
   *
   * No username and no person id: every authenticated user can read this route.
   */
  fastify.get(
    '/status',
    { preValidation: [fastify.authenticate] },
    webuntisHandler(async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const resolved = await resolveReadClient(user);
      if (!resolved) {
        const isPlayground = config.webuntis.environment === 'playground';
        return reply.send({
          connected: false,
          environment: config.webuntis.environment,
          server: isPlayground ? config.webuntis.playgroundServer : config.webuntis.server,
          school: isPlayground ? config.webuntis.playgroundSchool : config.webuntis.school,
          account: 'none',
        });
      }

      const status = await resolved.client.getStatus();
      return reply.send({ ...status, account: resolved.account });
    }),
  );

  /**
   * GET /api/webuntis/account — personal account details for the current teacher.
   */
  fastify.get(
    '/account',
    { preValidation: [fastify.authenticate] },
    webuntisHandler(async (request, reply) => {
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
    }),
  );

  /**
   * POST /api/webuntis/account/connect — verify and link personal credentials.
   *
   * Binding rules: a non-admin may only link the WebUntis person that belongs to
   * their own `teachers.id`. Without this, any teacher could link the headmaster's
   * WebUntis identity and inherit its read/write surface.
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
            server: { type: 'string', maxLength: 200 },
            school: { type: 'string', maxLength: 200 },
            username: { type: 'string', minLength: 1, maxLength: 100 },
            secret: { type: 'string', minLength: 1, maxLength: 500 },
          },
        },
      },
    },
    webuntisHandler(async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      if (user.role === 'pupil') {
        return forbid(reply, 'Schülerkonten können kein WebUntis-Konto verknüpfen.');
      }

      const body = request.body as {
        server?: string;
        school?: string;
        username: string;
        secret: string;
      };

      // Validate the host before it reaches fetch(): an unvalidated host turns
      // the connect endpoint into an SSRF probe and a credential relay.
      const server = normalizeWebUntisHost(body.server?.trim() || config.webuntis.server);
      const school = (body.school?.trim() || config.webuntis.school).slice(0, 200);
      const username = body.username.trim();
      // Never trim the secret: leading/trailing spaces are legal in a password.
      const secret = body.secret;

      const verification = await WebUntisClient.verifyCredentials({
        server,
        school,
        username,
        secret,
      });

      if (!verification.valid) {
        return badRequest(reply, verification.error || 'Verbindung zu WebUntis fehlgeschlagen.');
      }

      if (user.role !== 'admin') {
        if (verification.personType !== 2) {
          return forbid(reply, 'Nur WebUntis-Lehrkräftekonten können mit SMILE verknüpft werden.');
        }
        if (!user.teacherId || verification.personId !== user.teacherId) {
          return forbid(
            reply,
            'Dieses WebUntis-Konto gehört nicht zu Ihrer Lehrkraft. Bitte melden Sie sich mit Ihrem eigenen Konto an.',
          );
        }
      }

      const encrypted = encryptSecret(secret);
      const teacherShort = verification.teacherShort || username.toUpperCase();

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
          teacherShort,
          authMethod: 'password',
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
            teacherShort,
            authMethod: 'password',
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
          teacherShort,
          personId: verification.personId,
        },
      });

      return reply.send({
        success: true,
        teacherShort,
        teacherName: verification.teacherName,
        personId: verification.personId,
      });
    }),
  );

  /**
   * POST /api/webuntis/account/disconnect — remove the personal link.
   */
  fastify.post(
    '/account/disconnect',
    { preValidation: [fastify.authenticate] },
    webuntisHandler(async (request, reply) => {
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
    }),
  );

  /**
   * GET /api/webuntis/classes — classes from WebUntis, limited to the caller's scope.
   */
  fastify.get(
    '/classes',
    { preValidation: [fastify.authenticate] },
    webuntisHandler(async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const resolved = await resolveReadClient(user);
      if (!resolved) return notConnected(reply);

      const scope = await buildWebUntisScope(user);
      const classes = await resolved.client.getClasses();
      const visible =
        scope.classIds === null ? classes : classes.filter((cls) => scope.classIds!.includes(cls.id));

      return reply.send({ classes: visible });
    }),
  );

  /**
   * GET /api/webuntis/absences — absences for a date, scoped to the caller.
   */
  fastify.get(
    '/absences',
    { preValidation: [fastify.authenticate] },
    webuntisHandler(async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as { date?: string; classId?: string | number };
      const targetDate = query.date ? parseDateOnly(query.date) : new Date();
      if (!targetDate) return badRequest(reply, 'Ungültiges Datum.');

      let requestedClassId: number | undefined;
      if (query.classId !== undefined && query.classId !== '') {
        const parsed = parsePositiveInt(query.classId);
        if (parsed === null) return badRequest(reply, 'Ungültige Klassen-ID.');
        requestedClassId = parsed;
      }

      if (requestedClassId !== undefined) {
        const access = await getClassAccess(user, requestedClassId);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
        if (!access.canRead) {
          return forbid(reply, 'Sie dürfen die Abwesenheiten dieser Klasse nicht einsehen.');
        }
      }

      const resolved = await resolveReadClient(user);
      if (!resolved) return notConnected(reply);

      const scope = await buildWebUntisScope(user);
      const classIds = scopeClassIds(scope, requestedClassId);
      if (classIds !== null && classIds.length === 0) {
        return reply.send({ absences: [] });
      }

      if (classIds === null) {
        return reply.send({ absences: await resolved.client.getAbsences(targetDate) });
      }

      const lists = await Promise.all(
        classIds.map((classId) => resolved.client.getAbsences(targetDate, classId)),
      );
      return reply.send({ absences: dedupeById(lists.flat()) });
    }),
  );

  /**
   * GET /api/webuntis/timetable — lessons (and Lehrstoff) for a date or range.
   */
  fastify.get(
    '/timetable',
    { preValidation: [fastify.authenticate] },
    webuntisHandler(async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as {
        date?: string;
        startDate?: string;
        endDate?: string;
        classId?: string | number;
      };

      let requestedClassId: number | undefined;
      if (query.classId !== undefined && query.classId !== '') {
        const parsed = parsePositiveInt(query.classId);
        if (parsed === null) return badRequest(reply, 'Ungültige Klassen-ID.');
        requestedClassId = parsed;
      }

      const start = query.startDate || query.date ? parseDateOnly(query.startDate ?? query.date!) : new Date();
      const end = query.endDate || query.date ? parseDateOnly(query.endDate ?? query.date!) : start;
      if (!start || !end) return badRequest(reply, 'Ungültiges Datum.');

      if (requestedClassId !== undefined) {
        const access = await getClassAccess(user, requestedClassId);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
        if (!access.canRead) {
          return forbid(reply, 'Sie dürfen den Stundenplan dieser Klasse nicht einsehen.');
        }
      }

      const resolved = await resolveReadClient(user);
      if (!resolved) return notConnected(reply);

      const scope = await buildWebUntisScope(user);
      const classIds = scopeClassIds(scope, requestedClassId);
      if (classIds !== null && classIds.length === 0) {
        return reply.send({ lessons: [] });
      }

      // If no specific class was requested and the user has a personal account,
      // return their own teacher timetable (including supervisions, across all classes).
      if (requestedClassId === undefined && resolved.account === 'personal') {
        return reply.send({ lessons: await resolved.client.getTimetableRange(start, end) });
      }

      if (classIds === null) {
        return reply.send({ lessons: await resolved.client.getTimetableRange(start, end) });
      }

      const lists = await Promise.all(
        classIds.map((classId) => resolved.client.getTimetableRange(start, end, classId)),
      );
      return reply.send({ lessons: dedupeById(lists.flat()) });
    }),
  );

  /**
   * POST /api/webuntis/teaching-content — write Lehrstoff for one lesson.
   *
   * The caller must prove ownership of the concrete lesson: `lessonId` alone is
   * not a capability. The route fetches the class/day timetable and checks that
   * the id appears there before writing.
   */
  fastify.post(
    '/teaching-content',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['lessonId', 'classId', 'date', 'text'],
          additionalProperties: false,
          properties: {
            lessonId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            text: { type: 'string', minLength: 1, maxLength: 2000 },
          },
        },
      },
    },
    webuntisHandler(async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const { lessonId, classId, date, text } = request.body as {
        lessonId: number;
        classId: number;
        date: string;
        text: string;
      };
      const cleanText = text.trim();
      if (!cleanText) {
        return badRequest(reply, 'Lehrstoff darf nicht leer sein.');
      }

      const access = await getClassAccess(user, classId);
      if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
      if (!access.canRecord) {
        return forbid(reply, 'Sie dürfen für diese Klasse keinen Lehrstoff eintragen.');
      }

      const resolved = await resolveWriteClient(user);
      if (!resolved) return notConnected(reply);

      const lesson = await resolved.client.findLesson(lessonId, classId, date);
      if (!lesson) {
        return reply.status(404).send({
          error: 'Diese Stunde gehört nicht zum angegebenen Tag und zur angegebenen Klasse.',
          code: 'WEBUNTIS_LESSON_NOT_FOUND',
        });
      }

      await resolved.client.saveLessonTopic({ lessonId, text: cleanText });

      await db.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'WEBUNTIS_TEACHING_CONTENT_SAVED',
        entity: 'lesson',
        entityId: String(lessonId),
        payload: { lessonId, classId, date, text: cleanText },
      });

      return reply.send({ success: true });
    }),
  );

  /**
   * GET /api/webuntis/events — recent Klassenbucheinträge, scoped to the caller.
   */
  fastify.get(
    '/events',
    { preValidation: [fastify.authenticate] },
    webuntisHandler(async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const query = request.query as { classId?: string | number; categoryId?: string | number };

      let requestedClassId: number | undefined;
      if (query.classId !== undefined && query.classId !== '') {
        const parsed = parsePositiveInt(query.classId);
        if (parsed === null) return badRequest(reply, 'Ungültige Klassen-ID.');
        requestedClassId = parsed;
      }

      let categoryId: number | undefined;
      if (query.categoryId !== undefined && query.categoryId !== '') {
        const parsed = parsePositiveInt(query.categoryId);
        if (parsed === null) return badRequest(reply, 'Ungültige Kategorie-ID.');
        categoryId = parsed;
      }

      if (requestedClassId !== undefined) {
        const access = await getClassAccess(user, requestedClassId);
        if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
        if (!access.canRead) {
          return forbid(reply, 'Sie dürfen die Klassenbucheinträge dieser Klasse nicht einsehen.');
        }
      }

      const resolved = await resolveReadClient(user);
      if (!resolved) return notConnected(reply);

      const scope = await buildWebUntisScope(user);
      const classIds = scopeClassIds(scope, requestedClassId);
      if (classIds !== null && classIds.length === 0) {
        return reply.send({ events: [] });
      }

      try {
        if (classIds === null) {
          return reply.send({
            events: await resolved.client.getRecentEvents(undefined, categoryId),
          });
        }

        const lists = await Promise.all(
          classIds.map((classId) => resolved.client.getRecentEvents(classId, categoryId)),
        );
        return reply.send({ events: dedupeById(lists.flat()) });
      } catch (err) {
        if (isWebUntisError(err) && err.code === 'WEBUNTIS_PERMISSION_DENIED') {
          // Standard teacher accounts in WebUntis do not have permission to read getClassregEvents JSON-RPC.
          // They can still create events via dialogs. Return empty events rather than blocking the UI.
          request.log.info({ userId: user.id }, 'WebUntis account lacks permission for getClassregEvents; returning empty list');
          return reply.send({ events: [] });
        }
        throw err;
      }
    }),
  );

  /**
   * POST /api/webuntis/events — manual Klassenbucheintrag.
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
            date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' },
            time: { type: 'string', pattern: '^\\d{2}:\\d{2}$' },
          },
        },
      },
    },
    webuntisHandler(async (request, reply) => {
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
        return forbid(reply, 'Sie dürfen für diese Klasse keine Klassenbucheinträge erstellen.');
      }

      const pupil = await findPupilInClass(studentId, classId);
      if (!pupil) {
        return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');
      }
      if (pupil.isArchived) {
        return badRequest(reply, 'Für archivierte Schüler*innen können keine Einträge erstellt werden.');
      }

      const resolvedCategoryId = categoryId ?? 2;
      if (!config.webuntis.allowedCategoryIds.includes(resolvedCategoryId)) {
        return badRequest(reply, 'Diese WebUntis-Kategorie ist nicht freigegeben.');
      }

      const incidentDate = date ? parseDateOnly(date) : new Date();
      if (!incidentDate) {
        return badRequest(reply, 'Ungültiges Datum.');
      }

      const cleanText = text.trim();
      if (!cleanText) {
        return badRequest(reply, 'Der Eintrag darf nicht leer sein.');
      }

      const resolved = await resolveWriteClient(user);
      if (!resolved) return notConnected(reply);

      const res = await resolved.client.createKlassenbuchEntry({
        studentId,
        classId,
        text: cleanText,
        categoryId: resolvedCategoryId,
        date: incidentDate,
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
          categoryId: resolvedCategoryId,
          text: cleanText,
        },
      });

      return reply.status(201).send({ success: true, eventId: res.eventId });
    }),
  );
};
