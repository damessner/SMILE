import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Server construction and route-protection smoke test.
 *
 * Credentials must be set before importing the server, because config.ts resolves and
 * validates them at import time. They are syntactically valid but point at a closed
 * port, so no query is ever issued — the pool is lazy.
 */
const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  // Keep dotenv from loading the developer's real .env over these values.
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
};

let app: FastifyInstance | null = null;
let ajvStrictWarnings: string[] = [];
const sessionStateReader = vi.fn(async (_userId: string) => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('./index.js');
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    const warning = args.map(String).join(' ');
    if (warning.includes('strict mode: use allowUnionTypes')) ajvStrictWarnings.push(warning);
  });
  try {
    app = await buildServer(sessionStateReader);
    await app.ready();
  } finally {
    warnSpy.mockRestore();
    // Restore immediately; the modules have already captured what they need.
    for (const key of Object.keys(process.env)) {
      if (!(key in TEST_ENV)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
});

/**
 * Every endpoint that touches pupil data must reject an unauthenticated request.
 *
 * This is checked over HTTP rather than by inspecting the route table, because it
 * verifies two things at once: the route exists, and it is actually protected. A route
 * that is registered but unguarded is the exact class of defect this audit found.
 */
const PROTECTED_ENDPOINTS: Array<{ method: 'GET' | 'POST' | 'PUT' | 'DELETE'; url: string }> = [
  { method: 'GET', url: '/api/auth/me' },
  { method: 'GET', url: '/api/auth/session' },
  { method: 'POST', url: '/api/auth/password' },
  { method: 'POST', url: '/api/auth/request-reset' },
  { method: 'GET', url: '/api/classes' },
  { method: 'GET', url: '/api/classes/1/pupils' },
  { method: 'GET', url: '/api/classes/1/rubric' },
  { method: 'POST', url: '/api/pupils' },
  { method: 'PUT', url: '/api/pupils/1' },
  { method: 'DELETE', url: '/api/pupils/1' },
  { method: 'POST', url: '/api/cards' },
  { method: 'PUT', url: '/api/cards/00000000-0000-0000-0000-000000000000/note' },
  { method: 'POST', url: '/api/cards/00000000-0000-0000-0000-000000000000/revoke' },
  { method: 'GET', url: '/api/cards/alerts' },
  { method: 'GET', url: '/api/cards/class/1' },
  { method: 'GET', url: '/api/cards/pupil/1' },
  { method: 'POST', url: '/api/evaluations/status' },
  { method: 'POST', url: '/api/evaluations/submit' },
  { method: 'POST', url: '/api/evaluations/reopen' },
  { method: 'POST', url: '/api/evaluations/batch-items' },
  { method: 'POST', url: '/api/evaluations/batch-default' },
  { method: 'POST', url: '/api/conferences/1/lock' },
  { method: 'POST', url: '/api/conferences/1/vote' },
  { method: 'POST', url: '/api/conferences/1/vote-all' },
  { method: 'GET', url: '/api/conferences/1/summary' },
  { method: 'GET', url: '/api/statistics/overview' },
  { method: 'GET', url: '/api/statistics/rubric' },
  { method: 'GET', url: '/api/timetable/current' },
  { method: 'GET', url: '/api/timetable/teacher/1' },
  { method: 'POST', url: '/api/timeouts' },
  { method: 'GET', url: '/api/timeouts/active' },
  { method: 'GET', url: '/api/timeouts/history' },
  { method: 'GET', url: '/api/timeouts/escalations' },
  {
    method: 'POST',
    url: '/api/timeouts/escalations/acknowledge',
  },
  { method: 'GET', url: '/api/backup/export-json' },
  { method: 'GET', url: '/api/backup/verify' },
  { method: 'GET', url: '/api/backup/audit-log' },
];

describe('server construction', () => {
  it('builds without throwing', () => {
    expect(app).toBeTruthy();
  });

  it('serves an unauthenticated health probe', async () => {
    const res = await app!.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('registers all route schemas without AJV strict union warnings', () => {
    expect(ajvStrictWarnings).toEqual([]);
  });
});

describe('authentication is enforced on every pupil-data endpoint', () => {
  for (const { method, url } of PROTECTED_ENDPOINTS) {
    it(`${method} ${url} rejects an unauthenticated request`, async () => {
      const res = await app!.inject({ method, url, payload: {} });
      expect(res.statusCode, `${method} ${url} should be 401`).toBe(401);
      expect(res.json().error).toBe('Nicht authentifiziert');
    });
  }
});

describe('durable session guard ordering', () => {
  it('checks durable sessions after route-level authentication', async () => {
    const token = app!.jwt.sign({
      id: 'ordering-user',
      username: 'ordering-user',
      role: 'teacher',
      mustChangePassword: false,
      sessionVersion: 0,
    });

    const res = await app!.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: `smile_session=${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(sessionStateReader).toHaveBeenCalledWith('ordering-user');
  });

  it('rejects a stale admin session before the role-protected backup handler runs', async () => {
    sessionStateReader.mockImplementation(async (userId) => ({
      sessionVersion: userId === 'revoked-admin' ? 1 : 0,
      mustChangePassword: false,
      teacherActive: true,
    }));
    try {
      const token = app!.jwt.sign({
        id: 'revoked-admin',
        username: 'admin',
        role: 'admin',
        mustChangePassword: false,
        sessionVersion: 0,
      });
      const res = await app!.inject({
        method: 'GET',
        url: '/api/backup/export-json',
        headers: { cookie: `smile_session=${token}` },
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('Nicht authentifiziert');
    } finally {
      sessionStateReader.mockImplementation(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
    }
  });

  it('does not let an admin with a pending password reset issue another reset', async () => {
    sessionStateReader.mockImplementation(async (userId) => ({
      sessionVersion: userId === 'reset-required-admin' ? 1 : 0,
      mustChangePassword: userId === 'reset-required-admin',
      teacherActive: true,
    }));
    try {
      const token = app!.jwt.sign({
        id: 'reset-required-admin',
        username: 'admin',
        role: 'admin',
        mustChangePassword: false,
        sessionVersion: 0,
      });
      const res = await app!.inject({
        method: 'POST',
        url: '/api/auth/request-reset',
        headers: { cookie: `smile_session=${token}` },
        payload: { username: 'another-teacher' },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('Passwort');
    } finally {
      sessionStateReader.mockImplementation(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
    }
  });

  it('blocks roster reads while a stale token awaits a required password change', async () => {
    sessionStateReader.mockImplementation(async (userId) => ({
      sessionVersion: userId === 'reset-pending-teacher' ? 1 : 0,
      mustChangePassword: userId === 'reset-pending-teacher',
      teacherActive: true,
    }));
    try {
      const token = app!.jwt.sign({
        id: 'reset-pending-teacher',
        username: 'teacher',
        role: 'teacher',
        teacherId: 101,
        mustChangePassword: false,
        sessionVersion: 0,
      });
      const res = await app!.inject({
        method: 'GET',
        url: '/api/classes/501/pupils',
        headers: { cookie: `smile_session=${token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('PASSWORD_CHANGE_REQUIRED');
    } finally {
      sessionStateReader.mockImplementation(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
    }
  });
});

describe('safe server error logging', () => {
  it('keeps error metadata but omits message and stack contents', async () => {
    const { safeErrorLogFields } = await import('./index.js');
    const error = Object.assign(new Error('private query values'), { statusCode: 500 });

    const fields = safeErrorLogFields(error as any);

    expect(fields).toEqual({ errorType: 'Error', statusCode: 500 });
    expect(JSON.stringify(fields)).not.toContain('private query values');
  });
});

describe('explicit bulk rating overwrite', () => {
  it('rejects a class-default write unless overwrite intent is explicit', async () => {
    const token = app!.jwt.sign({
      id: 'bulk-default-user',
      username: 'teacher',
      role: 'teacher',
      teacherId: 101,
      mustChangePassword: false,
      sessionVersion: 0,
    });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/batch-default',
      headers: { cookie: `smile_session=${token}` },
      payload: { classId: 1, subjectCode: 'D', defaultRating: '+' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('VALIDATION_ERROR');
  });
});

describe('hardening response headers', () => {
  it('sets the security headers on a normal response', async () => {
    const res = await app!.inject({ method: 'GET', url: '/health' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('same-origin');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    // Pupil data must never be cached by an intermediary.
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('sets the security headers on an unauthenticated 401 too', async () => {
    const res = await app!.inject({ method: 'GET', url: '/api/classes' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('CSRF origin check', () => {
  it('blocks a state-changing request from a disallowed origin', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: 'x', password: 'y' },
    });
    // Rejected before authentication, so this is the Origin guard rather than a 401.
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Cross-Origin');
  });

  it('allows a state-changing request from the allowlisted origin', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'http://localhost:5173' },
      payload: {},
    });
    // Passes the Origin guard; fails later on the missing body (400).
    expect(res.statusCode).toBe(400);
  });

  it('blocks WebSocket upgrade from a disallowed origin', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: '/ws',
      headers: {
        origin: 'https://evil.example',
        upgrade: 'websocket',
        connection: 'Upgrade',
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Cross-Origin');
  });

  it('does not apply the origin check to safe methods', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: '/api/classes',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('allows a no-Origin bearer client through to authenticated route validation', async () => {
    const token = app!.jwt.sign({
      id: 'cli-user',
      username: 'service-client',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { authorization: `Bearer ${token}` },
      payload: { pupilId: 1, classId: 1, subjectCode: 'Astronomie' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Ungültiges Unterrichtsfach.');
  });
});

describe('isAllowedOrigin policy', () => {
  it('rejects foreign origin when allowlist is empty and allows same-origin', async () => {
    const { isAllowedOrigin } = await import('./plugins/security.js');
    const fakeReq = { protocol: 'http', headers: { host: 'smile.school.local:3000' } } as any;
    expect(isAllowedOrigin('https://evil.example', fakeReq, [])).toBe(false);
    expect(isAllowedOrigin('http://smile.school.local:3000', fakeReq, [])).toBe(true);
    expect(isAllowedOrigin(undefined, fakeReq, [])).toBe(true);
  });

  it('requires the exact scheme and host but always permits the actual same origin', async () => {
    const { isAllowedOrigin } = await import('./plugins/security.js');
    const fakeReq = {
      protocol: 'https',
      headers: { host: 'smile.school.local:3000' },
    } as any;

    expect(isAllowedOrigin('http://smile.school.local:3000', fakeReq, [])).toBe(false);
    expect(isAllowedOrigin('https://smile.school.local:3000', fakeReq, [])).toBe(true);
    // A split-origin allowlist adds origins; it must not disable the server's own origin.
    expect(isAllowedOrigin('https://smile.school.local:3000', fakeReq, ['http://localhost:5173'])).toBe(true);
  });

  it('does not trust X-Forwarded-Host unless the trusted-proxy option is enabled', async () => {
    const { isAllowedOrigin } = await import('./plugins/security.js');
    const fakeReq = {
      protocol: 'http',
      headers: {
        host: 'smile.school.local:3000',
        'x-forwarded-host': 'evil.example',
      },
    } as any;

    expect(isAllowedOrigin('http://evil.example', fakeReq, [])).toBe(false);
    expect(isAllowedOrigin('http://smile.school.local:3000', fakeReq, [])).toBe(true);
  });
});

describe('login validation', () => {
  it('rejects a missing body with 400, not 500', async () => {
    const res = await app!.inject({ method: 'POST', url: '/api/auth/login', payload: {} });
    expect(res.statusCode).toBe(400);
  });

  it('returns a generic error for unknown credentials', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'definitely-not-a-user', password: 'definitely-not-a-password' },
    });
    // Reaches the database, which is unreachable here, so a 500 is acceptable. What
    // matters is that it does not succeed and does not leak whether the user exists.
    expect([401, 500, 503]).toContain(res.statusCode);
    if (res.statusCode >= 500) {
      expect(res.json()).toMatchObject({
        error: 'Ein interner Serverfehler ist aufgetreten. Bitte versuchen Sie es später erneut.',
        code: 'INTERNAL_SERVER_ERROR',
      });
      expect(res.json().correlationId).toBeTruthy();
      expect(res.body).not.toContain('postgres://');
    }
  });
});

describe('conference request body validation (Task 2.4)', () => {
  const adminToken = () => app!.jwt.sign(
    { id: 'admin-validation', username: 'admin', role: 'admin', mustChangePassword: false },
    { expiresIn: '1h' },
  );

  it('rejects a string pupilId on /vote before querying the database', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote',
      headers: { cookie: `smile_session=${adminToken()}` },
      payload: { pupilId: '1', rank: 'Meister' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Ungültige Eingabedaten.', code: 'VALIDATION_ERROR' });
  });

  it('rejects malformed batch item ids on /vote-all before querying the database', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote-all',
      headers: { cookie: `smile_session=${adminToken()}` },
      payload: { items: [{ pupilId: '1', rank: 'Meister', votesNo: 0 }] },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Ungültige Eingabedaten.', code: 'VALIDATION_ERROR' });
  });

  it('rejects unexpected properties on /lock instead of ignoring them', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/conferences/1/lock',
      headers: { cookie: `smile_session=${adminToken()}` },
      payload: { isLocked: true, classId: 2 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Ungültige Eingabedaten.', code: 'VALIDATION_ERROR' });
  });

  it('does not coerce a JSON string id into an integer', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { cookie: `smile_session=${adminToken()}` },
      payload: { pupilId: '1', classId: 1, subjectCode: 'D' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Ungültige Eingabedaten.', code: 'VALIDATION_ERROR' });
  });

  it('rejects integer ids outside the PostgreSQL integer range', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { cookie: `smile_session=${adminToken()}` },
      payload: { pupilId: 2147483648, classId: 1, subjectCode: 'D' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Ungültige Eingabedaten.', code: 'VALIDATION_ERROR' });
  });

  it('rejects an oversized comment before the database write path', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { cookie: `smile_session=${adminToken()}` },
      payload: {
        pupilId: 1,
        classId: 1,
        subjectCode: 'D',
        comment: 'x'.repeat(2001),
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Ungültige Eingabedaten.', code: 'VALIDATION_ERROR' });
  });

  it('bounds the ignored client criterionId kept for rollout compatibility', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/batch-items',
      headers: { cookie: `smile_session=${adminToken()}` },
      payload: {
        pupilId: 1,
        classId: 1,
        subjectCode: 'D',
        items: [{ itemKey: 'org_1', rating: '+', version: 0, criterionId: 'x'.repeat(37) }],
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'Ungültige Eingabedaten.', code: 'VALIDATION_ERROR' });
  });
});

describe('error response safety (Task 2.4)', () => {
  it('returns a stable generic message for malformed JSON', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: '{"username":"bad","password":"marker-secret"broken',
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({
      error: 'Anfrage konnte nicht verarbeitet werden.',
      code: 'BAD_REQUEST',
    });
    expect(res.json().correlationId).toBeTruthy();
    expect(res.body).not.toContain('marker-secret');
  });
});

describe('dead code removal', () => {
  it('no longer exposes the conference override route that never existed', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/conferences/1/override',
      payload: {},
    });
    // The SPA fallback only serves non-/api paths, so an unknown API route is a 404.
    expect(res.statusCode).toBe(404);
  });
});

