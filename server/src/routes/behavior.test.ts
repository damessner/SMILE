import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Rows the mocked database returns for the behaviour overview. Each table is routed
 * by physical name, because the route imports tables from the schema module and a
 * dynamic import can hand the test a different module instance.
 */
const state = vi.hoisted(() => ({
  classes: [] as Array<Record<string, unknown>>,
  pupils: [] as Array<Record<string, unknown>>,
  cards: [] as Array<Record<string, unknown>>,
  incidents: [] as Array<Record<string, unknown>>,
  ranks: [] as Array<Record<string, unknown>>,
  globalAccess: { isAdmin: false, isHeadmaster: false, teacherId: 101, classIds: [1] as number[] | null },
  classAccess: {} as Record<number, Record<string, unknown>>,
}));

vi.mock('../db/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index.js')>();
  const { getTableName } = await import('drizzle-orm');
  const tableName = (table: unknown): string | null => {
    try {
      return getTableName(table as never);
    } catch {
      return null;
    }
  };
  let source: unknown = null;
  const rows = (): unknown[] => {
    switch (tableName(source)) {
      case 'school_classes':
        return state.classes;
      case 'pupils':
        return state.pupils;
      case 'behavior_cards':
        return state.cards;
      case 'timeout_incidents':
        return state.incidents;
      case 'final_ranks':
        return state.ranks;
      default:
        return [];
    }
  };
  const query = {
    from: (table: unknown) => {
      source = table;
      return query;
    },
    innerJoin: () => query,
    where: () => query,
    orderBy: () => query,
    then: <T>(resolve: (value: unknown[]) => T) => Promise.resolve(rows()).then(resolve),
    limit: async () => rows(),
  };
  return { ...actual, db: { select: () => query } };
});

vi.mock('../lib/rounds.js', () => ({
  getLatestRound: vi.fn(async () => ({ id: 'round-1', isLocked: false })),
}));

vi.mock('../lib/guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guards.js')>();
  return {
    ...actual,
    getGlobalAccess: vi.fn(async () => state.globalAccess),
    getClassAccess: vi.fn(async (_user: unknown, classId: number) => ({
      exists: true,
      classId,
      canRecord: false,
      canRead: true,
      ...(state.classAccess[classId] ?? {}),
    })),
  };
});

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-behavior-tests',
  CORS_ALLOWED_ORIGINS: '',
  BEHAVIOUR_SCHOOL_WIDE: 'true',
};

let app: FastifyInstance;
let savedEnvironment: NodeJS.ProcessEnv;
let configModule: typeof import('../config.js');

function token(role: 'teacher' | 'admin' = 'teacher') {
  return app.jwt.sign({
    id: 'behaviour-teacher',
    username: 'teacher',
    role,
    teacherId: role === 'teacher' ? 101 : undefined,
    mustChangePassword: false,
    sessionVersion: 0,
  });
}

async function fetchOverview(role: 'teacher' | 'admin' = 'teacher') {
  return app.inject({
    method: 'GET',
    url: '/api/behavior/overview',
    headers: { cookie: `smile_session=${token(role)}` },
  });
}

beforeAll(async () => {
  savedEnvironment = { ...process.env };
  Object.assign(process.env, TEST_ENV);
  configModule = await import('../config.js');
  const { buildServer } = await import('../index.js');
  app = await buildServer(async () => ({
    sessionVersion: 0,
    mustChangePassword: false,
    teacherActive: true,
  }));
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app?.close();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, savedEnvironment);
});

afterEach(() => {
  (configModule.config as { behaviourSchoolWide: boolean }).behaviourSchoolWide = true;
  state.classes = [
    { id: 1, name: '1a', grade: 1 },
    { id: 2, name: '2b', grade: 2 },
  ];
  state.pupils = [
    { id: 11, fullName: 'Anna Muster', classId: 1, className: '1a', grade: 1 },
    { id: 22, fullName: 'Bert Beispiel', classId: 2, className: '2b', grade: 2 },
  ];
  state.cards = [
    { pupilId: 11, cardType: 'green' },
    { pupilId: 22, cardType: 'yellow' },
    { pupilId: 22, cardType: 'yellow' },
  ];
  state.incidents = [
    { id: 't-active', pupilId: 11, kind: 'timeout', status: 'active', sentAt: new Date('2026-11-12T08:00:00Z'), taskAssignment: 'Arbeitsblatt' },
    { id: 't-done', pupilId: 11, kind: 'timeout', status: 'resolved', sentAt: new Date('2026-11-10T08:00:00Z'), taskAssignment: 'Arbeitsblatt' },
    { id: 'c-done', pupilId: 22, kind: 'cooldown', status: 'resolved', sentAt: new Date('2026-11-11T08:00:00Z'), taskAssignment: 'Pause' },
  ];
  state.ranks = [{ pupilId: 11, rank: 'Meister' }];
  state.globalAccess = { isAdmin: false, isHeadmaster: false, teacherId: 101, classIds: [1] };
  state.classAccess = { 1: { canRecord: true } };
});

