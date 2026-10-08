import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import type { AuthUser } from './guards.js';

export const SESSION_COOKIE = 'smile_session';

export interface PersistedUserSessionState {
  sessionVersion: number;
  mustChangePassword: boolean;
}

/** Read the revocation state from the database, the source of truth across workers. */
export async function getPersistedUserSessionState(userId: string): Promise<PersistedUserSessionState | null> {
  const [state] = await db
    .select({
      sessionVersion: users.sessionVersion,
      mustChangePassword: users.mustChangePassword,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return state ?? null;
}

/**
 * Cookie attributes for the session token.
 *
 * - httpOnly: JavaScript cannot read it, so an XSS bug cannot exfiltrate the session.
 * - SameSite=Strict: the browser never attaches it to a cross-site request, which is
 *   the primary CSRF defence (backed by the Origin check in plugins/security.ts).
 * - path: the API only, so the token is not sent on static asset requests.
 */
function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: 'strict' as const,
    secure: config.cookieSecure,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, cookieOptions(config.sessionTtlSeconds));
}

export function clearSessionCookie(reply: FastifyReply): void {
  // maxAge 0 deletes it; attributes must otherwise match or the browser keeps the old cookie.
  reply.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

/**
 * Pull a bearer token off the request.
 *
 * Order matters: the httpOnly cookie is what the browser uses (WebSocket handshakes
 * cannot set headers, but do send cookies for same-origin). The Authorization header
 * exists for non-browser clients such as `curl` or the backup tooling.
 *
 * There is deliberately no `?token=` query parameter: URLs end up in access logs,
 * proxy logs and browser history, which would leak the session.
 */
export function extractToken(request: FastifyRequest): string | null {
  const cookies = (request as FastifyRequest & { cookies?: Record<string, string | undefined> }).cookies;
  const fromCookie = cookies?.[SESSION_COOKIE];
  if (fromCookie) return fromCookie;

  const header = request.headers.authorization;
  if (header && /^Bearer\s+/i.test(header)) {
    const value = header.replace(/^Bearer\s+/i, '').trim();
    if (value) return value;
  }
  return null;
}

export function issueSessionToken(
  sign: (payload: Record<string, unknown>, opts: { expiresIn: string }) => string,
  user: {
    id: string;
    username: string;
    role: string;
    teacherId?: number | null;
    pupilId?: number | null;
    mustChangePassword?: boolean;
    sessionVersion?: number;
  },
): string {
  return sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      teacherId: user.teacherId ?? undefined,
      pupilId: user.pupilId ?? undefined,
      mustChangePassword: user.mustChangePassword ?? false,
      sessionVersion: user.sessionVersion ?? 0,
    },
    { expiresIn: `${config.sessionTtlSeconds}s` },
  );
}

const forcedPasswordChangeUsers = new Set<string>();

export function markUserMustChangePassword(userId: string): void {
  forcedPasswordChangeUsers.add(String(userId));
}

export function clearUserMustChangePassword(userId: string): void {
  forcedPasswordChangeUsers.delete(String(userId));
}

export function isUserForcedToChangePassword(userId: string): boolean {
  return forcedPasswordChangeUsers.has(String(userId));
}

/**
 * Reject state-changing requests from accounts still on their bootstrap password
 * or whose password reset was triggered by an administrator.
 */
export function assertPasswordCurrent(
  user: AuthUser,
  reply: FastifyReply,
): boolean {
  if (user.mustChangePassword) {
    reply.status(403).send({
      error: 'Bitte setzen Sie zuerst ein neues Passwort.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });
    return false;
  }
  return true;
}

/** ISO timestamp for the session expiry, used by the client to warn before logout. */
export function sessionExpiresAt(): string {
  return new Date(Date.now() + config.sessionTtlSeconds * 1000).toISOString();
}
