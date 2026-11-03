import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const { state, auditRows, signed } = vi.hoisted(() => ({
  state: { users: [] as Array<Record<string, unknown>> },
  auditRows: [] as Array<Record<string, unknown>>,
  signed: {
    payload: null as Record<string, unknown> | null,
    options: null as Record<string, unknown> | null,
  },
}));

// The routes under test only read users by username/id and insert audit rows.
vi.mock('../db/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index.js')>();
  const { getTableName } = await import('drizzle-orm');
  let source = '';
  const query: any = {
    from(table: unknown) {
      source = getTableName(table as never);
      return query;
    },
    where() {
      return query;
    },
    limit(count: number) {
      const rows = source === 'users' ? state.users : [];
      return Promise.resolve(rows.slice(0, count));
    },
  };
  return {
    ...actual,
    db: {
      select: () => query,
      insert: (table: unknown) => ({
        values: async (data: Record<string, unknown>) => {
          auditRows.push({ table: getTableName(table as never), ...data });
        },
      }),
    },
  };
});

import { buildSessionGuard, type AuthUser } from '../lib/guards.js';

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
};

const MED: AuthUser = {
  id: 'med-user-id',
  username: 'med',
  role: 'head_teacher',
  teacherId: 183,
  mustChangePassword: false,
  sessionVersion: 0,
};

const TARGET_ROW = {
  id: 'target-user-id',
  username: 'lom',
  role: 'teacher',
  teacherId: 265,
  pupilId: null,
  passwordHash: 'x',
  mustChangePassword: true,
  sessionVersion: 3,
  createdAt: new Date(),
};

const TARGET_USER: AuthUser = {
  id: 'target-user-id',
  username: 'lom',
  role: 'teacher',
  teacherId: 265,
  mustChangePassword: true,
  sessionVersion: 3,
};

let app: FastifyInstance;
let savedEnvironment: NodeJS.ProcessEnv;
let currentUser: AuthUser = MED;

function replyStub() {
  const reply: any = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(body: unknown) {
      this.payload = body;
      return this;
    },
    clearCookie() {
      return this;
    },
  };
  return reply as FastifyReply & { statusCode: number; payload: unknown };
}

beforeAll(async () => {
  savedEnvironment = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const Fastify = (await import('fastify')).default;
  const fastifyCookie = (await import('@fastify/cookie')).default;
  const { authRoutes } = await import('./auth.js');

  app = Fastify({ logger: false });
  await app.register(fastifyCookie);
  app.decorate('jwt', {
    sign: (payload: Record<string, unknown>, options: Record<string, unknown>) => {
      signed.payload = payload;
      signed.options = options;
      return 'view-as-token';
    },
  } as any);
  app.decorate('authenticate', async (request: any) => {
    request.authUser = currentUser;
  });
  app.decorate('requireAccountAdministrator', async (request: any) => {
    request.authUser = currentUser;
  });
  app.decorate('rateLimitLoginMax', 1000);
  app.decorate('rateLimitLoginWindowSeconds', 60);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app?.close();
  process.env = savedEnvironment;
});

beforeEach(() => {
  state.users = [];
  auditRows.length = 0;
  signed.payload = null;
  signed.options = null;
  currentUser = MED;
});

