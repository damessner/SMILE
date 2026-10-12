import { readFileSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { getClassRoundLockState } from '../lib/class-round-lock.js';
import { getLatestRound } from '../lib/rounds.js';
import {
  rejectIfClassRoundLocked,
  requireEvaluationActor,
  resolveProposedRank,
  shouldBroadcastStatusUpdate,
} from './evaluations.js';

vi.mock('../lib/class-round-lock.js', () => ({
  getClassRoundLockState: vi.fn(),
  isClassRoundLocked: vi.fn((g: boolean, c: boolean) => Boolean(g || c)),
}));

vi.mock('../lib/rounds.js', () => ({
  getLatestRound: vi.fn(async () => null),
}));

/**
 * Tests for `routes/evaluations.ts` itself.
 *
 * **What this file can and cannot cover.** `/batch-items` and `/status` both reach
 * PostgreSQL on their way to the decision under test (`loadRubricIndex`,
 * `getClassAccess`, `findPupilInClass`, `getOpenRound`, the transaction), and this
 * repository has no database in CI — no container, no `pg-mem`, no fixture
 * (`vitest.config.ts` runs against a closed port, exactly like `index.test.ts`).
 * So there is no honest way here to drive a rating write end to end, and faking
 * the drizzle query builder would only prove that the mock was called. Two things
 * follow, and both are stated rather than papered over:
 *
 *  1. What *is* reachable without a database is tested against the real handler
 *     over `app.inject()`: a `/status` write with an invalid rank is rejected
 *     before the first query, which is the one place a malformed payload is
 *     refused without touching the database.
 *  2. The wiring the whole forgery fix rests on — that the route calls
 *     `validateBatchItems` and iterates *its* output — cannot be pinned by
 *     behaviour at all on this infrastructure. It is pinned structurally below,
 *     which catches the exact revert (restore the inline loop, drop the two
 *     calls) but proves nothing about runtime behaviour. The behavioural fixture
 *     that would close it properly is specified in the report; treat the
 *     behavioural coverage of the item-key forgery fix as still open.
 */

/**
 * Credentials must be set before importing the server, because config.ts resolves
 * and validates them at import time. Syntactically valid, pointed at a closed
 * port, so the lazy pool is never dialled.
 */
const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
  // Far enough out that this file keeps passing after the school deadline; the
  // routes under test refuse writes once it has passed.
  SUBMISSION_DEADLINE: '2099-01-01T00:00:00.000Z',
};

let app: FastifyInstance | null = null;

