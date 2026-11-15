import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const state = vi.hoisted(() => ({
  round: {
    id: 'round-2',
    startsOn: new Date('2026-09-01T00:00:00.000Z'),
    endsOn: new Date('2026-12-31T23:59:59.000Z'),
  } as { id: string; startsOn?: Date | null; endsOn?: Date | null } | null,
  classRow: { id: 10, name: '1a', grade: 1 },
  pupilsById: {
    11: { id: 11, fullName: 'Max Muster', classId: 10, isArchived: false },
  } as Record<number, { id: number; fullName: string; classId: number; isArchived: boolean }>,
  behaviorActions: [] as Array<Record<string, unknown>>,
  cards: [] as Array<Record<string, unknown>>,
  timeouts: [] as Array<Record<string, unknown>>,
  finalRanks: [] as Array<{ pupil_id: number; round_id: string; rank: string; confirmed_at: Date }>,
  evaluations: [] as Array<{ pupil_id: number; round_id: string; proposed_status: string | null }>,
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  createdPupilId: 99,
  createdActionId: '11111111-1111-1111-1111-111111111111',
}));

const mocks = vi.hoisted(() => ({
  broadcastToClass: vi.fn(),
}));

vi.mock('../ws/live-sync.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ws/live-sync.js')>();
  return {
    ...actual,
    broadcastToClass: mocks.broadcastToClass,
  };
});

vi.mock('../lib/rounds.js', () => ({
  getLatestRound: vi.fn(async () => state.round),
}));

vi.mock('../lib/guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guards.js')>();
  return {
    ...actual,
    getPupil: vi.fn(async (pid: number) => state.pupilsById[pid] ?? null),
    getClassAccess: vi.fn(async (_user: unknown, classId: number) => ({
      exists: classId === 10 || classId === 20,
      classId,
      canRead: true,
      canRecord: true,
      canManagePupils: true,
      canRunConference: true,
      isKv: true,
      isHeadmaster: false,
      isAdmin: false,
    })),
  };
});

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

  function makeSelectBuilder() {
    let targetTable: unknown = null;
    const rows = (): unknown[] => {
      switch (tableName(targetTable)) {
        case 'school_classes':
          return state.classRow ? [state.classRow] : [];
        case 'pupil_behavior_actions':
          return state.behaviorActions;
        default:
          return [];
      }
    };
    const builder = {
      from: (table: unknown) => {
        targetTable = table;
        return builder;
      },
      where: () => builder,
      orderBy: () => builder,
      limit: async () => rows(),
      then: <T>(resolve: (value: unknown[]) => T) => Promise.resolve(rows()).then(resolve),
    };
    return builder;
  }

  function makeTx() {
    return {
      insert: (table: unknown) => ({
        values: (vals: Record<string, unknown>) => {
          const name = tableName(table);
          if (name === 'pupils') {
            return {
              returning: async () => [
                {
                  id: state.createdPupilId,
                  classId: vals.classId,
                  fullName: vals.fullName,
                  isArchived: vals.isArchived ?? false,
                },
              ],
            };
          }
          if (name === 'pupil_behavior_actions') {
            return {
              returning: async () => [
                {
                  id: state.createdActionId,
                  ...vals,
                },
              ],
            };
          }
          return { returning: async () => [] };
        },
      }),
      update: (table: unknown) => ({
        set: (updates: Record<string, unknown>) => ({
          where: () => ({
            returning: async () => {
              if (tableName(table) === 'pupils') {
                const base = Object.values(state.pupilsById)[0] ?? {
                  id: 11,
                  fullName: 'Max Muster',
                  classId: 10,
                  isArchived: false,
                };
                return [{ ...base, ...updates }];
              }
              return [];
            },
          }),
        }),
      }),
      delete: () => ({
        where: async () => [],
      }),
    };
  }

  return {
    ...actual,
    db: {
      select: () => makeSelectBuilder(),
      transaction: async <T>(fn: (tx: ReturnType<typeof makeTx>) => Promise<T>) => fn(makeTx()),
    },
    getPool: () => ({
      query: async (sqlText: string, params: unknown[] = []) => {
        state.queries.push({ sql: sqlText, params });
        if (sqlText.includes('FROM behavior_cards')) {
          const pid = Number(params[0]);
          const filtersCooldownInSql = sqlText.includes("bc.card_type IN ('green', 'yellow', 'red')");
          const rows = state.cards.filter((c) => {
            if (Number(c.pupil_id ?? pid) !== pid) return false;
            if (filtersCooldownInSql) {
              return c.card_type === 'green' || c.card_type === 'yellow' || c.card_type === 'red';
            }
            return true;
          });
          return { rows };
        }
        if (sqlText.includes('FROM timeout_incidents')) {
          return { rows: state.timeouts };
        }
        if (sqlText.includes('FROM pupil_behavior_actions')) {
          return { rows: state.behaviorActions };
        }
        if (sqlText.includes('FROM final_ranks')) {
          const pid = Number(params[0]);
          const roundId = params[1] ? String(params[1]) : null;
          const rows = state.finalRanks
            .filter((r) => r.pupil_id === pid && (!roundId || r.round_id === roundId))
            .sort((a, b) => b.confirmed_at.getTime() - a.confirmed_at.getTime())
            .slice(0, 1);
          return { rows };
        }
        if (sqlText.includes('FROM evaluations')) {
          const pid = Number(params[0]);
          const roundId = String(params[1]);
          const rows = state.evaluations.filter(
            (e) => e.pupil_id === pid && e.round_id === roundId && e.proposed_status != null,
          );
          return { rows };
        }
        return { rows: [] };
      },
    }),
  };
});

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-pupil-profile-tests',
  CORS_ALLOWED_ORIGINS: '',
  YELLOW_CARD_RANK_LOSS_THRESHOLD: '3',
};

