import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('./index.js');
  try {
    app = await buildServer();
  } finally {
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

  it('does not apply the origin check to safe methods', async () => {
    const res = await app!.inject({
      method: 'GET',
      url: '/api/classes',
      headers: { origin: 'https://evil.example' },
    });
    expect(res.statusCode).toBe(401);
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