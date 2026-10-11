import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-rate-limit-tests',
  CORS_ALLOWED_ORIGINS: '',
  GLOBAL_RATE_LIMIT_MAX: '1',
  GLOBAL_RATE_LIMIT_WINDOW_SECONDS: '60',
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

function tokenFor(id: string): string {
  return app!.jwt.sign({
    id,
    username: id,
    role: 'teacher',
    teacherId: 1,
    mustChangePassword: false,
  });
}

async function submitInvalidSubject(token: string) {
  return app!.inject({
    method: 'POST',
    url: '/api/evaluations/status',
    remoteAddress: '192.0.2.20',
    headers: { authorization: `Bearer ${token}` },
    payload: { pupilId: 1, classId: 1, subjectCode: 'Astronomie' },
  });
}

describe('global rate limit account buckets', () => {
  it('separates verified users sharing one IP and limits repeated requests per user', async () => {
    const userA = tokenFor('rate-user-a');
    const userB = tokenFor('rate-user-b');

    const firstA = await submitInvalidSubject(userA);
    const secondA = await submitInvalidSubject(userA);
    const firstB = await submitInvalidSubject(userB);

    expect(firstA.statusCode).toBe(400); // Reached the real route handler.
    expect(secondA.statusCode).toBe(429); // The same verified identity is throttled.
    expect(firstB.statusCode).toBe(400); // Same source IP, but a distinct account bucket.
  });
});
