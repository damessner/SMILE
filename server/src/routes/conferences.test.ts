import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTableName } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { ClassAccess, Identity } from '../lib/guards.js';

/**
 * State the lock-endpoint tests below drive through the mocked modules. Kept in
 * one hoisted object because `vi.mock` factories cannot close over test-file
 * bindings.
 */
const lockState = vi.hoisted(() => ({
  round: null as { id: string; isLocked: boolean } | null,
  classLockRow: null as { isLocked: boolean } | null,
  pupil: null as { id: number; classId: number } | null,
  /** Rows the batched class-roster lookup sees; null falls back to the single `pupil`. */
  roster: null as Array<{ id: number; classId: number }> | null,
  access: null as Record<string, unknown> | null,
  broadcasts: [] as Array<{ classId: number; payload: Record<string, unknown> }>,
  inserts: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  updates: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  deletes: [] as Array<{ table: unknown }>,
  transactionCalls: 0,
  /** Flips the audit-log insert into a failure so tests can pin fail-closed writes. */
  auditInsertFails: false,
  // The schema tables as the mocked db sees them (same module instance the route
  // under test imports), so tests can assert which table a write targeted.
  schemaTables: {} as Record<string, unknown>,
}));

// The lock handler's decision inputs are exactly: who the caller is, whether a
// round exists, and what the row says. Mocking only those keeps the test honest
// about the endpoint logic while the rest of the DB layer stays real code paths.
vi.mock('../ws/live-sync.js', () => ({
  broadcastToClass: vi.fn((classId: number, payload: Record<string, unknown>) => {
    lockState.broadcasts.push({ classId, payload });
  }),
  resetLiveSyncForTests: vi.fn(),
}));

vi.mock('../lib/guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guards.js')>();
  return {
    ...actual,
    getClassAccess: vi.fn(async () => lockState.access),
  };
});

vi.mock('../db/index.js', async (importOriginal) => {
  const { getTableName } = await import('drizzle-orm');
  const schema = await import('../db/schema.js');
  /**
   * Identify a table by its physical name rather than by module identity: the
   * mocked db and the route under test can end up holding distinct instances of
   * the same schema export (a dynamically imported module is a separate module
   * instance under vitest), which would silently send reads down the wrong branch.
   */
  const tableName = (table: unknown): string | null => {
    try {
      return getTableName(table as never);
    } catch {
      return null;
    }
  };
  lockState.schemaTables = {
    classRoundLocks: schema.classRoundLocks,
    observationRounds: schema.observationRounds,
    finalRanks: schema.finalRanks,
    auditLogs: schema.auditLogs,
    pupils: schema.pupils,
  };
  const recordedInsert = (table: unknown, values: Record<string, unknown>) => {
    lockState.inserts.push({ table, values });
    if (lockState.auditInsertFails && tableName(table) === 'audit_logs') {
      return Promise.reject(new Error('audit log unavailable'));
    }
    return Promise.resolve();
  };
  let source: unknown = null;
  const rowsFor = (): unknown[] => {
    const name = tableName(source);
    if (name === 'class_round_locks') {
      return lockState.classLockRow ? [lockState.classLockRow] : [];
    }
    if (name === 'pupils') {
      // `getPupil` and the batched class-roster check read through the same builder.
      if (lockState.roster) return lockState.roster;
      return lockState.pupil ? [lockState.pupil] : [];
    }
    return lockState.round ? [lockState.round] : [];
  };
  /**
   * Drizzle builders are thenable, so `await ...where(...)` yields rows directly while
   * `...where(...).limit(1)` still resolves through `limit()`.
   */
  const results = () => {
    const pending = Promise.resolve(rowsFor()) as Promise<unknown[]> & {
      limit: () => Promise<unknown[]>;
      orderBy: () => unknown;
      where: () => unknown;
    };
    pending.limit = async () => rowsFor();
    pending.orderBy = () => pending;
    pending.where = () => pending;
    return pending;
  };
  const query = {
    from: (table: unknown) => {
      source = table;
      return query;
    },
    where: () => results(),
    orderBy: () => results(),
  };
  /**
   * The write API shared by the top-level mock and the transaction callback.
   *
   * Decision endpoints (`/vote`, `/vote-all`) write through `db.transaction`, so the
   * callback must receive the same chainable insert/delete/update the route uses outside
   * a transaction; a narrower copy would let a route pass these tests while breaking in
   * production.
   */
  const writeApi = {
      insert: (table: unknown) => ({
        values: (values: Record<string, unknown>) => {
          // `insert().values()` is awaitable on its own (audit rows) and continues
          // into `.onConflictDoUpdate()` for the upserts, which may return rows.
          const pending = recordedInsert(table, values).then(() => undefined);
          const chain = pending as Promise<unknown> & {
            onConflictDoUpdate: () => Promise<unknown> & { returning: () => Promise<Array<Record<string, unknown>>> };
          };
          chain.onConflictDoUpdate = () => {
            const upserted = pending.then(() => undefined) as Promise<unknown> & {
              returning: () => Promise<Array<Record<string, unknown>>>;
            };
            upserted.returning = async () => {
              if (tableName(table) === 'final_ranks') {
                return [{ confirmedAt: new Date('2026-01-01T00:00:00.000Z') }];
              }
              return [];
            };
            return upserted;
          };
          return chain;
        },
      }),
      delete: (table: unknown) => ({
        where: async () => {
          lockState.deletes.push({ table });
        },
      }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => {
          lockState.updates.push({ table, values });
          return { where: async () => undefined };
        },
      }),
  };

  return {
    ...(await importOriginal<typeof import('../db/index.js')>()),
    db: {
      select: () => query,
      ...writeApi,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        lockState.transactionCalls += 1;
        // Roll back on failure, the way a real transaction does. Without this the
        // "leaves no lock row behind" test could not tell an atomic write from a
        // half-applied one.
        const writesSoFar = lockState.inserts.length;
        const deletesSoFar = lockState.deletes.length;
        try {
          return await fn(writeApi);
        } catch (error) {
          lockState.inserts.length = writesSoFar;
          lockState.deletes.length = deletesSoFar;
          throw error;
        }
      },
    },
  };
});

