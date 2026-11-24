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
  finalRanks: [] as Array<Record<string, unknown>>,
  pupils: [] as Array<Record<string, unknown>>,
  evaluations: [] as Array<Record<string, unknown>>,
  evaluationItems: [] as Array<Record<string, unknown>>,
  behaviorCards: [] as Array<Record<string, unknown>>,
  pupilSubjectTeachers: [] as Array<Record<string, unknown>>,
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

  // Allocate per-query table tracking so concurrent Promise.all `db.select()`
  // calls cannot clobber each other's source table.
  function makeSelectBuilder() {
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
        case 'final_ranks':
          return classState.finalRanks;
        case 'class_round_locks':
          return [classState.classLockRow];
        case 'pupil_subject_teachers':
          return classState.pupilSubjectTeachers;
        case 'school_classes':
          return classState.schoolClassName ? [{ name: classState.schoolClassName }] : [];
        default:
          return [];
      }
    };

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
    return query;
  }

  return {
    ...(await importOriginal<typeof import('../db/index.js')>()),
    db: {
      select: () => makeSelectBuilder(),
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
  classState.finalRanks = [];
  classState.pupils = [];
  classState.evaluations = [];
  classState.evaluationItems = [];
  classState.behaviorCards = [];
  classState.pupilSubjectTeachers = [];
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

  it('refuses the Lernwerkstatt room shell to a caller without read access to room 999', async () => {
    // The 999 shortcut used to answer any authenticated caller before any access
    // check. Now the same rule as the WebSocket room applies: duty teacher or
    // school leadership only.
    resetState();
    classState.access = { ...classState.access!, classId: 999, canRead: false };

    const res = await app!.inject({
      method: 'GET',
      url: '/api/classes/999/pupils',
      headers: { cookie: 'smile_session=' + sessionCookie() },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().pupils).toBeUndefined();
    resetState();
  });

  it('attaches assignedTeachers and assignedGroups to each pupil in the roster', async () => {
    resetState();
    classState.pupils = [
      { id: 4632, classId: 1, fullName: 'Burak Bayraktar', isArchived: false },
      { id: 4633, classId: 1, fullName: 'Gülderen Tanriseven', isArchived: false },
    ];
    classState.pupilSubjectTeachers = [
      { id: 1, pupilId: 4632, classId: 1, subjectCode: 'TUD', teacherId: 314, groupName: 'TUD_4B_TAS' },
      { id: 2, pupilId: 4633, classId: 1, subjectCode: 'TUD', teacherId: 247, groupName: 'TUD_4B_AKU' },
    ];

    const res = await app!.inject({
      method: 'GET',
      url: '/api/classes/1/pupils',
      headers: { cookie: 'smile_session=' + sessionCookie() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.pupils).toHaveLength(2);

    const burak = body.pupils.find((p: any) => p.id === 4632);
    expect(burak.assignedTeachers).toEqual({ TUD: [314] });
    expect(burak.assignedGroups).toEqual({ TUD: 'TUD_4B_TAS' });

    const gulderen = body.pupils.find((p: any) => p.id === 4633);
    expect(gulderen.assignedTeachers).toEqual({ TUD: [247] });
    expect(gulderen.assignedGroups).toEqual({ TUD: 'TUD_4B_AKU' });
  });

  it('computes post-confirmation demotion steps without double-demoting pre-conference cards', async () => {
    resetState();
    classState.round = {
      id: 'round-1',
      isLocked: false,
      startsOn: new Date('2026-09-14T00:00:00Z'),
      endsOn: new Date('2027-02-15T00:00:00Z'),
    } as any;
    const confirmedAt = new Date('2026-11-03T13:25:35Z');
    classState.pupils = [
      { id: 5572, classId: 1, fullName: 'Gapp Emil', isArchived: false },
      { id: 5573, classId: 1, fullName: 'Pre Red Pupil', isArchived: false },
    ];
    classState.finalRanks = [
      { pupilId: 5572, rank: 'Meister', confirmedAt },
      { pupilId: 5573, rank: 'Geselle', confirmedAt },
    ];
    classState.behaviorCards = [
      // Emil: 3 active yellow cards after conference confirmation -> 1 demotion step.
      { id: 'y1', pupilId: 5572, cardType: 'yellow', createdAt: new Date('2026-11-04T07:55:10Z'), revokedAt: null },
      { id: 'y2', pupilId: 5572, cardType: 'yellow', createdAt: new Date('2026-11-06T09:41:27Z'), revokedAt: null },
      { id: 'y3', pupilId: 5572, cardType: 'yellow', createdAt: new Date('2026-11-17T06:51:59Z'), revokedAt: null },
      // Pre Red Pupil: red card issued before confirmation -> already factored in -> 0 steps.
      { id: 'r1', pupilId: 5573, cardType: 'red', createdAt: new Date('2026-10-20T09:00:00Z'), revokedAt: null },
    ];

    const res = await app!.inject({
      method: 'GET',
      url: '/api/classes/1/pupils',
      headers: { cookie: 'smile_session=' + sessionCookie() },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    const emil = body.pupils.find((p: any) => p.id === 5572);
    expect(emil.finalRank).toBe('Meister');
    expect(emil.rankDemotionSteps).toBe(1);
    expect(emil.finalRankConfirmedAt).toBe(confirmedAt.toISOString());

    const preRed = body.pupils.find((p: any) => p.id === 5573);
    expect(preRed.finalRank).toBe('Geselle');
    expect(preRed.rankDemotionSteps).toBe(0);
  });
});

