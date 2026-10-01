import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { passwordResets, teachers, users } from '../db/schema.js';
import { badRequest, forbid, invalidateTeacherCache, requireAuth } from '../lib/guards.js';
import {
  assertPasswordCurrent,
  clearSessionCookie,
  extractToken,
  issueSessionToken,
  SESSION_COOKIE,
  sessionExpiresAt,
  setSessionCookie,
} from '../lib/session.js';

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

      const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);

      // Always run a bcrypt comparison so a missing account and a wrong password take
      // a comparable amount of time.
      const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
      const validPassword = await bcrypt.compare(password, hash);

      if (!user || !validPassword) {
        request.log.info({ username }, 'Failed login');
        return reply.status(401).send({ error: 'Ungültige Anmeldedaten' });
      }

      if (user.teacherId) {
        const [teacher] = await db.select().from(teachers).where(eq(teachers.id, user.teacherId)).limit(1);
        if (teacher && !teacher.active) {
          return forbid(reply, 'Dieses Konto wurde deaktiviert. Bitte wenden Sie sich an die Schulleitung.');
        }
      }

      const token = issueSessionToken((payload, opts) => fastify.jwt.sign(payload, opts), {
        id: user.id,
        username: user.username,
        role: user.role,
        teacherId: user.teacherId,
        pupilId: user.pupilId,
        mustChangePassword: user.mustChangePassword,
      });

      setSessionCookie(reply, token);
      request.log.info({ username, role: user.role }, 'Login');

      return reply.send({
        token,
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
  fastify.post('/password', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const authUser = requireAuth(request);
    const body = (request.body ?? {}) as { currentPassword?: string; newPassword?: string };

    if (!body.newPassword) {
      return badRequest(reply, 'Ein neues Passwort ist erforderlich.');
    }
    const problem = validateNewPassword(body.newPassword);
    if (problem) return badRequest(reply, problem);

    const [user] = await db.select().from(users).where(eq(users.id, authUser.id)).limit(1);
    if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

    if (user.mustChangePassword) {
      // First-time set: the bootstrap password is still on file, so require it.
      if (!body.currentPassword) {
        return badRequest(reply, 'Bitte geben Sie Ihr bisheriges Passwort an.');
      }
      if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
        return reply.status(401).send({ error: 'Das bisherige Passwort ist nicht korrekt.' });
      }
    } else {
      if (!body.currentPassword) {
        return badRequest(reply, 'Bitte geben Sie Ihr aktuelles Passwort an.');
      }
      if (!(await bcrypt.compare(body.currentPassword, user.passwordHash))) {
        return reply.status(401).send({ error: 'Das aktuelle Passwort ist nicht korrekt.' });
      }
      if (await bcrypt.compare(body.newPassword, user.passwordHash)) {
        return badRequest(reply, 'Das neue Passwort muss sich vom bisherigen unterscheiden.');
      }
    }

    await db
      .update(users)
      .set({ passwordHash: await bcrypt.hash(body.newPassword, BCRYPT_ROUNDS), mustChangePassword: false })
      .where(eq(users.id, authUser.id));

    // Close any outstanding reset request.
    await db
      .update(passwordResets)
      .set({ completedAt: sql`NOW()` })
      .where(sql`${passwordResets.userId} = ${authUser.id} AND ${passwordResets.completedAt} IS NULL`);

    invalidateTeacherCache();

    // Re-issue so the new token carries mustChangePassword: false.
    const token = issueSessionToken((payload, opts) => fastify.jwt.sign(payload, opts), {
      id: user.id,
      username: user.username,
      role: user.role,
      teacherId: user.teacherId,
      pupilId: user.pupilId,
      mustChangePassword: false,
    });
    setSessionCookie(reply, token);

    return reply.send({ success: true, token, user: { ...(await publicUser(user)), mustChangePassword: false } });
  });

  // POST /api/auth/logout
  fastify.post('/logout', async (request, reply) => {
    clearSessionCookie(reply);
    return reply.send({ success: true });
  });

  /** GET /api/auth/me */
  fastify.get('/me', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
    { preHandler: [fastify.requireRole('admin')] },
    async (request: FastifyRequest, reply) => {
      const { username, note } = (request.body ?? {}) as { username?: string; note?: string };
      if (!username) return badRequest(reply, 'Benutzername ist erforderlich.');

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.username, username.trim().toLowerCase()))
        .limit(1);
      if (!user) return reply.status(404).send({ error: 'Benutzer nicht gefunden' });

      const [row] = await db.insert(passwordResets).values({ userId: user.id, note: note?.trim() }).returning();
      return reply.status(201).send({ success: true, reset: row });
    },
  );

  /**
   * GET /api/auth/session — cheap liveness probe used by the client to decide whether
   * to show the login screen. Never throws, so the UI has one predictable call.
   */
  fastify.get('/session', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
  };
  if (!payload.id || !payload.role) throw new Error('malformed token');
  return payload as JwtPayload;
}

export { SESSION_COOKIE, extractToken, assertPasswordCurrent };