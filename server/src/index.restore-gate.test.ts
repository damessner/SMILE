import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { endRestore, resetRestoreGateForTests, tryBeginRestore } from './lib/restore-lock.js';

/**
 * Restore write/WebSocket gate. While a restore holds the process-wide gate, the
 * onRequest hook in index.ts must refuse non-GET/HEAD requests and /ws requests with
 * 503 RESTORE_IN_PROGRESS, while GET/HEAD requests such as /health still pass.
 *
 * Setup mirrors index.test.ts: credentials are set before importing the server, and the
 * pool is lazy, so no database query is issued by these tests.
 */
const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
};

let app: FastifyInstance | null = null;
const sessionStateReader = vi.fn(async (_userId: string) => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('./index.js');
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    app = await buildServer(sessionStateReader);
    await app.ready();
  } finally {
    warnSpy.mockRestore();
    for (const key of Object.keys(process.env)) {
      if (!(key in TEST_ENV)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
});

afterEach(() => {
  resetRestoreGateForTests();
});

describe('restore write/WebSocket gate', () => {
  it('refuses a write request with 503 RESTORE_IN_PROGRESS while a restore holds the gate', async () => {
    expect(tryBeginRestore()).toBe(true);

    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'x', password: 'y' },
    });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('RESTORE_IN_PROGRESS');
  });

  it('keeps GET /health available while a restore holds the gate', async () => {
    expect(tryBeginRestore()).toBe(true);

    const res = await app!.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ok');
  });

  it('refuses a /ws request with 503 RESTORE_IN_PROGRESS while a restore holds the gate', async () => {
    expect(tryBeginRestore()).toBe(true);

    const res = await app!.inject({ method: 'GET', url: '/ws' });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('RESTORE_IN_PROGRESS');
  });

  it('no longer refuses the same write once the restore has ended', async () => {
    expect(tryBeginRestore()).toBe(true);
    endRestore();

    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'x', password: 'y' },
    });

    expect(res.statusCode).not.toBe(503);
  });
});
