import { readFileSync } from 'fs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';

const { state } = vi.hoisted(() => ({
  state: {
    users: [] as Array<Record<string, unknown>>,
    teachers: [] as Array<Record<string, unknown>>,
  },
}));

// Login only reads: it selects a user (and optionally a teacher) by username. The mock
// returns whatever the test put into `state`, so each test controls the account it sees.
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
      const rows = source === 'users' ? state.users : source === 'teachers' ? state.teachers : [];
      return Promise.resolve(rows.slice(0, count));
    },
  };
  return { ...actual, db: { select: () => query } };
});

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const PASSWORD = 'Start-Passwort-2026';
const WRONG = 'definitely-wrong-password';

let app: FastifyInstance;
let savedEnvironment: NodeJS.ProcessEnv;
let passwordHash: string;
let dateNowSpy: ReturnType<typeof vi.spyOn> | null = null;

/** Pin Date.now (used by the login handler) to a fixed instant. */
function setNow(ms: number) {
  if (!dateNowSpy) dateNowSpy = vi.spyOn(Date, 'now');
  dateNowSpy.mockReturnValue(ms);
}

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-2222-3333-4444-555555555555',
    username: 'muster',
    passwordHash,
    role: 'teacher',
    teacherId: null,
    pupilId: null,
    mustChangePassword: true,
    passwordIssuedAt: new Date(Date.now()),
    sessionVersion: 0,
    createdAt: new Date(Date.now()),
    ...overrides,
  };
}

async function login(username: string, password: string) {
  return app.inject({
    method: 'POST',
    url: '/api/auth/login',
    payload: { username, password },
  });
}

beforeAll(async () => {
  savedEnvironment = { ...process.env };
  Object.assign(process.env, TEST_ENV);
  // Cost 4 keeps the suite fast; the handler compares against whatever hash it is given.
  passwordHash = await bcrypt.hash(PASSWORD, 4);

  const Fastify = (await import('fastify')).default;
  const { authRoutes } = await import('./auth.js');
  app = Fastify({ logger: false });
  app.decorate('jwt', { sign: () => 'signed-test-token' } as any);
  // Route-level guards are referenced when routes register; login itself uses none.
  app.decorate('authenticate', async () => {});
  app.decorate('requireAccountAdministrator', async () => {});
  app.decorate('rateLimitLoginMax', 1000);
  app.decorate('rateLimitLoginWindowSeconds', 60);
  app.decorateReply('setCookie', function (this: any, name: string, value: string) {
    this.header('set-cookie', `${name}=${value}`);
    return this;
  });
  app.decorateReply('clearCookie', function (this: any) {
    return this;
  });
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app?.close();
  process.env = savedEnvironment;
});

beforeEach(async () => {
  state.users = [];
  state.teachers = [];
  const { resetLoginFailures } = await import('./auth.js');
  resetLoginFailures();
});

afterEach(() => {
  dateNowSpy?.mockRestore();
  dateNowSpy = null;
});

describe('administrator login', () => {
  it('allows an admin linked to the inactive placeholder teacher actor', async () => {
    state.users = [
      makeUser({
        username: 'admin',
        role: 'admin',
        teacherId: 9_000_000,
        mustChangePassword: false,
      }),
    ];
    state.teachers = [
      { id: 9_000_000, shortName: 'ADM-9000000', fullName: 'Administratorkonto admin', active: false },
    ];

    const res = await login('admin', PASSWORD);

    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeTruthy();
    expect(res.json()).toMatchObject({ user: { username: 'admin', role: 'admin' } });
  });
});

describe('start-password expiry at login', () => {
  it('refuses a correct start password issued more than 14 days ago, with no session', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now - 15 * DAY_MS) })];

    const res = await login('muster', PASSWORD);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error:
        'Das Start-Passwort ist abgelaufen. Bitte wenden Sie sich an die Schulleitung, damit ein neues Passwort vergeben wird.',
    });
    expect(res.headers['set-cookie']).toBeUndefined();
  });

  it('allows a correct start password issued 13 days ago', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now - 13 * DAY_MS) })];

    const res = await login('muster', PASSWORD);

    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeTruthy();
    expect(res.json()).toMatchObject({ user: { username: 'muster', mustChangePassword: true } });
  });

  it('treats exactly 14 days as still valid and 14 days plus one millisecond as expired', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now - 14 * DAY_MS) })];
    expect((await login('muster', PASSWORD)).statusCode).toBe(200);

    state.users = [makeUser({ passwordIssuedAt: new Date(now - 14 * DAY_MS - 1) })];
    expect((await login('muster', PASSWORD)).statusCode).toBe(403);
  });

  it('does not apply the expiry once mustChangePassword is false', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [
      makeUser({ mustChangePassword: false, passwordIssuedAt: new Date(now - 90 * DAY_MS) }),
    ];

    const res = await login('muster', PASSWORD);

    expect(res.statusCode).toBe(200);
    expect(res.headers['set-cookie']).toBeTruthy();
  });

  it('does not reveal expiry when the password is wrong (401, generic message)', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now - 30 * DAY_MS) })];

    const res = await login('muster', WRONG);

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'Ungültige Anmeldedaten' });
  });
});