/** Minimal ClassAccess with only the fields the summary gate reads. */
function access(overrides: Partial<ClassAccess> = {}): ClassAccess {
  return {
    classId: 2,
    exists: true,
    isAdmin: false,
    isHeadmaster: false,
    isKv: false,
    teaches: false,
    isCoreTeacher: false,
    subjects: [],
    canRead: false,
    canRecord: false,
    canRate: false,
    canManagePupils: false,
    canRunConference: false,
    ...overrides,
  };
}

/**
 * The conference summary carries every pupil in the class, every behaviour card with
 * its note, every teacher's free-text `comment`/`nextStep`, and every final rank.
 * The gate must therefore rest on `canRead` alone.
 */
describe('conference summary authorization', () => {
  it('refuses a teacher who is not responsible for the class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    // A teacher who teaches 1B, asking about 2C. They have a teacherId — which is
    // exactly what defeated the previous `!access.canRead && !user.teacherId` guard.
    const user: Identity = { role: 'teacher', teacherId: 7 };
    expect(canReadConferenceSummary(user, access({ classId: 3 }))).toBe(false);
  });

  it('refuses a homeroom head of a different class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(canReadConferenceSummary({ role: 'head_teacher', teacherId: 9 }, access())).toBe(false);
  });

  it('refuses a pupil-role account even if a teacherId is present', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(canReadConferenceSummary({ role: 'pupil', teacherId: 7 }, access())).toBe(false);
  });

  it('allows a teacher assigned to that class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(canReadConferenceSummary({ role: 'teacher', teacherId: 7 }, access({ canRead: true }))).toBe(true);
  });

  it('allows the homeroom head of that class', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(
      canReadConferenceSummary({ role: 'head_teacher', teacherId: 9 }, access({ canRead: true, isKv: true })),
    ).toBe(true);
  });

  it('allows school leadership and the administrator', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    expect(
      canReadConferenceSummary({ role: 'head_teacher', teacherId: 1 }, access({ canRead: true, isHeadmaster: true })),
    ).toBe(true);
    expect(canReadConferenceSummary({ role: 'admin' }, access({ canRead: true, isAdmin: true }))).toBe(true);
  });

  it('does not widen when the class does not exist', async () => {
    const { canReadConferenceSummary } = await import('./conferences.js');
    // `exists` is checked by the route before this gate; the gate must not read as
    // "permitted" merely because a caller can read *some* class.
    expect(canReadConferenceSummary({ role: 'teacher', teacherId: 7 }, access({ exists: false }))).toBe(false);
  });
});

