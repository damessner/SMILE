import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import type { AuthUser } from './guards.js';

export const SESSION_COOKIE = 'smile_session';

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
    },
    { expiresIn: `${config.sessionTtlSeconds}s` },
  );
}

/**
 * Reject state-changing requests from accounts still on their bootstrap password.
 *
 * This is what turns "every teacher shares `smile2026`" from a permanent condition
 * into a bounded one: the account can sign in and read, but cannot alter any pupil
 * record until the user picks their own password.
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