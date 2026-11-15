import { describe, expect, it, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebUntisClient } from '../lib/webuntis/client.js';
import { userWebuntisAccounts } from '../db/schema.js';

const mockState = vi.hoisted(() => ({
  accountRow: null as Record<string, unknown> | null,
}));

vi.mock('../db/index.js', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('../db/index.js')>()),
    db: {
      select: () => ({
        from: (tbl: unknown) => ({
          where: () => ({
            limit: () => (tbl === userWebuntisAccounts && mockState.accountRow ? [mockState.accountRow] : []),
          }),
        }),
      }),
      insert: (tbl: unknown) => ({
        values: (val: Record<string, unknown>) => {
          if (tbl === userWebuntisAccounts) {
            mockState.accountRow = {
              ...val,
              lastVerifiedAt: new Date(),
            };
          }
          return {
            onConflictDoUpdate: () => Promise.resolve(),
            then: (resolve: any) => Promise.resolve().then(resolve),
          };
        },
      }),
      delete: (tbl: unknown) => ({
        where: () => {
          if (tbl === userWebuntisAccounts) {
            mockState.accountRow = null;
          }
          return Promise.resolve();
        },
      }),
    },
    getPool: vi.fn(),
  };
});

const TEST_ENV = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
  SUBMISSION_DEADLINE: '2099-01-01T00:00:00.000Z',
};

describe('WebUntis Account Connection Routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV);
    const { buildServer } = await import('../index.js');
    app = await buildServer(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns connected: false when no personal account is linked', async () => {
    mockState.accountRow = null;
    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/webuntis/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.connected).toBe(false);
  });

  it('rejects connection when credentials cannot be verified', async () => {
    vi.spyOn(WebUntisClient, 'verifyCredentials').mockResolvedValueOnce({
      valid: false,
      personId: 0,
      personType: 0,
      error: 'Ungültige WebUntis-Anmeldedaten.',
    });

    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webuntis/account/connect',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        username: 'wrong_user',
        secret: 'wrong_pass',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/Ungültige/);
  });

  it('rejects a WebUntis account that belongs to a different teacher', async () => {
    vi.spyOn(WebUntisClient, 'verifyCredentials').mockResolvedValueOnce({
      valid: true,
      personId: 999,
      personType: 2,
      teacherShort: 'AND',
    });

    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webuntis/account/connect',
      headers: { authorization: `Bearer ${token}` },
      payload: { username: 'other.teacher', secret: 'ValidSecret123!' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects non-teacher WebUntis accounts', async () => {
    vi.spyOn(WebUntisClient, 'verifyCredentials').mockResolvedValueOnce({
      valid: true,
      personId: 242,
      personType: 1,
      teacherShort: 'OFJ',
    });

    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webuntis/account/connect',
      headers: { authorization: `Bearer ${token}` },
      payload: { username: 'pupil.account', secret: 'ValidSecret123!' },
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects a host outside the WebUntis allowlist before contacting it', async () => {
    const verifySpy = vi.spyOn(WebUntisClient, 'verifyCredentials');

    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webuntis/account/connect',
      headers: { authorization: `Bearer ${token}` },
      payload: { server: '169.254.169.254', username: 'max', secret: 'ValidSecret123!' },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).code).toBe('WEBUNTIS_HOST_NOT_ALLOWED');
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('connects successfully and stores encrypted credentials when verified', async () => {
    vi.spyOn(WebUntisClient, 'verifyCredentials').mockResolvedValueOnce({
      valid: true,
      personId: 242,
      personType: 2,
      teacherShort: 'OFJ',
      teacherName: 'Max Mustermann',
    });

    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webuntis/account/connect',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        server: 'ms-telfs.webuntis.com',
        school: 'ms-telfs',
        username: 'max.mustermann',
        secret: 'ValidSecret123!',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(body.teacherShort).toBe('OFJ');
    expect(body.personId).toBe(242);
    expect(mockState.accountRow).not.toBeNull();
  });

  it('returns connected: true after account is linked', async () => {
    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'GET',
      url: '/api/webuntis/account',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.connected).toBe(true);
    expect(body.account.teacherShort).toBe('OFJ');
  });

  it('disconnects the account on demand', async () => {
    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webuntis/account/disconnect',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    expect(mockState.accountRow).toBeNull();
  });

  it('rejects outbox retry when no personal account is connected', async () => {
    mockState.accountRow = null;
    const token = app.jwt.sign({ id: '00000000-0000-0000-0000-000000000001', role: 'teacher', username: 'OFJ', teacherId: 242 });

    const res = await app.inject({
      method: 'POST',
      url: '/api/webuntis/outbox/retry',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('WEBUNTIS_NOT_CONNECTED');
  });
});