describe('conference decision metadata', () => {
  const savedEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.resetModules();
  });

  it('uses the actual recording instant separately from the planned meeting date', async () => {
    process.env.SMILE_ENV_FILE = 'no-such-env-file-for-conference-date-tests';
    process.env.OFFICIAL_CONFERENCE_DATE = '2099-11-03T21:59:00.000Z';
    vi.resetModules();
    const { createConferenceConfirmationMetadata } = await import('./conferences.js');
    const recordedAt = new Date('2026-10-07T14:00:00.000Z');

    const metadata = createConferenceConfirmationMetadata(recordedAt);

    expect(metadata.confirmedAt).toEqual(recordedAt);
    expect(metadata.overrideReason).toBe('Beschluss der Klassenkonferenz vom 2099-11-03');
  });
});

/**
 * The rank a pupil is shown is what the school records and prints, so these two
 * decisions are pinned as pure functions rather than only through the route, which
 * cannot be exercised without a database.
 */
describe('submitted conference proposals', () => {
  it('keeps withdrawn proposals pending and excludes them from every weighted rank total', async () => {
    const { summarizeSubmittedTeacherVotes } = await import('./conferences.js');
    const summary = summarizeSubmittedTeacherVotes([
      { teacherId: 1, teacherShort: 'MUE', teacherName: 'MUE', subjectCode: 'D', isSubmitted: true, submittedAt: new Date(), proposedStatus: 'Meister', positiveCount: 14, totalRated: 18, hours: 4, weight: 4, isTeamTeaching: true },
      { teacherId: 2, teacherShort: 'SCH', teacherName: 'SCH', subjectCode: 'M', isSubmitted: false, submittedAt: null, proposedStatus: 'Lehrling', positiveCount: 4, totalRated: 18, hours: 4, weight: 8, isTeamTeaching: true },
      { teacherId: 3, teacherShort: 'WEB', teacherName: 'WEB', subjectCode: 'BO', isSubmitted: true, submittedAt: new Date(), proposedStatus: 'Geselle', positiveCount: 8, totalRated: 18, hours: 2, weight: 2, isTeamTeaching: false },
    ]);

    expect(summary.teacherVotes.map((vote) => vote.proposedStatus)).toEqual([
      'Meister',
      null,
      'Geselle',
    ]);
    expect(summary.submittedTeachers).toBe(2);
    expect(summary.voteCounts).toEqual({ Lehrling: 0, Geselle: 1, Meister: 1 });
    expect(summary.hours).toEqual({ Lehrling: 0, Geselle: 2, Meister: 8, total: 10 });
  });
});

describe('hours-weighted suggestion', () => {
  it('returns the strict leader', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    expect(hoursWeightedSuggestion(0, 8, 0)).toBe('Geselle');
    expect(hoursWeightedSuggestion(0, 0, 8)).toBe('Meister');
    expect(hoursWeightedSuggestion(8, 0, 0)).toBe('Lehrling');
    expect(hoursWeightedSuggestion(0, 6, 2)).toBe('Geselle');
  });

  it('returns null for a deadlocked three-way split instead of the top rank', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    // The regression: the old test was `hoursMeister >= hoursGeselle && >=
    // hoursLehrling`, so 1-1-1 produced MEISTER and a deadlocked conference recorded
    // the pupil at the top of the scale.
    expect(hoursWeightedSuggestion(1, 1, 1)).toBeNull();
  });

  it('returns null for a two-way tie', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    expect(hoursWeightedSuggestion(0, 4, 4)).toBeNull();
    expect(hoursWeightedSuggestion(4, 4, 0)).toBeNull();
  });

  it('returns null when nobody has voted', async () => {
    const { hoursWeightedSuggestion } = await import('./conferences.js');
    expect(hoursWeightedSuggestion(0, 0, 0)).toBeNull();
  });
});

