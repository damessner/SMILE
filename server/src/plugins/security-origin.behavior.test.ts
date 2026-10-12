import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import Fastify from 'fastify';

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-origin-tests',
  CORS_ALLOWED_ORIGINS: '',
  TRUST_PROXY: 'false',
  COOKIE_SECURE: 'false',
};

let app: FastifyInstance | null = null;
let savedEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  savedEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);
  const { buildServer } = await import('../index.js');
  app = await buildServer();
});

afterAll(async () => {
  if (app) await app.close();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

describe('same-origin security hook with an empty allowlist', () => {
  it('rejects a foreign state-changing request', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { origin: 'https://evil.example' },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('lets the exact request origin reach route validation', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: 'smile.school.local:3000',
        origin: 'http://smile.school.local:3000',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).not.toContain('Cross-Origin');
  });

  it('does not let a spoofed X-Forwarded-Host authorize a foreign origin', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        host: 'smile.school.local:3000',
        'x-forwarded-host': 'evil.example',
        origin: 'http://evil.example',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(403);
  });

  it('rejects a foreign-origin WebSocket upgrade before authentication', async () => {
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
  });

  it('does not write Origin or query-string values into cross-origin warning logs', async () => {
    const logLines: string[] = [];
    const logger = Fastify({
      logger: {
        level: 'warn',
        stream: { write: (line: string) => logLines.push(line) },
      },
    });
    const { securityPlugin } = await import('./security.js');
    await logger.register(securityPlugin);
    logger.post('/log-redaction', async () => ({ ok: true }));
    await logger.ready();

    try {
      const marker = 'synthetic-log-marker';
      const res = await logger.inject({
        method: 'POST',
        url: `/log-redaction?marker=${marker}`,
        headers: { origin: `https://evil.example/?marker=${marker}` },
      });

      expect(res.statusCode).toBe(403);
      expect(logLines.join('')).not.toContain(marker);
    } finally {
      await logger.close();
    }
  });
});
