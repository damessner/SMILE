import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * `GET /api/timeouts/active` used to run one query with no scope predicate at all, so every
 * non-pupil staff account read every class's pupil names and timeout reasons. Scoping it by
 * `teaching_assignments` — the obvious fix — is *also* wrong, because the Lernwerkstatt is a
 * room and the teacher sitting in it is usually not the homeroom teacher of the class the
 * pupil came from.
 *
 * These tests pin the wiring, not the policy: that the scope from `lib/lw-duty.ts` reaches
 * PostgreSQL as a parameterized predicate **before** `LIMIT`, and that a caller with neither
 * duty nor any class never issues the query. The policy itself is covered in `lw-duty.test.ts`.
 */

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  // Keep dotenv from loading the developer's real .env over these values.
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
};

const { queryMock, poolMock, timeoutVisibility, canActOnTimeout, dbSelectMock, dbUpdateReturningMock, dbInsertValuesMock, classAccessMock, findPupilMock, getPupilMock } = vi.hoisted(() => ({
  queryMock: vi.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] as unknown[] })),
  poolMock: vi.fn(() => ({ query: queryMock })),
  timeoutVisibility: vi.fn<(user: unknown) => Promise<{ onDuty: boolean; classIds: number[] | null; forbidden?: boolean }>>(
    async () => ({ onDuty: false, classIds: [] }),
  ),
  canActOnTimeout: vi.fn<(user: unknown, classId: number) => Promise<boolean>>(async () => false),
  dbSelectMock: vi.fn<() => any[]>(() => []),
  dbUpdateReturningMock: vi.fn<() => any[]>(() => []),
  dbInsertValuesMock: vi.fn((_row?: unknown) => undefined),
  classAccessMock: vi.fn(async () => ({ exists: true, canRecord: true })),
  findPupilMock: vi.fn(async (pupilId: number) => ({ id: pupilId })),
  getPupilMock: vi.fn(async (pupilId: number) => ({ id: pupilId })),
}));

function makeChain(result: any) {
  const p: any = Promise.resolve(result);
  p.from = () => p;
  p.where = () => p;
  p.limit = () => p;
  p.orderBy = () => p;
  p.onConflictDoUpdate = () => p;
  p.returning = () => p;
  return p;
}

const dbMock: any = {
  select: vi.fn(() => makeChain(dbSelectMock())),
  update: vi.fn(() => ({
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => dbUpdateReturningMock()),
      })),
    })),
  })),
  insert: vi.fn(() => ({
    values: vi.fn((row: unknown) => {
      dbInsertValuesMock(row);
      return makeChain([row]);
    }),
  })),
};
// `db.transaction(async (tx) => ...)` must hand the callback the same chainable mock.
dbMock.transaction = vi.fn(async (callback: (tx: unknown) => unknown) => callback(dbMock));

vi.mock('../db/index.js', () => ({
  getPool: poolMock,
  db: dbMock,
}));

vi.mock('../lib/lw-duty.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/lw-duty.js')>();
  return { ...actual, timeoutVisibility, canActOnTimeout };
});

// Only the class/pupil lookups are stubbed, so the identity and password checks under test
// still run for real.
vi.mock('../lib/guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guards.js')>();
  return {
    ...actual,
    getClassAccess: classAccessMock,
    findPupilInClass: findPupilMock,
    getPupil: getPupilMock,
  };
});

vi.mock('../ws/live-sync.js', () => ({
  broadcastToClass: vi.fn(),
}));

let app: FastifyInstance | null = null;
/** Swapped per test to decide which identity `authenticate` puts on the request. */
let currentUser: { id: string; username: string; role: 'admin' | 'teacher' | 'pupil'; teacherId?: number } = {
  id: 'u1',
  username: 'tester',
  role: 'teacher',
  teacherId: 42,
};

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { timeoutRoutes } = await import('./timeouts.js');
  const Fastify = (await import('fastify')).default;
  app = Fastify();
  // The real plugin decorates `authenticate`; here it just installs the identity under test.
  app.decorate('authenticate', async (request: any) => {
    request.authUser = currentUser;
  });
  await app.register(timeoutRoutes, { prefix: '/api/timeouts' });
  await app.ready();

  for (const key of Object.keys(process.env)) {
    if (!(key in TEST_ENV)) delete process.env[key];
  }
  Object.assign(process.env, saved);
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  queryMock.mockResolvedValue({ rows: [] });
  timeoutVisibility.mockResolvedValue({ onDuty: false, classIds: [] });
  currentUser = { id: 'u1', username: 'tester', role: 'teacher', teacherId: 42 };
  dbSelectMock.mockReturnValue([]);
  dbUpdateReturningMock.mockReturnValue([]);
  classAccessMock.mockResolvedValue({ exists: true, canRecord: true } as never);
  findPupilMock.mockResolvedValue({ id: 5 } as never);
  getPupilMock.mockResolvedValue({ id: 5 } as never);
});