describe('presented rank', () => {
  it('shows nothing when the conference has not decided', async () => {
    const { presentRank } = await import('./conferences.js');
    // Never back-filled with a computed value: an undecided pupil must look undecided.
    expect(presentRank(null, 'Geselle', false).presentedRank).toBeNull();
    expect(presentRank(undefined, null, false).presentedRank).toBeNull();
  });

  it('shows the recorded decision when there is one', async () => {
    const { presentRank } = await import('./conferences.js');
    expect(presentRank('Meister', 'Geselle', false).presentedRank).toBe('Meister');
  });

  it('keeps a confirmed rank as the official decision and demotes only the suggestion', async () => {
    const { presentRank } = await import('./conferences.js');
    // The suggestion is the advice shown before confirmation; it is demoted once.
    // The stored final rank is the official decision and must not be demoted again
    // (otherwise accepting a demoted suggestion would lose a second stage).
    expect(presentRank('Meister', 'Meister', true).presentedRank).toBe('Meister');
    expect(presentRank('Meister', 'Meister', true).suggestedRank).toBe('Geselle');
    expect(presentRank('Geselle', 'Geselle', true).presentedRank).toBe('Geselle');
    expect(presentRank('Geselle', 'Geselle', true).suggestedRank).toBe('Lehrling');
  });

  it('never demotes the suggestion below Lehrling', async () => {
    const { presentRank } = await import('./conferences.js');
    expect(presentRank(null, 'Lehrling', true).suggestedRank).toBe('Lehrling');
  });

  it('reports the demotion so the screen can explain it', async () => {
    const { presentRank } = await import('./conferences.js');
    expect(presentRank('Meister', 'Meister', true).hasRedCardDemotion).toBe(true);
    expect(presentRank('Meister', 'Meister', false).hasRedCardDemotion).toBe(false);
    expect(presentRank(null, null, true).hasRedCardDemotion).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// POST /api/conferences/:classId/lock — the voting lock writer.
//
// The endpoint used to mutate the shared observation_rounds.is_locked flag for
// every class; it now upserts a per-class row in class_round_locks. The tests
// below pin the properties that rewrite rests on: the effective lock state is
// what clients are told, the global flag is never written again, and failures
// leave no half-applied state behind.
// ---------------------------------------------------------------------------

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
  SUBMISSION_DEADLINE: '2099-01-01T00:00:00.000Z',
};

let lockApp: FastifyInstance | null = null;

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('../index.js');
  try {
    lockApp = await buildServer(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
    await lockApp.ready();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in TEST_ENV)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}, 30_000);

afterAll(async () => {
  if (lockApp) await lockApp.close();
});

/**
 * Physical table name of a mocked write target. Used by assertions that need to
 * say "the lock row" or "the audit row" without importing the schema table the
 * route happens to hold.
 */
function tableName(table: unknown): string | null {
  try {
    return getTableName(table as never);
  } catch {
    return null;
  }
}

/** A signed session cookie for a caller the mocked access check will allow. */
function lockSessionCookie(app: FastifyInstance): string {  return app.jwt.sign(
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

function resetLockState(): void {
  lockState.round = { id: 'round-1', isLocked: false };
  lockState.classLockRow = { isLocked: false };
  lockState.pupil = { id: 7001, classId: 1 };
  lockState.roster = null;
  lockState.access = { classId: 1, exists: true, canRunConference: true, canRead: true };
  lockState.broadcasts = [];
  lockState.inserts = [];
  lockState.updates = [];
  lockState.deletes = [];
  lockState.transactionCalls = 0;
  lockState.auditInsertFails = false;
}

describe('POST /api/conferences/:classId/lock', () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetLockState();
  });

  it('broadcasts the effective lock state, not just the class row, when the round is closed', async () => {
    // A class unlock must not make a globally-closed round look open: the client
    // stores this payload into the same map entry SYNCED fills with the effective
    // OR, so the two must agree or the grid renders writable during a closed round.
    resetLockState();
    lockState.round = { id: 'round-1', isLocked: true };
    lockState.classLockRow = { isLocked: false };

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/lock',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { isLocked: false },
    });

    expect(res.statusCode).toBe(200);
    expect(lockState.broadcasts).toHaveLength(1);
    const [sent] = lockState.broadcasts;
    expect(sent.classId).toBe(1);
    expect(sent.payload).toMatchObject({
      type: 'VOTING_LOCK_CHANGED',
      classId: 1,
      roundId: 'round-1',
      isLocked: true,
      changedBy: 1,
    });
  });

  it('never writes the shared observation_rounds flag again', async () => {
    resetLockState();
    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/lock',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { isLocked: true },
    });

    expect(res.statusCode).toBe(200);
    // A regression that re-couples the conference lock to observation_rounds
    // would show up here as an update call on the rounds table.
    expect(lockState.updates).toHaveLength(0);
    expect(lockState.inserts.some((i) => i.table === lockState.schemaTables.classRoundLocks)).toBe(true);
    expect(lockState.inserts.some((i) => i.table === lockState.schemaTables.observationRounds)).toBe(false);
  });

  it('refuses a caller without canRunConference before any write or broadcast', async () => {
    resetLockState();
    lockState.access = { classId: 1, exists: true, canRunConference: false, canRead: true };

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/lock',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { isLocked: true },
    });

    expect(res.statusCode).toBe(403);
    expect(lockState.inserts).toHaveLength(0);
    expect(lockState.broadcasts).toHaveLength(0);
  });

  it('rejects the write when no round is open, without persisting or broadcasting', async () => {
    resetLockState();
    lockState.round = null;

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/lock',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { isLocked: true },
    });

    expect(res.statusCode).toBe(400);
    expect(lockState.inserts).toHaveLength(0);
    expect(lockState.broadcasts).toHaveLength(0);
  });

  it('writes the lock row and its audit entry inside a single transaction', async () => {
    // Two writes that must agree: a lock row with no audit trail is an
    // unexplainable freeze, and an audit trail with no lock row is a phantom
    // one. Only a transaction makes them match.
    resetLockState();

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/lock',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { isLocked: true },
    });

    expect(res.statusCode).toBe(200);
    expect(lockState.transactionCalls).toBe(1);
    const tables = lockState.inserts.map((i) => tableName(i.table));
    expect(tables).toContain('class_round_locks');
    expect(tables).toContain('audit_logs');
    // The broadcast is a side effect of the committed state, so it follows the
    // commit rather than preceding it.
    expect(lockState.broadcasts).toHaveLength(1);
  });

  it('leaves no lock row behind when the audit write fails', async () => {
    // The half-applied state this guards against: the class freeze lands, the
    // audit insert throws, and the row stays written anyway. A transaction
    // undoes the lock row; the mocked one below rolls back exactly that.
    resetLockState();
    lockState.auditInsertFails = true;

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/lock',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { isLocked: true },
    });

    expect(res.statusCode).toBe(500);
    expect(lockState.inserts.some((i) => tableName(i.table) === 'class_round_locks')).toBe(false);
    expect(lockState.inserts.some((i) => tableName(i.table) === 'audit_logs')).toBe(false);
    expect(lockState.broadcasts).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The decision endpoints (/vote, /vote-all) while the class is locked.