describe('GET /api/behavior/overview', () => {
  it('refuses pupil logins', async () => {
    const pupilToken = app.jwt.sign({
      id: 'behaviour-pupil',
      username: 'pupil',
      role: 'pupil',
      mustChangePassword: false,
      sessionVersion: 0,
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/behavior/overview',
      headers: { cookie: `smile_session=${pupilToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns every class and pupil with behaviour status while the policy is on', async () => {
    const res = await fetchOverview();
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.schoolWide).toBe(true);
    expect(body.classes).toHaveLength(2);
    expect(body.pupils).toHaveLength(2);

    const anna = body.pupils.find((p: { id: number }) => p.id === 11);
    expect(anna).toMatchObject({
      fullName: 'Anna Muster',
      className: '1a',
      rank: 'Meister',
      counts: { green: 1, yellow: 0, red: 0, timeout: 2, cooldown: 0 },
      canRecord: true,
    });
    expect(anna.activeIncident).toMatchObject({ id: 't-active', kind: 'timeout' });
    expect(anna.stage.level).toBeLessThanOrEqual(0);

    const bert = body.pupils.find((p: { id: number }) => p.id === 22);
    expect(bert.counts).toMatchObject({ yellow: 2, cooldown: 1 });
    expect(bert.rank).toBeNull();
  });

  it('does not double-count Cool-Downs and ignores expired active incidents', async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const future = new Date(Date.now() + 60 * 60 * 1000);
    state.cards = [
      { pupilId: 11, cardType: 'cooldown' },
      { pupilId: 22, cardType: 'cooldown' },
    ];
    state.incidents = [
      { id: 'cd-11', pupilId: 11, kind: 'cooldown', status: 'active', sentAt: new Date('2026-11-12T08:00:00Z'), expiresAt: future, taskAssignment: 'Pause' },
      { id: 't-expired', pupilId: 22, kind: 'timeout', status: 'active', sentAt: new Date('2026-11-12T07:00:00Z'), expiresAt: past, taskAssignment: 'Abgelaufen' },
      { id: 'cd-22', pupilId: 22, kind: 'cooldown', status: 'resolved', sentAt: new Date('2026-11-11T07:00:00Z'), expiresAt: past, taskAssignment: 'Pause' },
    ];

    const res = await fetchOverview();
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const anna = body.pupils.find((p: { id: number }) => p.id === 11);
    expect(anna.counts.cooldown).toBe(1);
    expect(anna.activeIncident).toMatchObject({ id: 'cd-11', kind: 'cooldown' });

    const bert = body.pupils.find((p: { id: number }) => p.id === 22);
    expect(bert.counts.cooldown).toBe(1);
    expect(bert.activeIncident).toBeNull();
  });

  it('scopes the list to the caller when the policy is off', async () => {
    (configModule.config as { behaviourSchoolWide: boolean }).behaviourSchoolWide = false;
    // The real query filters `pupils.class_id = ANY(...)`; the mock returns whole
    // tables, so this row set represents what PostgreSQL would hand the route.
    state.pupils = state.pupils.filter((p) => p.classId === 1);

    const res = await fetchOverview();
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.schoolWide).toBe(false);
    expect(body.classes.map((cls: { id: number }) => cls.id)).toEqual([1]);
    expect(body.pupils.map((p: { id: number }) => p.id)).toEqual([11]);
    // The per-class gate decides here; class 1 grants canRecord.
    expect(body.pupils[0].canRecord).toBe(true);
  });

  it('honours a leadership scope in restricted mode', async () => {
    (configModule.config as { behaviourSchoolWide: boolean }).behaviourSchoolWide = false;
    state.globalAccess = { isAdmin: true, isHeadmaster: true, teacherId: undefined as never, classIds: null };

    const res = await fetchOverview('admin');
    expect(res.statusCode).toBe(200);
    expect(res.json().classes).toHaveLength(2);
  });

  it('demotes a confirmed rank after 3 post-confirmation yellow cards without double-demoting pre-conference cards', async () => {
    const confirmedAt = new Date('2026-11-03T13:25:35Z');
    state.ranks = [
      { pupilId: 11, rank: 'Meister', confirmedAt },
      { pupilId: 22, rank: 'Geselle', confirmedAt },
    ];
    state.cards = [
      // Pupil 11: 3 yellow cards issued after conference confirmation -> Geselle.
      { pupilId: 11, cardType: 'yellow', createdAt: new Date('2026-11-04T07:55:00Z') },
      { pupilId: 11, cardType: 'yellow', createdAt: new Date('2026-11-06T09:41:00Z') },
      { pupilId: 11, cardType: 'yellow', createdAt: new Date('2026-11-17T06:51:00Z') },
      // Pupil 22: 1 red card issued before confirmation -> already reflected in Geselle.
      { pupilId: 22, cardType: 'red', createdAt: new Date('2026-10-20T09:00:00Z') },
    ];

    const res = await fetchOverview();
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.pupils.find((p: { id: number }) => p.id === 11)?.rank).toBe('Geselle');
    expect(body.pupils.find((p: { id: number }) => p.id === 22)?.rank).toBe('Geselle');
  });
});