describe('timeouts escalation and active policy (Task 2.1 & 2.4)', () => {
  it('rejects negative, fractional, and non-multiple milestoneCount before database access', async () => {
    const adminToken = app!.jwt.sign(
      { id: 'admin-1', username: 'admin', role: 'admin', mustChangePassword: false },
      { expiresIn: '1h' },
    );

    // Negative milestone count (e.g. -3) was previously accepted because -3 % 3 === -0
    const resNegative = await app!.inject({
      method: 'POST',
      url: '/api/timeouts/escalations/acknowledge',
      headers: { cookie: `smile_session=${adminToken}` },
      payload: { pupilId: 1, milestoneCount: -3 },
    });
    expect(resNegative.statusCode).toBe(400);
    expect(resNegative.json()).toMatchObject({
      error: 'Ungültige Eingabedaten.',
      code: 'VALIDATION_ERROR',
    });

    // Float milestone
    const resFloat = await app!.inject({
      method: 'POST',
      url: '/api/timeouts/escalations/acknowledge',
      headers: { cookie: `smile_session=${adminToken}` },
      payload: { pupilId: 1, milestoneCount: 3.5 },
    });
    expect(resFloat.statusCode).toBe(400);
    expect(resFloat.json().code).toBe('VALIDATION_ERROR');

    // Non-multiple
    const resNonMultiple = await app!.inject({
      method: 'POST',
      url: '/api/timeouts/escalations/acknowledge',
      headers: { cookie: `smile_session=${adminToken}` },
      payload: { pupilId: 1, milestoneCount: 4 },
    });
    expect(resNonMultiple.statusCode).toBe(400);
    expect(resNonMultiple.json()).toMatchObject({
      error: 'Ungültige Eingabedaten.',
      code: 'VALIDATION_ERROR',
    });
  });

  it('rejects pupil role accessing /api/timeouts/active with 403', async () => {
    const pupilToken = app!.jwt.sign(
      { id: 'pupil-1', username: 'pupil', role: 'pupil', pupilId: 1, mustChangePassword: false },
      { expiresIn: '1h' },
    );

    const res = await app!.inject({
      method: 'GET',
      url: '/api/timeouts/active',
      headers: { cookie: `smile_session=${pupilToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
