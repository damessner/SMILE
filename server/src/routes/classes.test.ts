import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * The class roster endpoint is what BeobachtungsGrid renders from, and it is
 * also where the rubric thresholds reach the client. They are read from
 * `server/src/config.ts` (validated there) rather than from the seeded
 * `assessmentRubrics.gradeBoundaries` row, which is written once and would go
 * stale the moment an env var changes.
 */
const classState = vi.hoisted(() => ({
  round: null as { id: string; isLocked: boolean } | null,
  classLockRow: { isLocked: false } as { isLocked: boolean },
  pupils: [] as Array<Record<string, unknown>>,
  evaluations: [] as Array<Record<string, unknown>>,
  evaluationItems: [] as Array<Record<string, unknown>>,
  behaviorCards: [] as Array<Record<string, unknown>>,
  schoolClassName: null as string | null,
  /** Timetable rows the raw SQL path hands back; empty is the normal case. */
  hoursRows: [] as Array<Record<string, unknown>>,
  access: null as Record<string, unknown> | null,
}));

// Only the decision inputs are mocked: who the caller is, and what each table
// holds. Everything else the route does stays a real code path.
vi.mock('../lib/guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guards.js')>();
  return {
    ...actual,
    getClassAccess: vi.fn(async () => classState.access),
  };
});

vi.mock('../db/index.js', async (importOriginal) => {
  const { getTableName } = await import('drizzle-orm');
  /**
   * Identify a table by its physical name rather than by module identity: a
   * dynamically imported module is a separate module instance under vitest, so
   * `===` against a schema export silently sends reads down the wrong branch.
   */
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
      case 'pupils':
        return classState.pupils;
      case 'observation_rounds':
        return classState.round ? [classState.round] : [];
      case 'evaluations':
        return classState.evaluations;
      case 'evaluation_items':
        return classState.evaluationItems;
      case 'behavior_cards':
        return classState.behaviorCards;
      case 'school_classes':
        return classState.schoolClassName ? [{ name: classState.schoolClassName }] : [];
      default:
        return [];
    }
  };

  // The roster route awaits several queries directly (no `.limit()`), so the
  // builder has to be thenable as well as chainable.
  const query = {
    from: (table: unknown) => {
      source = table;
      return query;
    },
    where: () => query,
    orderBy: () => query,
    then: <T>(onFulfilled: (value: unknown[]) => T) => Promise.resolve(rows()).then(onFulfilled),
    limit: async () => rows(),
  };

  return {
    ...(await importOriginal<typeof import('../db/index.js')>()),
    db: {
      select: () => query,
      // Timetable hours are advisory: the route tolerates the lookup failing,
      // and the mock must too, or a shape mismatch would silently mask a real
      // break in the fields this test is about.
      getPool: () => ({
        query: async () => ({ rows: classState.hoursRows }),
      }),
    },
  };
});

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
  SUBMISSION_DEADLINE: '2099-01-01T00:00:00.000Z',
};

let app: FastifyInstance | null = null;

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('../index.js');
  try {
    app = await buildServer(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
    await app.ready();
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

function sessionCookie(): string {
  return app!.jwt.sign(
    {
      id: 'teacher-1',
      username: 'kv',
      role: 'head_teacher',
      teacherId: 1,
      mustChangePassword: false,
      sessionVersion: 0,
    },
    { expiresIn: '1h' },
  );
}

function resetState(): void {
  classState.round = null;
  classState.classLockRow = { isLocked: false };
  classState.pupils = [];
  classState.evaluations = [];
  classState.evaluationItems = [];
  classState.behaviorCards = [];
  classState.schoolClassName = null;
  classState.hoursRows = [];
  classState.access = {
    classId: 1,
    exists: true,
    isAdmin: false,
    isHeadmaster: true,
    isKv: false,
    teaches: true,
    isCoreTeacher: true,
    subjects: [],
    canRead: true,
    canRecord: true,
    canRate: true,
    canManagePupils: true,
    canRunConference: false,
  };
}

describe('GET /api/classes/:classId/pupils rubric configuration', () => {
  beforeAll(() => {
    resetState();
  });

  it('delivers the configured rubric thresholds to the client', async () => {
    // The client's raster maths must agree with the server's, or a pupil can
    // read Meister on screen while the server stores Lehrling. The only way to
    // keep them agreeing is to send the numbers with the payload.
    resetState();

    const res = await app!.inject({
      method: 'GET',
      url: '/api/classes/1/pupils',
      headers: { cookie: 'smile_session=' + sessionCookie() },
    });

    expect(res.statusCode).toBe(200);
    const { config } = await import('../config.js');
    expect(res.json().rubricConfig).toEqual({
      meister: config.rankThresholds.meister,
      geselle: config.rankThresholds.geselle,
      itemCount: config.rubricItemCount,
      aggregation: config.rankAggregation,
    });
  });

  it('delivers them on the empty-class shortcut too', async () => {
    // The shortcut for class 999 skips the roster query entirely. A client that
    // reads `rubricConfig` unconditionally would see `undefined` there and fall
    // back to its own literals, which is exactly the drift this task removes.
    resetState();

    const res = await app!.inject({
      method: 'GET',
      url: '/api/classes/999/pupils',
      headers: { cookie: 'smile_session=' + sessionCookie() },
    });

    expect(res.statusCode).toBe(200);
    const { config } = await import('../config.js');
    expect(res.json().rubricConfig).toEqual({
      meister: config.rankThresholds.meister,
      geselle: config.rankThresholds.geselle,
      itemCount: config.rubricItemCount,
      aggregation: config.rankAggregation,
    });
  });
});
