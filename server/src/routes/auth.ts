import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { passwordResets, teachers, users } from '../db/schema.js';
import { badRequest, forbid, invalidateTeacherCache, requireAuth } from '../lib/guards.js';
import {
  assertPasswordCurrent,
  clearSessionCookie,
  clearUserMustChangePassword,
  extractToken,
  issueSessionToken,
  markUserMustChangePassword,
  SESSION_COOKIE,
  sessionExpiresAt,
  setSessionCookie,
} from '../lib/session.js';
import { generateTemporaryPassword } from '../lib/temporary-credential.js';
import { closeUserWebSockets } from '../ws/live-sync.js';

const BCRYPT_ROUNDS = 12;

/** Blocked outright regardless of the account state, to blunt username enumeration. */
const MIN_PASSWORD_LENGTH = 12;

function validateNewPassword(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Das Passwort muss Groß- und Kleinbuchstaben sowie eine Ziffer enthalten.';
  }
  return null;
}

/**
 * A start password (`mustChangePassword` still true) stops working 14 days after it was
 * issued. Exported so tests can build a password exactly at, or past, the boundary.
 */
export const START_PASSWORD_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const START_PASSWORD_EXPIRED_MESSAGE =
  'Das Start-Passwort ist abgelaufen. Bitte wenden Sie sich an die Schulleitung, damit ein neues Passwort vergeben wird.';

/** Failed logins per username before further attempts are refused. */
export const LOGIN_MAX_FAILURES = 5;
/** Window in which failures are counted; the lock lasts until it closes. */
export const LOGIN_LOCKOUT_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_LOCKED_MESSAGE = 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten.';

/**
 * Per-username failure counter for POST /api/auth/login.
 *
 * In-memory and per process: it resets on restart and is not shared between instances.
 * That is acceptable for a single-process LAN deployment; it complements, not replaces,
 * the per-IP rate limit. Keys are normalised usernames, and the lock applies whether or
 * not the account exists, so it does not reveal which accounts exist.
 */
const loginFailures = new Map<string, { count: number; windowStart: number }>();
const LOGIN_FAILURE_MAP_SOFT_LIMIT = 10_000;

