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
  };
});


describe('GET /api/statistics/overview rubric configuration', () => {
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
  });

  it('includes the same active config in a populated pupil response', async () => {
    database.rowsByTable.school_classes = [{ id: 10, name: '3a', grade: 3 }];
    database.rowsByTable.observation_rounds = [
      { id: 'round-1', createdAt: new Date('2026-10-01T00:00:00Z'), isLocked: false },
    ];
    database.rowsByTable.pupils = [
      { id: 101, fullName: 'Anna Muster', classId: 10, className: '3a', grade: 3 },
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
    expect(data.pupils).toHaveLength(1);
    expect(data.pupils[0].fullName).toBe('Anna Muster');
  });
});