let app: FastifyInstance;
let savedEnvironment: NodeJS.ProcessEnv;

function cookieHeader() {
  const token = app.jwt.sign({
    id: 'teacher-101',
    username: 'teacher',
    role: 'teacher',
    teacherId: 101,
    mustChangePassword: false,
    sessionVersion: 0,
  });
  return `smile_session=${token}`;
}

beforeAll(async () => {
  savedEnvironment = { ...process.env };
  Object.assign(process.env, TEST_ENV);
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
  mocks.broadcastToClass.mockClear();
  state.round = {
    id: 'round-2',
    startsOn: new Date('2026-09-01T00:00:00.000Z'),
    endsOn: new Date('2026-12-31T23:59:59.000Z'),
  };
  state.classRow = { id: 10, name: '1a', grade: 1 };
  state.pupilsById = {
    11: { id: 11, fullName: 'Max Muster', classId: 10, isArchived: false },
  };
  state.behaviorActions = [];
  state.cards = [];
  state.timeouts = [];
  state.finalRanks = [];
  state.evaluations = [];
  state.queries = [];
});

describe('GET /api/pupils/:id/behavior-profile', () => {
  it('excludes cooldown cards from SQL, cards list, and behavior counts', async () => {
    state.cards = [
      { id: 'c1', pupil_id: 11, card_type: 'green', note: 'Super', created_at: new Date('2026-10-01T10:00:00Z') },
      { id: 'c2', pupil_id: 11, card_type: 'yellow', note: 'Störung', created_at: new Date('2026-10-02T10:00:00Z') },
      { id: 'c3', pupil_id: 11, card_type: 'cooldown', note: 'Auszeit', created_at: new Date('2026-10-03T10:00:00Z') },
    ];

    const res = await app.inject({
      method: 'GET',
      url: '/api/pupils/11/behavior-profile',
      headers: { cookie: cookieHeader() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const cardQuery = state.queries.find((q) => q.sql.includes('FROM behavior_cards'));
    expect(cardQuery?.sql).toContain("bc.card_type IN ('green', 'yellow', 'red')");
    expect(body.cards.map((c: { id: string }) => c.id)).toEqual(['c1', 'c2']);
    expect(body.calculation.stats.greenCount).toBe(1);
    expect(body.calculation.stats.yellowCount).toBe(1);
  });

  it('scopes final_ranks to latest round and falls back to demoted majority proposed_status', async () => {
    // Prior round had Meister confirmed, latest round (round-2) has no confirmed rank yet.
    state.finalRanks = [
      { pupil_id: 11, round_id: 'round-1', rank: 'Meister', confirmed_at: new Date('2026-06-01T00:00:00Z') },
    ];
    state.evaluations = [
      { pupil_id: 11, round_id: 'round-2', proposed_status: 'Meister' },
      { pupil_id: 11, round_id: 'round-2', proposed_status: 'Meister' },
      { pupil_id: 11, round_id: 'round-2', proposed_status: 'Geselle' },
    ];
    state.cards = [
      { id: 'r1', pupil_id: 11, card_type: 'red', note: 'Rot', created_at: new Date('2026-10-10T10:00:00Z') },
    ];

    const res = await app.inject({
      method: 'GET',
      url: '/api/pupils/11/behavior-profile',
      headers: { cookie: cookieHeader() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().pupil.currentRank).toBe('Geselle');

    const finalRankQuery = state.queries.find((q) => q.sql.includes('FROM final_ranks'));
    expect(finalRankQuery?.sql).toContain('round_id = $2');
    expect(finalRankQuery?.params).toEqual([11, 'round-2']);
  });

  it('demotes live rank by in-round yellow cards only and falls back to Geselle on tie or empty', async () => {
    state.evaluations = [
      { pupil_id: 11, round_id: 'round-2', proposed_status: 'Meister' },
      { pupil_id: 11, round_id: 'round-2', proposed_status: 'Meister' },
    ];
    // 3 yellow cards inside round-2 + 1 older yellow card outside round-2 -> 1 demotion step -> Geselle.
    state.cards = [
      { id: 'y1', pupil_id: 11, card_type: 'yellow', note: null, created_at: new Date('2026-10-01T10:00:00Z') },
      { id: 'y2', pupil_id: 11, card_type: 'yellow', note: null, created_at: new Date('2026-10-02T10:00:00Z') },
      { id: 'y3', pupil_id: 11, card_type: 'yellow', note: null, created_at: new Date('2026-10-03T10:00:00Z') },
      { id: 'y-old', pupil_id: 11, card_type: 'yellow', note: null, created_at: new Date('2025-11-01T10:00:00Z') },
    ];

    const demotedRes = await app.inject({
      method: 'GET',
      url: '/api/pupils/11/behavior-profile',
      headers: { cookie: cookieHeader() },
    });
    expect(demotedRes.statusCode).toBe(200);
    expect(demotedRes.json().pupil.currentRank).toBe('Geselle');

    // Equal split falls back to Geselle even without cards.
    state.cards = [];
    state.evaluations = [
      { pupil_id: 11, round_id: 'round-2', proposed_status: 'Meister' },
      { pupil_id: 11, round_id: 'round-2', proposed_status: 'Lehrling' },
    ];
    const tiedRes = await app.inject({
      method: 'GET',
      url: '/api/pupils/11/behavior-profile',
      headers: { cookie: cookieHeader() },
    });
    expect(tiedRes.statusCode).toBe(200);
    expect(tiedRes.json().pupil.currentRank).toBe('Geselle');
  });

  it('prefers final_ranks when confirmed in the latest round', async () => {
    state.finalRanks = [
      { pupil_id: 11, round_id: 'round-2', rank: 'Meister', confirmed_at: new Date('2026-11-01T00:00:00Z') },
    ];
    state.evaluations = [{ pupil_id: 11, round_id: 'round-2', proposed_status: 'Lehrling' }];

    const res = await app.inject({
      method: 'GET',
      url: '/api/pupils/11/behavior-profile',
      headers: { cookie: cookieHeader() },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().pupil.currentRank).toBe('Meister');
  });
});

describe('PUPIL_ROSTER_CHANGED broadcasts on pupil mutations', () => {
  it('broadcasts on POST /api/pupils', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/pupils',
      headers: { cookie: cookieHeader() },
      payload: { classId: 10, fullName: 'Mia Neu' },
    });

    expect(res.statusCode).toBe(201);
    expect(mocks.broadcastToClass).toHaveBeenCalledWith(10, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: 10,
      pupilId: 99,
    });
  });

  it('broadcasts to destination and source class when moving a pupil via PUT /api/pupils/:id', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/pupils/11',
      headers: { cookie: cookieHeader() },
      payload: { classId: 20, fullName: 'Max Verschoben' },
    });

    expect(res.statusCode).toBe(200);
    expect(mocks.broadcastToClass).toHaveBeenCalledWith(20, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: 20,
      pupilId: 11,
    });
    expect(mocks.broadcastToClass).toHaveBeenCalledWith(10, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: 10,
      pupilId: 11,
    });
  });

  it('broadcasts on DELETE /api/pupils/:id and behavior-actions create/delete', async () => {
    const delRes = await app.inject({
      method: 'DELETE',
      url: '/api/pupils/11',
      headers: { cookie: cookieHeader() },
    });
    expect(delRes.statusCode).toBe(200);
    expect(mocks.broadcastToClass).toHaveBeenLastCalledWith(10, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: 10,
      pupilId: 11,
    });

    mocks.broadcastToClass.mockClear();
    const postActionRes = await app.inject({
      method: 'POST',
      url: '/api/pupils/11/behavior-actions',
      headers: { cookie: cookieHeader() },
      payload: { stageLevel: 1, stageTitle: 'Elterngespräch', notes: 'Notiz' },
    });
    expect(postActionRes.statusCode).toBe(201);
    expect(mocks.broadcastToClass).toHaveBeenLastCalledWith(10, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: 10,
      pupilId: 11,
    });

    mocks.broadcastToClass.mockClear();
    state.behaviorActions = [
      {
        id: '11111111-1111-1111-1111-111111111111',
        pupilId: 11,
        teacherId: 101,
        stageLevel: 1,
        stageTitle: 'Elterngespräch',
      },
    ];
    const delActionRes = await app.inject({
      method: 'DELETE',
      url: '/api/pupils/11/behavior-actions/11111111-1111-1111-1111-111111111111',
      headers: { cookie: cookieHeader() },
    });
    expect(delActionRes.statusCode).toBe(200);
    expect(mocks.broadcastToClass).toHaveBeenLastCalledWith(10, {
      type: 'PUPIL_ROSTER_CHANGED',
      classId: 10,
      pupilId: 11,
    });
  });
});