const get = (url = '/api/timeouts/active') => app!.inject({ method: 'GET', url });

describe('GET /api/timeouts/active — scoping', () => {
  it('applies the class scope inside SQL, before the LIMIT', async () => {
    timeoutVisibility.mockResolvedValue({ onDuty: false, classIds: [3, 4] });

    const res = await get();
    expect(res.statusCode).toBe(200);

    const [sql, params] = queryMock.mock.calls[0]!;
    expect(sql).toContain('($1::bool OR sc.id = ANY($2::int[]))');
    expect(params).toEqual([false, [3, 4]]);

    // The whole point of doing it in SQL: a post-LIMIT filter would silently drop the
    // caller's rows that fall outside the globally newest 100.
    expect(sql.indexOf('sc.id = ANY($2::int[])')).toBeLessThan(sql.indexOf('LIMIT 100'));
  });

  it('still constrains by status and does not leak resolved time-outs', async () => {
    timeoutVisibility.mockResolvedValue({ onDuty: false, classIds: [3] });
    await get();
    const [sql] = queryMock.mock.calls[0]!;
    expect(sql).toMatch(/WHERE\s+ti\.status\s*=\s*'active'/);
  });

  it('grants the duty teacher an unrestricted read', async () => {
    timeoutVisibility.mockResolvedValue({ onDuty: true, classIds: null });
    await get();
    const [, params] = queryMock.mock.calls[0]!;
    expect(params).toEqual([true, null]);
  });

  it('answers without querying when the caller has neither duty nor a single class', async () => {
    timeoutVisibility.mockResolvedValue({ onDuty: false, classIds: [] });
    const res = await get();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('refuses a pupil with 403', async () => {
    currentUser = { id: 'p1', username: 'pupil', role: 'pupil', teacherId: 7 };
    timeoutVisibility.mockResolvedValue({ onDuty: false, classIds: null, forbidden: true });

    const res = await get();
    expect(res.statusCode).toBe(403);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('returns the rows the query produced', async () => {
    timeoutVisibility.mockResolvedValue({ onDuty: true, classIds: null });
    queryMock.mockResolvedValue({ rows: [{ id: 'x', pupil_name: 'Musterkind' }] });

    const res = await get();
    expect(res.json()).toEqual([{ id: 'x', pupil_name: 'Musterkind' }]);
  });
});

describe('POST /api/timeouts/:id/resolve — the duty supervisor is not refused', () => {
  const post = (id: string, body = {}) =>
    app!.inject({ method: 'POST', url: `/api/timeouts/${id}/resolve`, payload: body });

  const VALID_ID = '11111111-2222-3333-4444-555555555555';
  const sampleIncident = {
    id: VALID_ID,
    status: 'active',
    classId: 3,
    pupilId: 5,
    sentAt: new Date(),
  };

  it('consults the shared duty rule rather than teaching assignments and returns 404 on miss', async () => {
    canActOnTimeout.mockResolvedValue(true);
    dbSelectMock.mockReturnValue([]);
    const res = await post(VALID_ID);
    expect(res.statusCode).toBe(404);
  });

  it('refuses with 403 when canActOnTimeout returns false', async () => {
    dbSelectMock.mockReturnValue([sampleIncident]);
    canActOnTimeout.mockResolvedValue(false);

    const res = await post(VALID_ID);
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toContain('Lernwerkstatt-Aufsicht');
    expect(canActOnTimeout).toHaveBeenCalledWith(currentUser, sampleIncident.classId);
  });

  it('allows the duty supervisor to resolve a timeout for a class they do not teach', async () => {
    dbSelectMock.mockReturnValue([sampleIncident]);
    canActOnTimeout.mockResolvedValue(true);
    const resolvedIncident = { ...sampleIncident, status: 'resolved', resolvedBy: 42 };
    dbUpdateReturningMock.mockReturnValue([resolvedIncident]);

    const res = await post(VALID_ID, { resolutionNote: 'Done' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      success: true,
      incident: { ...resolvedIncident, sentAt: sampleIncident.sentAt.toISOString() },
    });
    // Closing the time-out and recording who closed it commit together.
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    expect(dbInsertValuesMock.mock.calls.some(([row]) => (row as any)?.action === 'TIMEOUT_RESOLVED')).toBe(true);
  });

  it('rejects a malformed id before touching the database', async () => {
    const res = await post('not-a-uuid');
    expect(res.statusCode).toBe(400);
    expect(canActOnTimeout).not.toHaveBeenCalled();
  });
});

describe('administrative writes fail closed when the account has no teacher record', () => {
  const issueTimeout = (body: Record<string, unknown>) =>
    app!.inject({ method: 'POST', url: '/api/timeouts', payload: body });
  const acknowledge = (body: Record<string, unknown>) =>
    app!.inject({ method: 'POST', url: '/api/timeouts/escalations/acknowledge', payload: body });

  it('refuses issuing a time-out with 503 instead of writing teacher_id 0', async () => {
    currentUser = { id: 'a1', username: 'admin', role: 'admin' };

    const res = await issueTimeout({ pupilId: 5, classId: 3, taskAssignment: 'Arbeitsauftrag' });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('SYSTEM_ACTOR_NOT_CONFIGURED');
    expect(dbInsertValuesMock).not.toHaveBeenCalled();
  });

  it('refuses acknowledging an escalation with 503 instead of writing handled_by 0', async () => {
    currentUser = { id: 'a1', username: 'admin', role: 'admin' };

    const res = await acknowledge({ pupilId: 5, milestoneCount: 3 });

    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('SYSTEM_ACTOR_NOT_CONFIGURED');
    expect(dbInsertValuesMock).not.toHaveBeenCalled();
    expect(dbMock.transaction).not.toHaveBeenCalled();
  });

  it('acknowledges an escalation and its audit entry inside one transaction', async () => {
    currentUser = { id: 'a1', username: 'admin', role: 'admin', teacherId: 42 };

    const res = await acknowledge({ pupilId: 5, milestoneCount: 3 });

    expect(res.statusCode).toBe(201);
    expect(dbMock.transaction).toHaveBeenCalledTimes(1);
    const actions = dbInsertValuesMock.mock.calls.map(([row]) => (row as any)?.action);
    expect(actions).toContain('TIMEOUT_ESCALATION_RESOLVED');
    expect(dbInsertValuesMock.mock.calls.some(([row]) => (row as any)?.handledBy === 0)).toBe(false);
  });

  it('still attributes a time-out to the real teacher record', async () => {
    const res = await issueTimeout({ pupilId: 5, classId: 3, taskAssignment: 'Arbeitsauftrag' });

    expect(res.statusCode).toBe(201);
    const inserted = dbInsertValuesMock.mock.calls.map(([row]) => row as any);
    expect(inserted.some((row) => row?.teacherId === 42 || row?.sentByTeacherId === 42)).toBe(true);
    expect(inserted.some((row) => row?.teacherId === 0 || row?.sentByTeacherId === 0)).toBe(false);
  });
});

describe('GET /api/timeouts/escalations — milestone counting includes auto-resolved timeouts', () => {
  it('queries total_timeouts with COUNT(ti.id) and no status filter so resolved timeouts trigger escalation', async () => {
    currentUser = { id: 'admin-1', username: 'admin', role: 'admin' };
    const res = await app!.inject({ method: 'GET', url: '/api/timeouts/escalations' });
    expect(res.statusCode).toBe(200);

    const calls = queryMock.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const [sql] = calls[0]!;
    // COUNT(ti.id) counts all incidents for the pupil regardless of status
    expect(sql).toContain('COUNT(ti.id)::int AS total_timeouts');
    // Must NOT filter by status = 'active' — an auto-closed timeout trips milestone 3 just the same
    expect(sql).not.toMatch(/WHERE\s+ti\.status/i);
    expect(sql).not.toMatch(/ti\.status\s*=\s*'active'/i);
  });
});