describe('login lockout per username', () => {
  it('locks after 5 failures: further wrong passwords get 429, the correct password still works', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now) })];

    for (let i = 0; i < 5; i++) {
      expect((await login('muster', WRONG)).statusCode).toBe(401);
    }
    const locked = await login('muster', WRONG);

    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toEqual({ error: 'Zu viele Fehlversuche. Bitte warten Sie 15 Minuten.' });
    expect(locked.headers['set-cookie']).toBeUndefined();

    // The lock must not bar the real owner: a correct password always gets in.
    const correct = await login('muster', PASSWORD);
    expect(correct.statusCode).toBe(200);
    expect(correct.headers['set-cookie']).toBeTruthy();
  });

  it('locks a username that does not exist, so the lock does not reveal accounts', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [];

    for (let i = 0; i < 5; i++) {
      expect((await login('ghost', WRONG)).statusCode).toBe(401);
    }
    expect((await login('ghost', WRONG)).statusCode).toBe(429);
  });

  it('keys the lock on the normalised username', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now) })];

    for (let i = 0; i < 5; i++) {
      await login('  MUSTER ', WRONG);
    }
    expect((await login('muster', WRONG)).statusCode).toBe(429);
  });

  it('recovers once the 15-minute window has passed', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now) })];

    for (let i = 0; i < 5; i++) {
      await login('muster', WRONG);
    }
    expect((await login('muster', WRONG)).statusCode).toBe(429);

    setNow(now + 15 * MINUTE_MS + 1000);
    // The lock is gone: a wrong password is back to a plain 401 (not 429)…
    expect((await login('muster', WRONG)).statusCode).toBe(401);
    // …and the correct one is accepted (the closed window also reset the counter).
    const res = await login('muster', PASSWORD);

    expect(res.statusCode).toBe(200);
  });

  it('does not lock after only 4 failures', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now) })];

    for (let i = 0; i < 4; i++) {
      await login('muster', WRONG);
    }
    expect((await login('muster', PASSWORD)).statusCode).toBe(200);
  });

  it('a successful login clears the failure counter', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now) })];

    for (let i = 0; i < 4; i++) {
      await login('muster', WRONG);
    }
    expect((await login('muster', PASSWORD)).statusCode).toBe(200);

    // Four more failures would reach 5 only if the earlier four were still counted.
    for (let i = 0; i < 4; i++) {
      await login('muster', WRONG);
    }
    expect((await login('muster', PASSWORD)).statusCode).toBe(200);
  });

  it('the window starts at the first failure, not at the last one', async () => {
    const now = Date.now();
    setNow(now);
    state.users = [makeUser({ passwordIssuedAt: new Date(now) })];

    for (let i = 0; i < 4; i++) {
      await login('muster', WRONG);
    }
    setNow(now + 10 * MINUTE_MS);
    await login('muster', WRONG);
    // Fifth failure at 10 minutes is still inside the window opened at t=0: locked.
    expect((await login('muster', WRONG)).statusCode).toBe(429);

    // At 15 minutes from the first failure the window has closed and the count resets.
    setNow(now + 15 * MINUTE_MS + 1000);
    expect((await login('muster', PASSWORD)).statusCode).toBe(200);
  });
});

describe('login source contract', () => {
  const source = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8');

  it('sets passwordIssuedAt wherever a password is set: self-service change, admin credential and forced reset', () => {
    const passwordRoute = /fastify\.post\(\s*['"]\/password['"][\s\S]*?\n  \}\);/.exec(source);
    expect(passwordRoute).toBeTruthy();
    expect(passwordRoute![0]).toContain('passwordIssuedAt: new Date()');

    const issueRoute = /fastify\.post\(\s*['"]\/admin\/temporary-password['"][\s\S]*?\n  \);/.exec(source);
    expect(issueRoute).toBeTruthy();
    expect(issueRoute![0]).toContain('passwordIssuedAt: new Date()');

    // A forced reset re-flags the account; without refreshing the timestamp here, every
    // account whose password is older than 14 days would be refused at its next login.
    const resetRoute = /fastify\.post\(\s*['"]\/request-reset['"][\s\S]*?\n  \);/.exec(source);
    expect(resetRoute).toBeTruthy();
    expect(resetRoute![0]).toContain('passwordIssuedAt: new Date()');
  });

  it('checks the expiry only after the bcrypt comparison succeeds', () => {
    const loginRoute = /fastify\.post\(\s*['"]\/login['"][\s\S]*?\n  \);/.exec(source);
    expect(loginRoute).toBeTruthy();
    const block = loginRoute![0];
    const compareAt = block.indexOf('bcrypt.compare(password, hash)');
    const expiryAt = block.indexOf('startPasswordExpired(user, now)');
    expect(compareAt).toBeGreaterThan(-1);
    expect(expiryAt).toBeGreaterThan(compareAt);
  });
});