//
// Locking the class freezes *aggregation* (the summary the board reads), not the
// Beschluss itself: a conference that changed its mind mid-meeting still has to
// be able to record and revoke a rank. What it must never do is write aggregates
// while frozen, so every decision still goes through audit + broadcast.
// ---------------------------------------------------------------------------

describe('conference decisions remain usable while the class is locked', () => {
  afterEach(() => {
    vi.clearAllMocks();
    resetLockState();
  });

  it('records a confirmed rank while the class is locked', async () => {
    resetLockState();
    lockState.classLockRow = { isLocked: true };

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { pupilId: 7001, rank: 'Meister' },
    });

    expect(res.statusCode).toBe(200);
    // The write happened: an upsert on final_ranks, not a rejection.
    expect(lockState.inserts.some((i) => i.table === lockState.schemaTables.finalRanks)).toBe(true);
    expect(lockState.broadcasts.some((b) => b.payload.type === 'FINAL_RANK_CONFIRMED')).toBe(true);
  });

  it('revokes a rank while the class is locked', async () => {
    resetLockState();
    lockState.classLockRow = { isLocked: true };

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { pupilId: 7001, action: 'unconfirm' },
    });

    expect(res.statusCode).toBe(200);
    expect(lockState.deletes.some((d) => d.table === lockState.schemaTables.finalRanks)).toBe(true);
    expect(lockState.broadcasts.some((b) => b.payload.type === 'FINAL_RANK_REVOKED')).toBe(true);
  });

  it('commits a confirmed rank and its audit entry in one transaction', async () => {
    resetLockState();

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { pupilId: 7001, rank: 'Meister' },
    });

    expect(res.statusCode).toBe(200);
    expect(lockState.transactionCalls).toBe(1);
    const tables = lockState.inserts.map((i) => tableName(i.table));
    expect(tables).toContain('final_ranks');
    expect(tables).toContain('audit_logs');
  });

  it('writes no revocation at all when its audit entry fails', async () => {
    // The half-applied state that must not exist: the conference decision is deleted from
    // final_ranks and the CONFERENCE_VOTE_REVOKED row never lands, so an official record
    // changed with no evidence of who withdrew it.
    resetLockState();
    lockState.auditInsertFails = true;

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { pupilId: 7001, action: 'unconfirm' },
    });

    expect(res.statusCode).toBe(500);
    expect(lockState.deletes.some((d) => d.table === lockState.schemaTables.finalRanks)).toBe(false);
    expect(lockState.broadcasts.some((b) => b.payload.type === 'FINAL_RANK_REVOKED')).toBe(false);
  });

  it('writes a whole class with one batched upsert instead of one statement per pupil', async () => {
    resetLockState();
    lockState.roster = [
      { id: 7001, classId: 1 },
      { id: 7002, classId: 1 },
      { id: 7003, classId: 1 },
    ];

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote-all',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: {
        items: [
          { pupilId: 7001, rank: 'Meister' },
          { pupilId: 7002, rank: 'Geselle' },
          { pupilId: 7003, rank: 'Lehrling' },
        ],
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, count: 3 });
    const rankInserts = lockState.inserts.filter((i) => i.table === lockState.schemaTables.finalRanks);
    expect(rankInserts).toHaveLength(1);
    expect(rankInserts[0]!.values).toHaveLength(3);
    expect(lockState.inserts.filter((i) => i.table === lockState.schemaTables.auditLogs)).toHaveLength(1);
  });

  it('refuses the whole batch when any pupil belongs to another class', async () => {
    resetLockState();
    lockState.roster = [{ id: 7001, classId: 99 }];

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote-all',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { items: [{ pupilId: 7001, rank: 'Meister' }] },
    });

    expect(res.statusCode).toBe(400);
    expect(lockState.inserts).toHaveLength(0);
  });

  it('confirms a whole class in one transaction while the class is locked', async () => {
    resetLockState();
    lockState.classLockRow = { isLocked: true };

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote-all',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { items: [{ pupilId: 7001, rank: 'Meister' }] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ success: true, count: 1 });
    // No lock guard may short-circuit the transaction before any write lands.
    expect(lockState.inserts.length).toBeGreaterThan(1);
  });

  it('does not broadcast a confirmation the pupil could not be attached to', async () => {
    resetLockState();
    lockState.classLockRow = { isLocked: true };
    lockState.pupil = { id: 7001, classId: 2 };

    const res = await lockApp!.inject({
      method: 'POST',
      url: '/api/conferences/1/vote',
      headers: { cookie: 'smile_session=' + lockSessionCookie(lockApp!) },
      payload: { pupilId: 7001, rank: 'Meister' },
    });

    expect(res.statusCode).toBe(400);
    expect(lockState.inserts).toHaveLength(0);
    expect(lockState.broadcasts).toHaveLength(0);
  });
});
