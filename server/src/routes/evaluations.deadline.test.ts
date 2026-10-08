import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-deadline-tests',
  SUBMISSION_DEADLINE: '2000-01-01T00:00:00.000Z',
  CORS_ALLOWED_ORIGINS: '',
};

let app: FastifyInstance | null = null;
let savedEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  savedEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);
  const { buildServer } = await import('../index.js');
  app = await buildServer(async () => ({ sessionVersion: 0, mustChangePassword: false }));
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe('status deadline enforcement', () => {
  it.each([
    { proposedStatus: 'Meister' },
    { nextStep: 'Weiterarbeiten' },
    { proposedStatus: null },
  ])('rejects rank/next-step fields after the rating deadline: %o', async (fields) => {
    const token = app!.jwt.sign({
      id: 'deadline-teacher',
      username: 'teacher',
      role: 'teacher',
      teacherId: 101,
      mustChangePassword: false,
    });
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { cookie: `smile_session=${token}` },
      payload: { pupilId: 1, classId: 101, subjectCode: 'D', ...fields },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('Abgabefrist ist abgelaufen.');
  });
});