function loginLockActive(username: string, now: number): boolean {
  const entry = loginFailures.get(username);
  if (!entry) return false;
  if (now - entry.windowStart >= LOGIN_LOCKOUT_WINDOW_MS) {
    loginFailures.delete(username);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

function recordLoginFailure(username: string, now: number): void {
  const entry = loginFailures.get(username);
  if (!entry || now - entry.windowStart >= LOGIN_LOCKOUT_WINDOW_MS) {
    loginFailures.set(username, { count: 1, windowStart: now });
  } else {
    entry.count += 1;
  }
  if (loginFailures.size > LOGIN_FAILURE_MAP_SOFT_LIMIT) {
    for (const [key, value] of loginFailures) {
      if (now - value.windowStart >= LOGIN_LOCKOUT_WINDOW_MS) loginFailures.delete(key);
    }
  }
}

/** Test helper: forget every recorded failure. */
export function resetLoginFailures(): void {
  loginFailures.clear();
}

/** True when a still-flagged start password is older than the 14-day limit. */
export function startPasswordExpired(
  user: { mustChangePassword: boolean; passwordIssuedAt: Date | string },
  now: number = Date.now(),
): boolean {
  if (!user.mustChangePassword) return false;
  const issued = new Date(user.passwordIssuedAt).getTime();
  // An unreadable issue date fails closed: the start password must not live on unchecked.
  if (Number.isNaN(issued)) return true;
  return now - issued > START_PASSWORD_MAX_AGE_MS;
}

async function publicUser(user: typeof users.$inferSelect) {
  let teacher = null;
  if (user.teacherId) {
    const [t] = await db.select().from(teachers).where(eq(teachers.id, user.teacherId)).limit(1);
    teacher = t ?? null;
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    teacherId: user.teacherId,
    teacher,
    mustChangePassword: user.mustChangePassword,
  };
}

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/auth/login
   *
   * Rate limited per IP (see plugins/security.ts) and generic in its failure message so
   * the response cannot be used to enumerate valid usernames.
   */
  fastify.post(
    '/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            password: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
      },
      config: {
        rateLimit: {
          max: fastify.rateLimitLoginMax,
          timeWindow: `${fastify.rateLimitLoginWindowSeconds}s`,
        },
      },
    },
    async (request, reply) => {
      const body = (request.body ?? {}) as { username?: string; password?: string };
      const username = body.username?.trim().toLowerCase();
      const password = body.password;

      if (!username || !password) {
        return badRequest(reply, 'Benutzername und Passwort sind erforderlich.');
      }

      const now = Date.now();
      const locked = loginLockActive(username, now);

      const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

      // Always run a bcrypt comparison so a missing account, a locked name and a wrong
      // password take a comparable amount of time.
      const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
      const validPassword = await bcrypt.compare(password, hash);

      if (locked) {
        request.log.info({ username }, 'Login refused: too many failed attempts');
        return reply.status(429).send({ error: LOGIN_LOCKED_MESSAGE });
      }

      if (!user || !validPassword) {
        recordLoginFailure(username, now);
        request.log.info({ username }, 'Failed login');
        return reply.status(401).send({ error: 'Ungültige Anmeldedaten' });
      }

      if (user.teacherId) {
        const [teacher] = await db.select().from(teachers).where(eq(teachers.id, user.teacherId)).limit(1);
        if (teacher && !teacher.active) {
          return forbid(reply, 'Dieses Konto wurde deaktiviert. Bitte wenden Sie sich an die Schulleitung.');
        }
      }

      // Correct password, but the start password was issued too long ago. No session is
      // issued; the administrator has to set a new one.
      if (startPasswordExpired(user, now)) {
        request.log.info({ username }, 'Login refused: start password expired');
        return forbid(reply, START_PASSWORD_EXPIRED_MESSAGE);
      }

      loginFailures.delete(username);

      const token = issueSessionToken((payload, opts) => fastify.jwt.sign(payload, opts), {
        id: user.id,
        username: user.username,
        role: user.role,
        teacherId: user.teacherId,
        pupilId: user.pupilId,
        mustChangePassword: user.mustChangePassword,
        sessionVersion: user.sessionVersion,
      });

      setSessionCookie(reply, token);
      request.log.info({ username, role: user.role }, 'Login');

      return reply.send({
        user: await publicUser(user),
        expiresAt: sessionExpiresAt(),
      });
    },
  );

  /**
   * POST /api/auth/password — set or change the caller's own password.
   *
   * Reachable without a rotated password so it can be used to escape the
   * `mustChangePassword` state. Requires the current password so a stolen session
   * cookie alone cannot lock the real owner out.
   */
  fastify.post(
    '/password',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['newPassword'],
          additionalProperties: false,
          properties: {
            currentPassword: { type: 'string', maxLength: 256 },
            newPassword: { type: 'string', minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
    const authUser = requireAuth(request);
    const { currentPassword, newPassword } = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };

    if (!newPassword) {
      return badRequest(reply, 'Ein neues Passwort ist erforderlich.');
    }
    const problem = validateNewPassword(newPassword);
    if (problem) return badRequest(reply, problem);

    const [user] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
    if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

    if (user.mustChangePassword) {
      // First-time set: the bootstrap password is still on file, so require it.
      if (!currentPassword) {
        return badRequest(reply, 'Bitte geben Sie Ihr bisheriges Passwort an.');
      }
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return reply.status(401).send({
          error: 'Das bisherige Passwort ist nicht korrekt.',
          code: 'INVALID_CURRENT_PASSWORD',
        });
      }
      // The one-time credential must actually be replaced: whoever issued it (the
      // administrator, or anyone who learned the shared bootstrap password) would
      // otherwise keep knowing an active password after the "change".
      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        return badRequest(reply, 'Das neue Passwort muss sich vom bisherigen unterscheiden.');
      }
    } else {
      if (!currentPassword) {
        return badRequest(reply, 'Bitte geben Sie Ihr aktuelles Passwort an.');
      }
      if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
        return reply.status(401).send({
          error: 'Das aktuelle Passwort ist nicht korrekt.',
          code: 'INVALID_CURRENT_PASSWORD',
        });
      }
      if (await bcrypt.compare(newPassword, user.passwordHash)) {
        return badRequest(reply, 'Das neue Passwort muss sich vom bisherigen unterscheiden.');
      }
    }

    let newSessionVersion = user.sessionVersion;
    let passwordChangeApplied = false;
    await db.transaction(async (tx) => {
      const [updatedUser] = await tx
        .update(users)
        .set({
          passwordHash: await bcrypt.hash(newPassword, BCRYPT_ROUNDS),
          mustChangePassword: false,
          passwordIssuedAt: new Date(),
          sessionVersion: sql`${users.sessionVersion} + 1`,
        })
        .where(and(eq(users.id, authUser.id), eq(users.sessionVersion, user.sessionVersion)))
        .returning({ sessionVersion: users.sessionVersion });
      if (!updatedUser) return;
      newSessionVersion = updatedUser.sessionVersion;
      passwordChangeApplied = true;

      // Close any outstanding reset request.
      await tx
        .update(passwordResets)
        .set({ completedAt: sql`NOW()` })
        .where(sql`${passwordResets.userId} = ${authUser.id} AND ${passwordResets.completedAt} IS NULL`);
    });

    if (!passwordChangeApplied) {
      return reply.status(409).send({ error: 'Die Sitzung wurde zurückgesetzt. Bitte laden Sie die Seite neu.' });
    }

    clearUserMustChangePassword(authUser.id);
    invalidateTeacherCache();

    // Re-issue so the new token carries mustChangePassword: false.
    const token = issueSessionToken((payload, opts) => fastify.jwt.sign(payload, opts), {
      id: user.id,
      username: user.username,
      role: user.role,
      teacherId: user.teacherId,
      pupilId: user.pupilId,
      mustChangePassword: false,
      sessionVersion: newSessionVersion,
    });
    setSessionCookie(reply, token);

    return reply.send({ success: true, user: { ...(await publicUser(user)), mustChangePassword: false } });
  });

  /**
   * GET /api/auth/users — account list for the administrator's credential handover.
   *
   * Administrator-only, and deliberately narrow: it exists so an administrator can see
   * which accounts still need a credential, not to be a general user directory. The
   * password hash is never selected, so it cannot leak through a careless later edit.
   * `mustChangePassword` is included because that is the state the panel acts on.
   */
  fastify.get(
    '/users',
    {
      preValidation: [fastify.requireAccountAdministrator],
    },
    async (request, reply) => {
      const requester = requireAuth(request);
      if (!assertPasswordCurrent(requester, reply)) return;

      const rows = await db
        .select({
          id: users.id,
          username: users.username,
          role: users.role,
          teacherId: users.teacherId,
          mustChangePassword: users.mustChangePassword,
          teacherShort: teachers.shortName,
          teacherName: teachers.fullName,
        })
        .from(users)
        .leftJoin(teachers, eq(teachers.id, users.teacherId))
        .orderBy(users.username);

      return reply.send({
        users: rows.map((row) => ({
          id: row.id,
          username: row.username,
          role: row.role,
          teacherId: row.teacherId,
          teacherShort: row.teacherShort ?? null,
          teacherName: row.teacherName ?? null,
          mustChangePassword: row.mustChangePassword,
        })),
      });
    },
  );

  /**
   * POST /api/auth/admin/temporary-password — issue a one-time credential for an account.
   *
   * There is no mail on this LAN, so the administrator receives the generated value once
   * here and relays it out of band. The account is flagged `mustChangePassword`, every
   * mutating endpoint stays closed until its owner picks a private value, and all existing
   * sessions are revoked.
   *
   * The plaintext is returned exactly once, in this response. It is never stored, never
   * logged and never retrievable again — a later request for the same account generates a
   * *new* value rather than showing the old one, so a lost response cannot be replayed.
   */
  fastify.post(
    '/admin/temporary-password',
    {
      preValidation: [fastify.requireAccountAdministrator],
      schema: {
        body: {
          type: 'object',
          required: ['username'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            note: { type: 'string', nullable: true, maxLength: 500 },
          },
        },
      },
    },
    async (request, reply) => {
      const requester = requireAuth(request);
      if (!assertPasswordCurrent(requester, reply)) return;
      const { username, note } = (request.body ?? {}) as { username?: string; note?: string };

      if (!requester.teacherId) {
        // The audit row records who issued the credential. An administrator without a
        // linked teacher record cannot be attributed, so refuse rather than write a
        // fabricated actor.
        return reply.status(503).send({
          error:
            'Das Ausstellen von Zugangsdaten ist nicht verfügbar, weil Ihrem Administratorkonto kein Lehrkraftdatensatz zugeordnet ist.',
          code: 'SYSTEM_ACTOR_NOT_CONFIGURED',
        });
      }
      if (!username) return badRequest(reply, 'Benutzername ist erforderlich.');

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username.trim().toLowerCase()))
        .limit(1);
      if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

      const temporaryPassword = generateTemporaryPassword();

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS),
            mustChangePassword: true,
            passwordIssuedAt: new Date(),
            sessionVersion: sql`${users.sessionVersion} + 1`,
          })
          .where(eq(users.id, user.id));

        // Close any earlier, still-open request so the audit history has one live line.
        await tx
          .update(passwordResets)
          .set({ completedAt: sql`NOW()` })
          .where(
            and(
              sql`${passwordResets.userId} = ${user.id}`,
              sql`${passwordResets.completedAt} IS NULL`,
            ),
          );

        await tx.insert(passwordResets).values({
          userId: user.id,
          requestedBy: requester.teacherId,
          note: note?.trim() ?? 'Zugangsdaten vom Administrator übergeben',
        });
      });

      markUserMustChangePassword(user.id);
      invalidateTeacherCache();
      closeUserWebSockets(user.id);

      // Deliberately not logged: request.log would capture the only copy of a credential
      // that exists outside the administrator's screen.
      request.log.info(
        { username: user.username, issuedBy: requester.teacherId },
        'Issued a one-time login credential',
      );

      return reply.status(201).send({
        success: true,
        username: user.username,
        temporaryPassword,
        mustChangePassword: true,
        notice:
          'Dieses Passwort wird genau einmal angezeigt. Bitte jetzt notieren und persönlich übergeben — danach muss es beim ersten Anmelden geändert werden.',
      });
    },
  );

  // POST /api/auth/logout
  fastify.post('/logout', async (request, reply) => {
    clearSessionCookie(reply);
    return reply.send({ success: true });
  });

  /** GET /api/auth/me */
  fastify.get('/me', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const authUser = requireAuth(request);
    const [user] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);

    if (!user) {
      clearSessionCookie(reply);
      return reply.status(401).send({ error: 'Benutzer nicht gefunden' });
    }

    return reply.send(await publicUser(user));
  });

  /**
   * POST /api/auth/request-reset — administrator locks an account and forces a
   * password change at next login. There is no self-service reset because the app has
   * no mail delivery on the school LAN.
   */
  fastify.post(
    '/request-reset',
    {
      preValidation: [fastify.requireAccountAdministrator],
      schema: {
        body: {
          type: 'object',
          required: ['username'],
          additionalProperties: false,
          properties: {
            username: { type: 'string', minLength: 1, maxLength: 64 },
            note: { type: 'string', nullable: true, maxLength: 500 },
          },
        },
      },
    },
    async (request: FastifyRequest, reply) => {
      const requester = requireAuth(request);
      if (!assertPasswordCurrent(requester, reply)) return;
      const { username, note } = (request.body ?? {}) as { username?: string; note?: string };
      if (!username) return badRequest(reply, 'Benutzername ist erforderlich.');

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username.trim().toLowerCase()))
        .limit(1);
      if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

      // Atomically update user to require password change and record reset row
      const [row] = await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            mustChangePassword: true,
            sessionVersion: sql`${users.sessionVersion} + 1`,
          })
          .where(eq(users.id, user.id));

        return await tx
          .insert(passwordResets)
          .values({ userId: user.id, note: note?.trim() })
          .returning();
      });

      markUserMustChangePassword(user.id);
      closeUserWebSockets(user.id);
      return reply.status(201).send({ success: true, reset: row });
    },
  );

  /**
   * GET /api/auth/session — cheap liveness probe used by the client to decide whether
   * to show the login screen. Never throws, so the UI has one predictable call.
   */
  fastify.get('/session', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const authUser = requireAuth(request);
    return reply.send({
      authenticated: true,
      userId: authUser.id,
      mustChangePassword: !!authUser.mustChangePassword,
      expiresAt: sessionExpiresAt(),
    });
  });
};

/**
 * Verify a bearer token for callers outside the HTTP preHandler chain.
 * Throws on missing, malformed or expired tokens; the caller decides the response.
 */
export interface JwtPayload {
  id: string;
  username: string;
  role: string;
  teacherId?: number;
  pupilId?: number;
  mustChangePassword?: boolean;
  sessionVersion?: number;
}

export function verifyToken(
  fastify: { jwt: { verify: (t: string) => Record<string, unknown> } },
  token: string | null,
): JwtPayload {
  if (!token) throw new Error('missing token');
  const payload = fastify.jwt.verify(token) as {
    id?: string;
    username?: string;
    role?: string;
    teacherId?: number;
    pupilId?: number;
    mustChangePassword?: boolean;
    sessionVersion?: number;
  };
  if (!payload.id || !payload.role) throw new Error('malformed token');
  return payload as JwtPayload;
}

export { SESSION_COOKIE, extractToken, assertPasswordCurrent };
