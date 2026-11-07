import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const { database } = vi.hoisted(() => ({
  database: {
    rowsByTable: {} as Record<string, unknown[]>,
    select: vi.fn(),
  },
}));

vi.mock('../db/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index.js')>();
  const { getTableName } = await import('drizzle-orm');
  let source = '';
  const query: any = {
    from(table: unknown) {
      source = getTableName(table as never);
      return query;
    },
    innerJoin() {
      return query;
    },
    where() {
      return query;
    },
    orderBy() {
      return query;
    },
    limit(count: number) {
      return Promise.resolve((database.rowsByTable[source] ?? []).slice(0, count));
    },
    then(resolve: (value: unknown[]) => unknown, reject: (reason: unknown) => unknown) {
      return Promise.resolve(database.rowsByTable[source] ?? []).then(resolve, reject);
    },
  };

  database.select.mockImplementation(() => query);
  return { ...actual, db: database };
});

const TEST_ENV: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
  STATISTICS_SCHOOL_WIDE: 'true',
  RUBRIC_ITEM_COUNT: '24',
  RANK_THRESHOLD_MEISTER: '20',
  RANK_THRESHOLD_GESELLE: '12',
  RANK_AGGREGATION: 'normalized',
};

let app: FastifyInstance | null = null;
let savedEnvironment: NodeJS.ProcessEnv;

beforeAll(async () => {
  savedEnvironment = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const Fastify = (await import('fastify')).default;
  const { statisticsRoutes } = await import('./statistics.js');
  app = Fastify({ logger: false });
  app.decorate('authenticate', async (request) => {
    request.authUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
    };
  });
  await app.register(statisticsRoutes, { prefix: '/api/statistics' });
  await app.ready();
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, savedEnvironment);
});

beforeEach(() => {
  vi.clearAllMocks();
  database.rowsByTable = {
    school_classes: [],
    observation_rounds: [],
    pupils: [],
    evaluations: [],
    evaluation_items: [],
    final_ranks: [],
    teachers: [],
    teaching_assignments: [],
    behavior_cards: [],
    timeout_incidents: [],
    pupil_behavior_actions: [],
  };
});

describe('GET /api/statistics/overview factual statistics dashboard', () => {
  it('includes the active config when there is no observation round', async () => {
    database.rowsByTable.school_classes = [{ id: 10, name: '3a', grade: 3 }];

    const response = await app!.inject({ method: 'GET', url: '/api/statistics/overview' });

    expect(response.statusCode).toBe(200);
    expect(response.json().rubricConfig).toEqual({
      meister: 20,
      geselle: 12,
      itemCount: 24,
      aggregation: 'normalized',
    });
    expect(response.json().round).toBeNull();
    expect(response.json().cardsSummary).toBeDefined();
    expect(response.json().cardsSummary.totals.green).toBe(0);
    expect(response.json().classBreakdown).toBeDefined();
  });

  it('includes factual behavioral aggregates and pupilCardStats in a populated response', async () => {
    database.rowsByTable.school_classes = [{ id: 10, name: '3a', grade: 3 }];
    database.rowsByTable.observation_rounds = [
      { id: 'round-1', createdAt: new Date('2026-10-01T00:00:00Z'), isLocked: false },
    ];
    database.rowsByTable.pupils = [
      { id: 101, fullName: 'Anna Muster', classId: 10, className: '3a', grade: 3 },
      { id: 102, fullName: 'Ben Problem', classId: 10, className: '3a', grade: 3 },
    ];
    database.rowsByTable.behavior_cards = [
      { id: 'c1', pupilId: 101, classId: 10, cardType: 'green', createdAt: new Date('2026-11-02T08:00:00Z'), revokedAt: null },
      { id: 'c2', pupilId: 102, classId: 10, cardType: 'yellow', createdAt: new Date('2026-11-03T09:00:00Z'), revokedAt: null },
      { id: 'c3', pupilId: 102, classId: 10, cardType: 'yellow', createdAt: new Date('2026-11-04T10:00:00Z'), revokedAt: null },
    ];
    database.rowsByTable.timeout_incidents = [
      { id: 't1', pupilId: 102, classId: 10, kind: 'timeout', sentAt: new Date('2026-11-05T11:00:00Z'), status: 'resolved' },
    ];

    const response = await app!.inject({ method: 'GET', url: '/api/statistics/overview' });
    const data = response.json();

    expect(response.statusCode).toBe(200);
    expect(data.rubricConfig).toEqual({
      meister: 20,
      geselle: 12,
      itemCount: 24,
      aggregation: 'normalized',
    });
    expect(data.pupils).toHaveLength(2);
    expect(data.pupils[0].fullName).toBe('Anna Muster');

    // Cards summary assertions
    expect(data.cardsSummary.totals.green).toBe(1);
    expect(data.cardsSummary.totals.yellow).toBe(2);
    expect(data.cardsSummary.totals.timeout).toBe(1);
    expect(data.cardsSummary.totals.total).toBe(4);

    // Class breakdown assertions
    expect(data.classBreakdown).toHaveLength(1);
    expect(data.classBreakdown[0].className).toBe('3a');
    expect(data.classBreakdown[0].green).toBe(1);
    expect(data.classBreakdown[0].yellow).toBe(2);
    expect(data.classBreakdown[0].timeout).toBe(1);

    // Pupil card stats assertions
    expect(data.pupilCardStats).toHaveLength(2);
    expect(data.pupilCardStats[0].fullName).toBe('Anna Muster');
    expect(data.pupilCardStats[0].green).toBe(1);
    expect(data.pupilCardStats[1].fullName).toBe('Ben Problem');
    expect(data.pupilCardStats[1].yellow).toBe(2);
    expect(data.pupilCardStats[1].timeout).toBe(1);
  });
});
