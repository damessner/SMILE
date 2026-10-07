import { readFileSync } from 'fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { shouldBroadcastStatusUpdate } from './evaluations.js';

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
    app = await buildServer();
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
  const start = src.indexOf(`fastify.post('${route}'`);
  const next = src.indexOf('fastify.post(', start + 1);
  expect(start, `${route} must be registered`).toBeGreaterThan(-1);
  return src.slice(start, next === -1 ? undefined : next);
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