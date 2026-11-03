import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';

/**
 * End-to-end check that the WebSocket upgrade is refused without a session.
 *
 * This is the highest-severity finding from the audit: `/ws` was registered with no
 * authentication at all, so anyone able to reach the port could open a socket, receive
 * every live broadcast, and write observation ratings.
 *
 * @fastify/websocket runs route preHandlers during the HTTP upgrade, so an
 * unauthenticated handshake must fail at the HTTP layer rather than opening a socket.
 */
const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
  // Keep the heartbeat out of the way of the assertions.
  WS_ROOM_MAX_CLIENTS: '200',
};

let app: FastifyInstance | null = null;
let baseUrl = '';

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('../index.js');
  try {
    app = await buildServer();
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;
    baseUrl = `ws://127.0.0.1:${port}`;
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in TEST_ENV)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
});

/** Open a socket and resolve once it is open or once it errors/closes. */
function tryConnect(url: string, headers: Record<string, string> = {}): Promise<{
  opened: boolean;
  statusCode?: number;
  error?: string;
}> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url, { headers });
    let settled = false;

    const finish = (result: { opened: boolean; statusCode?: number; error?: string }) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {
        /* already closing */
      }
      resolve(result);
    };

    ws.on('open', () => finish({ opened: true }));
    ws.on('unexpected-response', (_req: unknown, res: { statusCode?: number }) => {
      finish({ opened: false, statusCode: res.statusCode });
    });
    ws.on('error', (err: Error & { statusCode?: number }) => {
      finish({ opened: false, error: err.message, statusCode: err.statusCode });
    });
  });
}

describe('websocket handshake requires authentication', () => {
  it('refuses an unauthenticated connection', async () => {
    const result = await tryConnect(`${baseUrl}/ws`);

    expect(result.opened, 'socket must not open without a session').toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it('refuses a connection carrying a garbage token', async () => {
    const result = await tryConnect(`${baseUrl}/ws`, {
      Cookie: 'smile_session=not-a-real-jwt',
    });

    expect(result.opened).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it('refuses a token signed with the wrong key', async () => {
    // A structurally valid HS256 token, but signed with an attacker-chosen secret.
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(
      JSON.stringify({
        id: '00000000-0000-0000-0000-000000000001',
        username: 'mallory',
        role: 'admin',
        teacherId: null,
      }),
    ).toString('base64url');
    const forged = `${header}.${payload}.` + 'A'.repeat(43);

    const result = await tryConnect(`${baseUrl}/ws`, {
      Cookie: `smile_session=${forged}`,
    });

    expect(result.opened).toBe(false);
    expect(result.statusCode).toBe(401);
  });

  it('refuses an empty-cookie connection', async () => {
    const result = await tryConnect(`${baseUrl}/ws`, { Cookie: 'smile_session=' });

    expect(result.opened).toBe(false);
    expect(result.statusCode).toBe(401);
  });
});