beforeAll(async () => {
  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('../index.js');
  try {
    app = await buildServer(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
  } finally {
    // Restore immediately; the modules have already captured what they need.
    for (const key of Object.keys(process.env)) {
      if (!(key in TEST_ENV)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}, 30_000);

afterAll(async () => {
  if (app) await app.close();
});

/** A signed session cookie for a teacher who may rate in the class. */
function sessionCookie(app: FastifyInstance): string {
  return app.jwt.sign(
    {
      id: 'teacher-1',
      username: 'abc',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
      sessionVersion: 0,
    },
    { expiresIn: '1h' },
  );
}

describe('POST /api/evaluations/status', () => {
  /**
   * The one `/status` decision that needs no database: `isRank` gates the payload
   * before the first query. Without this ordering an invalid rank would reach
   * `getClassAccess` and the caller would get a connection failure instead of the
   * German validation message.
   */
  it('rejects an invalid rank before touching the database', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { cookie: `smile_session=${sessionCookie(app!)}` },
      payload: {
        pupilId: 1,
        classId: 1,
        subjectCode: 'D',
        proposedStatus: 'Chefmeister',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('proposedStatus muss ein gültiger Rang sein.');
  });

  it('rejects it the same way when a comment rides along', async () => {
    // The comment-carrying payload is what the autosave sends, so the gate has to
    // hold on that shape too. There is no positive control here — a *valid* rank
    // passes this check and then waits on the unreachable database, which makes the
    // control a test of connection timeouts rather than of this guard. The 400 and
    // its message are unambiguous instead: that string exists on exactly one line of
    // the handler, and deleting the `isRank` guard turns this response into a
    // connection failure.
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { cookie: `smile_session=${sessionCookie(app!)}` },
      payload: {
        pupilId: 1,
        classId: 1,
        subjectCode: 'D',
        proposedStatus: 'Chefmeister',
        comment: 'Sehr motiviert',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('proposedStatus muss ein gültiger Rang sein.');
  });

  it('does not authenticate by accident — an anonymous caller is refused first', async () => {
    // Ordering evidence for the test above: the invalid-rank 400 can only be
    // reached by an authenticated caller, so it is a real handler response rather
    // than the 401 the anonymous case returns.
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      payload: { pupilId: 1, classId: 1, subjectCode: 'D', proposedStatus: 'Chefmeister' },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('Subject code validation and authorization on evaluation routes (Task 1.1)', () => {
  it('rejects an unknown subject code on /batch-default with 400', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/batch-default',
      headers: { cookie: `smile_session=${sessionCookie(app!)}` },
      payload: { classId: 1, subjectCode: 'Astronomie', defaultRating: '+', forceOverwrite: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Ungültiges Unterrichtsfach.');
  });

  it('rejects an unknown subject code on /status with 400', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/status',
      headers: { cookie: `smile_session=${sessionCookie(app!)}` },
      payload: { pupilId: 1, classId: 1, subjectCode: 'Astronomie', proposedStatus: 'Geselle' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Ungültiges Unterrichtsfach.');
  });

  it('rejects an unknown subject code on /submit with 400', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/submit',
      headers: { cookie: `smile_session=${sessionCookie(app!)}` },
      payload: { pupilId: 1, classId: 1, subjectCode: 'Astronomie' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Ungültiges Unterrichtsfach.');
  });

  it('rejects an unknown subject code on /reopen with 400', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/reopen',
      headers: { cookie: `smile_session=${sessionCookie(app!)}` },
      payload: { pupilId: 1, classId: 1, subjectCode: 'Astronomie' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Ungültiges Unterrichtsfach.');
  });

  it('rejects an unknown subject code on /batch-items with 400', async () => {
    const res = await app!.inject({
      method: 'POST',
      url: '/api/evaluations/batch-items',
      headers: { cookie: `smile_session=${sessionCookie(app!)}` },
      payload: { pupilId: 1, classId: 1, subjectCode: 'Astronomie', items: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('Ungültiges Unterrichtsfach.');
  });
});

// ---------------------------------------------------------------------------
// Structural guards
//
// These read the route source. They are weaker than a behavioural test and are
// labelled as such: they prove the wiring is present, not that it behaves. They
// exist because the behavioural half cannot be written without a database, and a
// silent revert of the item-key forgery fix must not be free.
// ---------------------------------------------------------------------------

/** Route source with comments stripped, so prose about the old bug cannot match. */
function routeCode(route: string): string {
  const src = readFileSync(new URL('./evaluations.ts', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
  const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`fastify\\.post\\(\\s*['"]${escapedRoute}['"]`).exec(src);
  expect(match, `${route} must be registered`).not.toBeNull();
  const start = match!.index;
  const nextRoute = /fastify\.post\s*\(/g;
  nextRoute.lastIndex = start + match![0].length;
  const next = nextRoute.exec(src);
  return src.slice(start, next?.index);
}

describe('the item-key forgery fix is wired into /batch-items', () => {
  const handler = routeCode('/batch-items');

  it('validates the untrusted body through the shared validator', () => {
    // `items` arrives as `unknown` and is narrowed by the validator; a route that
    // re-implemented the loop would not call it at all.
    expect(handler).toMatch(/const validation = validateBatchItems\(\s*items,\s*rubricIndex,\s*MAX_BATCH_ITEMS,?\s*\)/);
    expect(handler).toMatch(/if \(!validation\.ok\) return badRequest\(reply, validation\.error\)/);
  });

  it('iterates the validated items, not the raw body', () => {
    // The write loop is the second half of the fix: writing the request's own
    // `criterionId` is what made a forged batch inflate a rank.
    expect(handler).toMatch(/for \(const it of validation\.items\)/);
    expect(handler).toMatch(/criterionId: it\.criterionId/);
    expect(handler).not.toMatch(/for \(const it of items/);
  });

  it('rejects the batch before opening a transaction', () => {
    const guard = handler.indexOf('if (!validation.ok)');
    const transaction = handler.indexOf('db.transaction(');
    expect(guard).toBeGreaterThan(-1);
    expect(transaction).toBeGreaterThan(guard);
  });

  it('authorizes before it validates, so a caller without canRate gets 403', () => {
    const access = handler.indexOf('getClassAccess(user, classId)');
    const validation = handler.indexOf('validateBatchItems(');
    expect(access).toBeGreaterThan(-1);
    expect(access).toBeLessThan(validation);
  });
});

describe('/batch-default', () => {
  const handler = routeCode('/batch-default');

  it('authorizes before it validates the default rating', () => {
    const access = handler.indexOf('getClassAccess(user, classId)');
    const validation = handler.indexOf('isValidRating(');
    expect(access).toBeGreaterThan(-1);
    expect(access).toBeLessThan(validation);
  });

  it('takes its write targets from the rubric index it already loaded', () => {
    // One definition of "this item key belongs to this criterion". The previous
    // version re-queried `rubric_criteria` and re-folded it with its own filter.
    expect(handler).toMatch(/const targets = \[\.\.\.rubricIndex\.keyToCriterion\]/);
    expect(handler).not.toMatch(/rubricCriteria/);
    expect(handler).not.toMatch(/assessmentRubrics/);
  });

  it('writes the roster and its items as two batched statements', () => {
    // The per-pupil, per-item loop issued one round trip for every value it wrote (a
    // full class is ~540), each one awaiting the last inside the transaction.
    expect(handler).toMatch(/values\(\s*classPupils\.map\(/);
    expect(handler).toMatch(/values\(itemRows\)/);
    expect(handler).not.toMatch(/for \(const pupil of classPupils\)/);
    expect(handler).not.toMatch(/for \(const target of targets\)/);
  });

  it('matches the returned evaluation ids back to pupils instead of trusting row order', () => {
    expect(handler).toMatch(/returning\(\{ id: evaluations\.id, pupilId: evaluations\.pupilId \}\)/);
    expect(handler).toContain('evaluationIdByPupil');
  });
});

describe('a comment-only /status write is not broadcast', () => {
  it('stays quiet for a payload that carries nothing but the comment', () => {
    // `saveEvaluationComment` posts exactly `{ pupilId, classId, subjectCode,
    // comment }` (`api.ts`), so this is the shape the autosave sends.
    expect(shouldBroadcastStatusUpdate({})).toBe(false);
  });

  it('broadcasts a rank change', () => {
    expect(shouldBroadcastStatusUpdate({ proposedStatus: 'Meister' })).toBe(true);
  });

  it('broadcasts a next-step change', () => {
    expect(shouldBroadcastStatusUpdate({ nextStep: 'Elterngespräch' })).toBe(true);
  });

  it('treats an explicit null as a change, because clearing a rank is one', () => {
    expect(shouldBroadcastStatusUpdate({ proposedStatus: null })).toBe(true);
  });

  it('never looks at the comment, so a rank write carrying one still broadcasts', () => {
    // `comment` is not part of the decision at all: the call site passes only
    // `{ proposedStatus, nextStep }`. A comment that rides along with a rank is
    // broadcast because of the rank, not in spite of the comment.
    const predicate: (payload: { proposedStatus?: string | null; nextStep?: string | null; comment?: string }) => boolean =
      shouldBroadcastStatusUpdate;
    expect(predicate({ comment: 'Sehr motiviert' })).toBe(false);
    expect(predicate({ proposedStatus: 'Geselle', comment: 'Sehr motiviert' })).toBe(true);
  });

  it('the handler gates the broadcast on that decision', () => {
    const handler = routeCode('/status');
    const gate = handler.indexOf('if (shouldBroadcastStatusUpdate(');
    const broadcast = handler.indexOf("type: 'STATUS_UPDATED'");
    expect(gate).toBeGreaterThan(-1);
    expect(broadcast).toBeGreaterThan(gate);
  });
});

describe('resolveProposedRank', () => {
  it('keeps an explicitly chosen rank', () => {
    expect(resolveProposedRank('Lehrling')).toEqual({ ok: true, rank: 'Lehrling' });
    expect(resolveProposedRank('Geselle')).toEqual({ ok: true, rank: 'Geselle' });
    expect(resolveProposedRank('Meister')).toEqual({ ok: true, rank: 'Meister' });
  });

  it('defaults an omitted rank to the neutral one', () => {
    // Submitting without picking a rank is a supported flow, not an error.
    expect(resolveProposedRank(undefined)).toEqual({ ok: true, rank: 'Geselle' });
    expect(resolveProposedRank(null)).toEqual({ ok: true, rank: 'Geselle' });
    expect(resolveProposedRank('')).toEqual({ ok: true, rank: 'Geselle' });
  });

  it('rejects a present-but-invalid rank instead of silently recording Geselle', () => {
    // The old code mapped every unknown value to 'Geselle', so a mistyped rank or a
    // value from a newer client schema downgraded the pupil without any signal.
    for (const bogus of ['geselle', 'GESELLE', 'Meisterin', 'Meister ', 'Lehrling\n', '0', 'Geselle2']) {
      expect(resolveProposedRank(bogus)).toEqual({ ok: false });
    }
  });
});

describe('evaluation actor foreign-key policy', () => {
  it('refuses a rating write when the caller has no usable teacher actor', () => {
    let statusCode = 0;
    let responseBody: any;
    const reply = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      send(body: unknown) {
        responseBody = body;
        return this;
      },
    } as any;

    expect(requireEvaluationActor(undefined, reply)).toBeNull();
    expect(statusCode).toBe(503);
    expect(responseBody.code).toBe('SYSTEM_ACTOR_NOT_CONFIGURED');
    expect(requireEvaluationActor(42, reply)).toBe(42);
    expect(requireEvaluationActor(0, reply)).toBeNull();
    expect(statusCode).toBe(503);
    expect(responseBody.code).toBe('SYSTEM_ACTOR_NOT_CONFIGURED');
    expect(requireEvaluationActor(null, reply)).toBeNull();
  });
});

describe('rejectIfClassRoundLocked', () => {
  it('returns true and responds with 423 CLASS_CONFERENCE_LOCKED when locked', async () => {
    vi.mocked(getClassRoundLockState).mockResolvedValueOnce(true);

    let statusCode = 0;
    let responseBody: any;
    const reply = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      send(body: unknown) {
        responseBody = body;
        return this;
      },
    } as unknown as FastifyReply;

    const result = await rejectIfClassRoundLocked(reply, 'round-1', 101);
    expect(result).toBe(true);
    expect(statusCode).toBe(423);
    expect(responseBody).toEqual({
      error: 'Die Klassenkonferenz ist gesperrt. Bewertungen können nicht mehr geändert werden.',
      code: 'CLASS_CONFERENCE_LOCKED',
    });
    expect(getClassRoundLockState).toHaveBeenCalledWith('round-1', 101);
  });

  it('returns false and does not touch reply when unlocked', async () => {
    vi.mocked(getClassRoundLockState).mockResolvedValueOnce(false);

    let called = false;
    const reply = {
      status() {
        called = true;
        return this;
      },
      send() {
        called = true;
        return this;
      },
    } as unknown as FastifyReply;

    const result = await rejectIfClassRoundLocked(reply, 'round-1', 101);
    expect(result).toBe(false);
    expect(called).toBe(false);
  });
});

describe('Class conference lock enforcement on evaluation mutation routes', () => {
  it('/batch-default guards writes with rejectIfClassRoundLocked after getOpenRound', () => {
    const handler = routeCode('/batch-default');
    const lockCheck = handler.indexOf('rejectIfClassRoundLocked(');
    const roundCheck = handler.indexOf('getOpenRound()');
    expect(lockCheck).toBeGreaterThan(-1);
    expect(lockCheck).toBeGreaterThan(roundCheck);
  });

  it('/status guards writes with rejectIfClassRoundLocked after getOpenRound', () => {
    const handler = routeCode('/status');
    const lockCheck = handler.indexOf('rejectIfClassRoundLocked(');
    const roundCheck = handler.indexOf('getOpenRound()');
    expect(lockCheck).toBeGreaterThan(-1);
    expect(lockCheck).toBeGreaterThan(roundCheck);
  });

  it('/submit guards writes with rejectIfClassRoundLocked after getOpenRound', () => {
    const handler = routeCode('/submit');
    const lockCheck = handler.indexOf('rejectIfClassRoundLocked(');
    const roundCheck = handler.indexOf('getOpenRound()');
    expect(lockCheck).toBeGreaterThan(-1);
    expect(lockCheck).toBeGreaterThan(roundCheck);
  });

  it('/reopen guards writes with rejectIfClassRoundLocked after getOpenRound', () => {
    const handler = routeCode('/reopen');
    const lockCheck = handler.indexOf('rejectIfClassRoundLocked(');
    const roundCheck = handler.indexOf('getOpenRound()');
    expect(lockCheck).toBeGreaterThan(-1);
    expect(lockCheck).toBeGreaterThan(roundCheck);
  });

  it('/batch-items guards writes with rejectIfClassRoundLocked after getOpenRound', () => {
    const handler = routeCode('/batch-items');
    const lockCheck = handler.indexOf('rejectIfClassRoundLocked(');
    const roundCheck = handler.indexOf('getOpenRound()');
    expect(lockCheck).toBeGreaterThan(-1);
    expect(lockCheck).toBeGreaterThan(roundCheck);
  });
});

describe('audit rows commit with the data write they record', () => {
  it.each([
    ['/submit', 'PUPIL_RANKING_SUBMITTED'],
    ['/reopen', 'PUPIL_RANKING_REOPENED'],
  ])('%s writes its audit row through the transaction, not after it', (route, action) => {
    const handler = routeCode(route);

    expect(handler).toContain('db.transaction(');
    expect(handler).toContain('tx.insert(auditLogs)');
    // A bare `db.insert(auditLogs)` would run on a separate connection after the data
    // write committed, which is exactly the audit/data split this guards against.
    expect(handler).not.toContain('db.insert(auditLogs)');
    expect(handler.indexOf(`action: '${action}'`)).toBeGreaterThan(handler.indexOf('tx.insert(auditLogs)'));
  });

  it('/reopen only audits a submission it actually withdrew', () => {
    const handler = routeCode('/reopen');
    expect(handler.indexOf('if (!reopened) return null')).toBeLessThan(
      handler.indexOf("action: 'PUPIL_RANKING_REOPENED'"),
    );
  });
});

describe('getOpenRound resolution policy', () => {
  it('returns the latest round when it is open, even if an older round is closed', async () => {
    const { getOpenRound } = await import('./evaluations.js');
    const rounds = [
      { id: 'round-2', isLocked: true, createdAt: new Date('2026-02-01T00:00:00.000Z') },
      { id: 'round-1', isLocked: false, createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ];
    vi.mocked(getLatestRound).mockResolvedValueOnce(rounds[0] as never);

    // The locked round is the latest one, so no write is allowed - the policy
    // is "look at the newest round only", never "fall back to an older open one".
    expect(await getOpenRound()).toBeNull();
    expect(getLatestRound).toHaveBeenCalledTimes(1);
  });

  it('returns the latest round when it is not locked', async () => {
    const { getOpenRound } = await import('./evaluations.js');
    const open = { id: 'round-2', isLocked: false, createdAt: new Date('2026-02-01T00:00:00.000Z') };
    vi.mocked(getLatestRound).mockResolvedValueOnce(open as never);

    expect(await getOpenRound()).toBe(open);
  });

  it('returns null when there is no round at all', async () => {
    const { getOpenRound } = await import('./evaluations.js');
    vi.mocked(getLatestRound).mockResolvedValueOnce(null as never);

    expect(await getOpenRound()).toBeNull();
  });
});