describe('POST /api/auth/view-as', () => {
  it('issues a short-lived read-only token and parks the viewer session', async () => {
    state.users = [TARGET_ROW];
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/view-as',
      payload: { username: ' LOM ' },
      cookies: { smile_session: 'original-token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ success: true, username: 'lom', viewAs: true });
    expect(signed.payload).toMatchObject({
      id: 'target-user-id',
      username: 'lom',
      role: 'teacher',
      teacherId: 265,
      viewAs: true,
      act: 'med-user-id',
      actUsername: 'med',
      mustChangePassword: false,
      sessionVersion: 3,
    });
    expect(signed.options).toEqual({ expiresIn: '45m' });

    const cookies = res.cookies.map((cookie) => ({ name: cookie.name, value: cookie.value }));
    expect(cookies).toContainEqual({ name: 'smile_view_as_backup', value: 'original-token' });
    expect(cookies).toContainEqual({ name: 'smile_session', value: 'view-as-token' });
    expect(auditRows).toEqual([
      expect.objectContaining({
        table: 'audit_logs',
        action: 'VIEW_AS_STARTED',
        entity: 'user',
        entityId: 'target-user-id',
        actorId: 183,
        payload: { targetUsername: 'lom', by: 'med' },
      }),
    ]);
  });

  it('refuses to open the viewer\'s own account', async () => {
    state.users = [{ ...TARGET_ROW, id: 'med-user-id', username: 'med', role: 'head_teacher' }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/view-as',
      payload: { username: 'med' },
    });
    expect(res.statusCode).toBe(400);
    expect(signed.payload).toBeNull();
  });

  it('refuses administrator accounts', async () => {
    state.users = [{ ...TARGET_ROW, role: 'admin' }];
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/view-as',
      payload: { username: 'lom' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 404 for unknown accounts', async () => {
    state.users = [];
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/view-as',
      payload: { username: 'ghost' },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('POST /api/auth/view-as/stop', () => {
  it('restores the parked viewer session and records the stop', async () => {
    currentUser = {
      ...TARGET_USER,
      viewAs: true,
      act: 'med-user-id',
      actUsername: 'med',
      mustChangePassword: false,
    };
    state.users = [{ ...TARGET_ROW, id: 'med-user-id', username: 'med', role: 'head_teacher', teacherId: 183 }];

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/view-as/stop',
      cookies: { smile_session: 'view-as-token', smile_view_as_backup: 'original-token' },
    });

    expect(res.statusCode).toBe(200);
    const cookies = res.cookies.map((cookie) => ({ name: cookie.name, value: cookie.value }));
    expect(cookies).toContainEqual({ name: 'smile_session', value: 'original-token' });
    expect(auditRows).toEqual([
      expect.objectContaining({
        action: 'VIEW_AS_STOPPED',
        entityId: 'target-user-id',
        actorId: 183,
        payload: { targetUsername: 'lom', by: 'med' },
      }),
    ]);
  });

  it('rejects a stop request when no view is active', async () => {
    currentUser = MED;
    const res = await app.inject({ method: 'POST', url: '/api/auth/view-as/stop' });
    expect(res.statusCode).toBe(400);
  });
});

describe('session guard: read-only while "Ansehen als" is active', () => {
  const activeState = { sessionVersion: 3, mustChangePassword: true, teacherActive: true };
  const guard = buildSessionGuard(async () => activeState);

  function request(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
    return {
      method: 'GET',
      url: '/api/classes',
      authUser: {
        ...TARGET_USER,
        viewAs: true,
        act: 'med-user-id',
        actUsername: 'med',
        actSessionVersion: 3,
        sessionVersion: 3,
      },
      ...overrides,
    } as unknown as FastifyRequest;
  }

  it('lets GET requests through (even when the target still has a start password)', async () => {
    const reply = replyStub();
    await (guard as any)(request() as never, reply as never, () => {});
    expect(reply.payload).toBeUndefined();
  });

  it('blocks writes with VIEW_AS_READ_ONLY', async () => {
    const reply = replyStub();
    await (guard as any)(request({ method: 'POST', url: '/api/evaluations/1/items' } as never) as never, reply as never, () => {});
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ code: 'VIEW_AS_READ_ONLY' });
  });

  it('allows the stop route', async () => {
    const reply = replyStub();
    await (guard as any)(request({ method: 'POST', url: '/api/auth/view-as/stop' } as never) as never, reply as never, () => {});
    expect(reply.payload).toBeUndefined();
  });

  it('keeps blocking non-view-as users with a pending password change', async () => {
    const reply = replyStub();
    await (guard as any)(
      request({ authUser: { ...TARGET_USER, viewAs: false, sessionVersion: 3 } } as never) as never,
      reply as never,
      () => {},
    );
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ code: 'PASSWORD_CHANGE_REQUIRED' });
  });
});
