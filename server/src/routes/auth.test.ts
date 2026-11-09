import { readFileSync } from 'fs';
import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  assertPasswordCurrent,
  buildAuthenticate,
  buildRequireAccountAdministrator,
  buildRequireRole,
  clearUserMustChangePassword,
  isUserForcedToChangePassword,
  markUserMustChangePassword,
} from '../lib/guards.js';
import * as guardModule from '../lib/guards.js';
import type { AuthUser } from '../lib/guards.js';

describe('Auth session and password reset immediate revocation (Task 2.5)', () => {
  const userId = '11111111-2222-3333-4444-555555555555';

  it('marks and clears forced password change in memory', () => {
    expect(isUserForcedToChangePassword(userId)).toBe(false);
    markUserMustChangePassword(userId);
    expect(isUserForcedToChangePassword(userId)).toBe(true);
    clearUserMustChangePassword(userId);
    expect(isUserForcedToChangePassword(userId)).toBe(false);
  });

  it('buildAuthenticate intercepts active session when admin requests reset', async () => {
    // Simulated token payload where mustChangePassword was initially false when token was issued
    const fakePayload: AuthUser = {
      id: userId,
      username: 'testteacher',
      role: 'teacher',
      teacherId: 42,
      mustChangePassword: false,
    };

    const jwtVerify = async () => fakePayload;
    const authenticate = buildAuthenticate(jwtVerify);

    const req1 = {} as FastifyRequest;
    const reply1 = {
      status: () => reply1,
      send: () => reply1,
    } as unknown as FastifyReply;

    // 1. Normal state: mustChangePassword is false
    clearUserMustChangePassword(userId);
    await (authenticate as any)(req1, reply1);
    expect(req1.authUser).toBeDefined();
    expect(req1.authUser?.mustChangePassword).toBe(false);

    // assertPasswordCurrent succeeds
    let rejected1 = false;
    const mockReplySuccess = {
      status: () => ({ send: () => { rejected1 = true; } }),
    } as unknown as FastifyReply;
    const allowed = assertPasswordCurrent(req1.authUser!, mockReplySuccess);
    expect(allowed).toBe(true);
    expect(rejected1).toBe(false);

    // 2. Admin issues reset for this user
    markUserMustChangePassword(userId);

    const req2 = {} as FastifyRequest;
    await (authenticate as any)(req2, reply1);
    expect(req2.authUser?.mustChangePassword).toBe(true);

    // assertPasswordCurrent immediately fails closed
    let statusCode = 0;
    let sentPayload: any = null;
    const mockReplyBlocked = {
      status: (code: number) => {
        statusCode = code;
        return {
          send: (body: any) => {
            sentPayload = body;
          },
        };
      },
    } as unknown as FastifyReply;

    const blocked = assertPasswordCurrent(req2.authUser!, mockReplyBlocked);
    expect(blocked).toBe(false);
    expect(statusCode).toBe(403);
    expect(sentPayload).toEqual({
      error: 'Bitte setzen Sie zuerst ein neues Passwort.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    });

    // 3. User updates password -> clearing forced state restores access
    clearUserMustChangePassword(userId);
    const req3 = {} as FastifyRequest;
    await (authenticate as any)(req3, reply1);
    expect(req3.authUser?.mustChangePassword).toBe(false);

    const allowedAgain = assertPasswordCurrent(req3.authUser!, mockReplySuccess);
    expect(allowedAgain).toBe(true);
  });

  it('rejects a token whose durable session version was revoked', async () => {
    const fakePayload = {
      id: userId,
      username: 'testteacher',
      role: 'teacher',
      teacherId: 42,
      mustChangePassword: false,
      sessionVersion: 3,
    };
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    expect(buildSessionGuard).toBeTypeOf('function');
    const guard = buildSessionGuard(async () => ({ sessionVersion: 4, mustChangePassword: false, teacherActive: true }));
    const req = {
      authUser: fakePayload,
      method: 'POST',
      url: '/api/auth/password',
      routeOptions: { url: '/api/auth/password' },
    } as unknown as FastifyRequest;
    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: () => reply,
      clearCookie: vi.fn(),
    } as unknown as FastifyReply;

    await guard(req, reply);

    expect(statusCode).toBe(401);
    expect((reply.clearCookie as any)).toHaveBeenCalled();
  });

  it('rejects a valid token whose durable role no longer matches the claim', async () => {
    // The admin gates run in preValidation on the token's role, before this guard.
    // If the durable role changed (demotion), letting the request through here would
    // mean the stale claim already authorised the handler - backup export and restore
    // included - for the rest of the token lifetime. The session must end instead.
    const fakePayload = {
      id: userId,
      username: 'testteacher',
      role: 'admin',
      teacherId: 42,
      mustChangePassword: false,
      sessionVersion: 3,
    };
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    const guard = buildSessionGuard(async () => ({
      sessionVersion: 3,
      mustChangePassword: false,
      teacherActive: true,
      role: 'teacher',
    }));
    const req = {
      authUser: fakePayload,
      method: 'GET',
      url: '/api/backup/export-json',
      routeOptions: { url: '/api/backup/export-json' },
    } as unknown as FastifyRequest;
    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: () => reply,
      clearCookie: vi.fn(),
    } as unknown as FastifyReply;

    await guard(req, reply);

    expect(statusCode).toBe(401);
    expect((reply.clearCookie as any)).toHaveBeenCalled();
  });

  it('allows a revoked token only into forced-password-change state while the DB reset is pending', async () => {
    const fakePayload = {
      id: userId,
      username: 'testteacher',
      role: 'teacher',
      teacherId: 42,
      mustChangePassword: false,
      sessionVersion: 3,
    };
    clearUserMustChangePassword(userId);
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    expect(buildSessionGuard).toBeTypeOf('function');
    const guard = buildSessionGuard(async () => ({ sessionVersion: 4, mustChangePassword: true, teacherActive: true }));
    const req = {
      authUser: fakePayload,
      method: 'POST',
      url: '/api/auth/password',
      routeOptions: { url: '/api/auth/password' },
    } as unknown as FastifyRequest;
    const reply = {
      status: () => reply,
      send: () => reply,
    } as unknown as FastifyReply;

    await guard(req, reply);

    expect(req.authUser).toMatchObject({ mustChangePassword: true, sessionVersion: 4 });
  });

  it('blocks protected reads for a reset-pending stale token but permits the password endpoint', async () => {
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    const guard = buildSessionGuard(async () => ({ sessionVersion: 4, mustChangePassword: true, teacherActive: true }));
    const req = {
      authUser: {
        id: userId,
        username: 'testteacher',
        role: 'teacher',
        mustChangePassword: false,
        sessionVersion: 3,
      },
      method: 'GET',
      routeOptions: { url: '/api/classes/:classId/pupils' },
    } as unknown as FastifyRequest;
    let statusCode = 0;
    let responseBody: unknown;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: (body: unknown) => {
        responseBody = body;
        return reply;
      },
      clearCookie: vi.fn(),
    } as unknown as FastifyReply;

    await guard(req, reply);

    expect(statusCode).toBe(403);
    expect(responseBody).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
    expect(req.authUser?.mustChangePassword).toBe(true);
  });

  it('permits /api/auth/me, /api/auth/session, and /api/auth/logout for mustChangePassword accounts with current sessionVersion', async () => {
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    const guard = buildSessionGuard(async () => ({ sessionVersion: 4, mustChangePassword: true, teacherActive: true }));

    for (const [method, url] of [
      ['GET', '/api/auth/me'],
      ['GET', '/api/auth/session'],
      ['POST', '/api/auth/logout'],
    ] as const) {
      const req = {
        authUser: {
          id: userId,
          username: 'testteacher',
          role: 'teacher',
          mustChangePassword: true,
          sessionVersion: 4,
        },
        method,
        url,
      } as unknown as FastifyRequest;
      let statusCode = 0;
      const reply = {
        status: (code: number) => {
          statusCode = code;
          return reply;
        },
        send: vi.fn(),
        clearCookie: vi.fn(),
      } as unknown as FastifyReply;

      await guard(req, reply);
      expect(statusCode).toBe(0); // Guard did not block or reply with 401/403
    }
  });

  it('rejects /api/auth/me with 401 when mustChangePassword is true but token has stale sessionVersion', async () => {
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    const guard = buildSessionGuard(async () => ({ sessionVersion: 4, mustChangePassword: true, teacherActive: true }));
    const req = {
      authUser: {
        id: userId,
        username: 'testteacher',
        role: 'teacher',
        mustChangePassword: true,
        sessionVersion: 3,
      },
      method: 'GET',
      url: '/api/auth/me',
    } as unknown as FastifyRequest;
    let statusCode = 0;
    const clearCookie = vi.fn();
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: vi.fn(),
      clearCookie,
    } as unknown as FastifyReply;

    await guard(req, reply);
    expect(statusCode).toBe(401);
    expect(clearCookie).toHaveBeenCalled();
  });

  it('blocks a deactivated teacher with 403 ACCOUNT_DEACTIVATED and clears the session cookie', async () => {
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    const guard = buildSessionGuard(async () => ({
      sessionVersion: 4,
      mustChangePassword: false,
      teacherActive: false,
    }));
    const req = {
      authUser: {
        id: userId,
        username: 'testteacher',
        role: 'teacher',
        teacherId: 42,
        mustChangePassword: false,
        sessionVersion: 4,
      },
      method: 'GET',
      url: '/api/classes/501/pupils',
    } as unknown as FastifyRequest;
    let statusCode = 0;
    let responseBody: unknown;
    const clearCookie = vi.fn();
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: (body: unknown) => {
        responseBody = body;
        return reply;
      },
      clearCookie,
    } as unknown as FastifyReply;

    await guard(req, reply);

    expect(statusCode).toBe(403);
    expect(responseBody).toMatchObject({ code: 'ACCOUNT_DEACTIVATED' });
    expect(clearCookie).toHaveBeenCalled();
  });

  it('does not lock out the admin actor row, whose placeholder teacher row is inactive by design', async () => {
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    const guard = buildSessionGuard(async () => ({
      sessionVersion: 4,
      mustChangePassword: false,
      teacherActive: false,
    }));
    const req = {
      authUser: {
        id: 'admin-1',
        username: 'admin',
        role: 'admin',
        mustChangePassword: false,
        sessionVersion: 4,
      },
      method: 'GET',
      url: '/api/backup/export-json',
    } as unknown as FastifyRequest;
    let statusCode = 0;
    const reply = {
      status: (code: number) => {
        statusCode = code;
        return reply;
      },
      send: () => reply,
      clearCookie: vi.fn(),
    } as unknown as FastifyReply;

    await guard(req, reply);

    expect(statusCode).toBe(0);
  });

  it('uses persisted account state instead of a stale worker-local reset flag', async () => {
    markUserMustChangePassword(userId);
    const buildSessionGuard = (guardModule as any).buildSessionGuard;
    const guard = buildSessionGuard(async () => ({ sessionVersion: 4, mustChangePassword: false, teacherActive: true }));
    const req = {
      authUser: {
        id: userId,
        username: 'testteacher',
        role: 'teacher',
        mustChangePassword: false,
        sessionVersion: 4,
      },
    } as unknown as FastifyRequest;
    const reply = {
      status: () => reply,
      send: () => reply,
    } as unknown as FastifyReply;
    const mockReplySuccess = {
      status: () => ({ send: vi.fn() }),
    } as unknown as FastifyReply;

    await guard(req, reply);

    expect(req.authUser?.mustChangePassword).toBe(false);
    expect(assertPasswordCurrent(req.authUser!, mockReplySuccess)).toBe(true);
    clearUserMustChangePassword(userId);
  });

  it('buildRequireRole also intercepts forced password change immediately', async () => {
    const fakePayload: AuthUser = {
      id: userId,
      username: 'testteacher',
      role: 'teacher',
      teacherId: 42,
      mustChangePassword: false,
    };

    const jwtVerify = async () => fakePayload;
    const requireTeacher = buildRequireRole(jwtVerify)('teacher');

    markUserMustChangePassword(userId);

    const req = {} as FastifyRequest;
    const reply = {
      status: () => reply,
      send: () => reply,
    } as unknown as FastifyReply;

    await (requireTeacher as any)(req, reply);
    expect(req.authUser?.mustChangePassword).toBe(true);

    clearUserMustChangePassword(userId);
  });

  it('restricts the credential endpoints to administrators and school leadership', () => {
    const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

    // A missing role guard here would let any teacher mint credentials for any account.
    for (const route of ['/users', '/admin/temporary-password', '/request-reset']) {
      const routeBlock = new RegExp(
        `fastify\\.(?:get|post)\\(\\s*['"]${route.replace('/', '\\/')}['"][\\s\\S]*?\\n  \\);`,
      ).exec(source);
      expect(routeBlock, `no handler found for ${route}`).toBeTruthy();
      expect(routeBlock![0]).toMatch(/requireAccountAdministrator/);
    }
  });

  it('allows administrators without a teacher lookup', async () => {
    const req = {} as FastifyRequest;
    const calls: Array<{ status?: number; body?: unknown }> = [];
    const reply = {
      status: (code: number) => {
        calls.push({ status: code });
        return reply;
      },
      send: (body: unknown) => {
        calls.push({ body });
        return reply;
      },
    } as unknown as FastifyReply;
    const lookup = vi.fn();

    const handler = buildRequireAccountAdministrator(
      async () => ({ id: 'admin-1', username: 'admin', role: 'admin' }),
      lookup as any,
    );
    await (handler as any)(req, reply);

    expect(req.authUser?.role).toBe('admin');
    expect(lookup).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it('allows the school leadership (MED/SLC) through the teacher row', async () => {
    const req = {} as FastifyRequest;
    const calls: Array<{ status?: number; body?: unknown }> = [];
    const reply = {
      status: (code: number) => {
        calls.push({ status: code });
        return reply;
      },
      send: (body: unknown) => {
        calls.push({ body });
        return reply;
      },
    } as unknown as FastifyReply;

    const handler = buildRequireAccountAdministrator(
      async () => ({ id: 't-1', username: 'muster', role: 'teacher', teacherId: 42 }),
      async () => ({ shortName: 'SLC' }) as any,
    );
    await (handler as any)(req, reply);

    expect(req.authUser?.role).toBe('teacher');
    expect(calls).toEqual([]);
  });

  it('keeps ordinary teachers out of account administration', async () => {
    const req = {} as FastifyRequest;
    const calls: Array<{ status?: number; body?: unknown }> = [];
    const reply = {
      status: (code: number) => {
        calls.push({ status: code });
        return reply;
      },
      send: (body: unknown) => {
        calls.push({ body });
        return reply;
      },
    } as unknown as FastifyReply;

    const handler = buildRequireAccountAdministrator(
      async () => ({ id: 't-2', username: 'lehrer', role: 'teacher', teacherId: 7 }),
      async () => ({ shortName: 'AUT' }) as any,
    );
    await (handler as any)(req, reply);

    expect(calls).toEqual([
      { status: 403 },
      { body: { error: 'Für diese Aktion fehlt Ihnen die Berechtigung.' } },
    ]);
  });

  it('fails closed on an unverifiable token', async () => {
    const req = {} as FastifyRequest;
    const calls: Array<{ status?: number; body?: unknown }> = [];
    const reply = {
      status: (code: number) => {
        calls.push({ status: code });
        return reply;
      },
      send: (body: unknown) => {
        calls.push({ body });
        return reply;
      },
    } as unknown as FastifyReply;

    const handler = buildRequireAccountAdministrator(async () => {
      throw new Error('bad token');
    });
    await (handler as any)(req, reply);

    expect(calls).toEqual([{ status: 401 }, { body: { error: 'Nicht authentifiziert' } }]);
  });

  it('never selects or returns the password hash', () => {
    const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
    const usersRoute = /fastify\.get\(\s*['"]\/users['"][\s\S]*?\n  \);/.exec(source);
    expect(usersRoute).toBeTruthy();
    // The account list must not even SELECT passwordHash, so a later edit that forwards
    // the row cannot leak it.
    expect(usersRoute![0]).not.toMatch(/passwordHash/);
  });

  it('issues a random one-time credential and requires changing it', () => {
    const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
    const issueRoute = /fastify\.post\(\s*['"]\/admin\/temporary-password['"][\s\S]*?\n  \);/.exec(source);
    expect(issueRoute).toBeTruthy();
    const block = issueRoute![0];

    // Generated per issuance. A constant would make every reset account share one
    // published password again, which is the defect this route exists to avoid.
    expect(block).toContain('const temporaryPassword = generateTemporaryPassword();');
    expect(block).not.toMatch(/smile2026/);
    expect(source).toMatch(
      /import \{ generateTemporaryPassword \} from '\.\.\/lib\/temporary-credential\.js';/,
    );
    expect(block).toContain('passwordHash: await bcrypt.hash(temporaryPassword, BCRYPT_ROUNDS)');
    expect(block).toContain('mustChangePassword: true');
    expect(block).toContain('sessionVersion: sql`${users.sessionVersion} + 1`');
    expect(block).toContain('closeUserWebSockets(user.id)');
    expect(block).toContain('temporaryPassword,');
  });

  it('rejects keeping the one-time credential as the new password', () => {
    const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
    const passwordRoute = /fastify\.post\(\s*['"]\/password['"][\s\S]*?\n  \);/.exec(source);
    expect(passwordRoute).toBeTruthy();
    const block = passwordRoute![0];

    // Both branches must refuse a "change" that keeps the current hash: the client
    // checks this too, but a crafted request bypasses the UI, and whoever issued the
    // one-time credential would otherwise keep knowing an active password.
    const mustChangeBranch = /if \(user\.mustChangePassword\) \{([\s\S]*?)\n    \} else \{/.exec(block);
    expect(mustChangeBranch).toBeTruthy();
    expect(mustChangeBranch![1]).toContain('bcrypt.compare(newPassword, user.passwordHash)');
    expect(mustChangeBranch![1]).toContain('muss sich vom bisherigen unterscheiden');
  });

  it('never logs the issued credential', () => {
    const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');
    const issueRoute = /fastify\.post\(\s*['"]\/admin\/temporary-password['"][\s\S]*?\n  \);/.exec(source);
    expect(issueRoute).toBeTruthy();
    const block = issueRoute![0];
    // The plaintext must reach exactly one destination: the response body.
    expect(block).toMatch(/temporaryPassword/);
    const logCalls = block.match(/request\.log\.[a-z]+\(([\s\S]*?)\);/g) ?? [];
    for (const call of logCalls) {
      expect(call).not.toMatch(/temporaryPassword|smile2026/);
    }
  });

  it('verifies auth.ts does not return session token in login or password responses', () => {
    const authSource = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

    // /login response must not include token property
    const loginHandlerMatch = authSource.match(/fastify\.post\(\s*['"]\/login['"][\s\S]*?return reply\.send\((\{[\s\S]*?\})\);/);
    expect(loginHandlerMatch).toBeTruthy();
    const loginPayload = loginHandlerMatch![1];
    expect(loginPayload).not.toMatch(/\btoken\b/);

    // /password response must not include token property
    const passwordHandlerMatch = authSource.match(/fastify\.post\(\s*['"]\/password['"][\s\S]*?return reply\.send\((\{[\s\S]*?\})\);/);
    expect(passwordHandlerMatch).toBeTruthy();
    const passwordPayload = passwordHandlerMatch![1];
    expect(passwordPayload).not.toMatch(/\btoken\b/);

    // Ensure HttpOnly cookies are used instead
    expect(authSource).toContain('setSessionCookie(reply, token)');
  });
});
