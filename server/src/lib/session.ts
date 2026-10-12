import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { teachers, users } from '../db/schema.js';
import type { AuthUser } from './guards.js';

export const SESSION_COOKIE = 'smile_session';

export interface PersistedUserSessionState {
  sessionVersion: number;
  mustChangePassword: boolean;
  /**
   * Whether the linked teacher row is still active. `null` when the account has no
   * teacher link (for example the pupil role or the admin actor row). Enforced in
   * `buildSessionGuard` so a deactivated account loses access on the next request
   * instead of keeping it until the token expires.
   */
  teacherActive: boolean | null;
}

/**
 * Read the revocation state from the database, the source of truth across workers.
 *
 * Short-lived cache. This is called from `ensureLiveSession` on *every* WebSocket
 * broadcast, for *every* connected recipient, so an uncached read put one database
 * round trip per recipient on the send path of the hottest surface in the app: rating a
 * single cell with 20 teachers in the room cost 20 SELECTs and added the slowest of them
 * to the broadcast latency. `getTeacher()` already used a 30 s TTL for the same reason;
 * this brings the session read in line with it.
 *
 * The window is the deliberate trade: a password reset or session revocation takes up to
 * SESSION_STATE_CACHE_TTL_MS to reach an idle socket. Invalidation is explicit for the
 * cases this process controls (`invalidateSessionStateCache`), and the cross-worker case
 * is still bounded rather than open-ended, which is the important property. It is called
 * off the broadcast hot path only once per TTL window per user, so this bound holds.
 */
const SESSION_STATE_CACHE_TTL_MS = 30_000;

const sessionStateCache = new Map<string, { state: PersistedUserSessionState | null; expiresAt: number }>();

/** Drop cached state after this process itself revokes or rotates a session. */
export function invalidateSessionStateCache(userId?: string): void {
  if (userId === undefined) sessionStateCache.clear();
  else sessionStateCache.delete(String(userId));
}

export async function getPersistedUserSessionState(userId: string): Promise<PersistedUserSessionState | null> {
  const key = String(userId);
  const cached = sessionStateCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.state;

  const [state] = await db
    .select({
      sessionVersion: users.sessionVersion,
      mustChangePassword: users.mustChangePassword,
      teacherActive: teachers.active,
    })
    .from(users)
    .leftJoin(teachers, eq(users.teacherId, teachers.id))
    .where(eq(users.id, userId))
    .limit(1);
  const result = state ?? null;
  sessionStateCache.set(key, { state: result, expiresAt: Date.now() + SESSION_STATE_CACHE_TTL_MS });
  return result;
}

/**
 * Cookie attributes for the session token.
 *
 * - httpOnly: JavaScript cannot read it, so an XSS bug cannot exfiltrate the session.
 * - SameSite=Strict: the browser never attaches it to a cross-site request, which is
 *   the primary CSRF defence (backed by the Origin check in plugins/security.ts).
 * - path: '/', deliberately. The WebSocket handshake at /ws authenticates from this
 *   cookie, so it must cover every same-origin path, not just /api.
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
  // This process just changed the durable state the cache mirrors.
  invalidateSessionStateCache(userId);
}

export function clearUserMustChangePassword(userId: string): void {
  forcedPasswordChangeUsers.delete(String(userId));
  invalidateSessionStateCache(userId);
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
