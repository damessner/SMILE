import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { eq, sql } from 'drizzle-orm';
import { db, closePool, runMigrations } from '../db/index.js';
import * as schema from '../db/schema.js';
import { invalidateRubricCache } from '../lib/rubric.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Probe for a reachable PostgreSQL instance (e.g. smile_db_test via LXC tunnel or TEST_DATABASE_URL).
let testDbUrl: string | null = process.env.TEST_DATABASE_URL ?? null;
if (!testDbUrl) {
  const scratchFile = path.resolve(__dirname, '../../../scratch/test_db_url.txt');
  if (existsSync(scratchFile)) {
    testDbUrl = readFileSync(scratchFile, 'utf8').trim();
  }
}

let isDbReachable = false;
if (testDbUrl) {
  try {
    const probeClient = new pg.Client({
      connectionString: testDbUrl,
      connectionTimeoutMillis: 2000,
    });
    await probeClient.connect();
    await probeClient.query('SELECT 1');
    await probeClient.end();
    isDbReachable = true;
  } catch {
    isDbReachable = false;
  }
}

describe.runIf(isDbReachable)('Evaluations PostgreSQL Integration Tests', () => {
  let app: FastifyInstance | null = null;
  let testRoundId: string;
  let testRubricId: string;
  let testCriterionId: string;

  const TEST_ENV: Record<string, string> = {
    JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
    DATABASE_URL: testDbUrl!,
    NODE_ENV: 'test',
    CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
    SMILE_ENV_FILE: 'no-such-env-file-for-tests',
    SUBMISSION_DEADLINE: '2099-01-01T00:00:00.000Z',
  };

  let savedEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    savedEnv = { ...process.env };
    Object.assign(process.env, TEST_ENV);

    // Ensure database schema is fully migrated before booting server
    await runMigrations();

    const { buildServer } = await import('../index.js');
    app = await buildServer();

    // Clean test tables
    await db.delete(schema.evaluationItems);
    await db.delete(schema.evaluations);
    await db.delete(schema.teachingAssignments);
    await db.delete(schema.pupils);
    await db.delete(schema.schoolClasses);
    await db.delete(schema.teachers);
    await db.delete(schema.rubricCriteria);
    await db.delete(schema.assessmentRubrics);
    await db.delete(schema.observationRounds);

    // 1. Seed Teachers
    await db.insert(schema.teachers).values([
      { id: 101, shortName: 'AUT', fullName: 'Authorized Teacher', active: true },
      { id: 102, shortName: 'UNA', fullName: 'Unauthorized Teacher', active: true },
    ]);

    // 2. Seed Class
    await db.insert(schema.schoolClasses).values({
      id: 501,
      name: '9X',
      grade: 4,
    });

    // 3. Seed Teaching Assignment for Teacher 101 in Class 501 for Deutsch (D)
    await db.insert(schema.teachingAssignments).values({
      id: 901,
      teacherId: 101,
      classId: 501,
      subjectCode: 'D',
      subjectName: 'Deutsch',
    });

    // 4. Seed Pupil in Class 501
    await db.insert(schema.pupils).values({
      id: 7001,
      classId: 501,
      fullName: 'Integration Pupil 1',
      isArchived: false,
    });

    // 5. Seed Active Observation Round
    const [round] = await db
      .insert(schema.observationRounds)
      .values({
        name: 'Integration Test Period',
        isLocked: false,
        startsOn: new Date('2026-09-01T00:00:00.000Z'),
        endsOn: new Date('2099-01-01T00:00:00.000Z'),
      })
      .returning();
    testRoundId = round.id;

    // 6. Seed Default Assessment Rubric and Criteria
    const [rubric] = await db
      .insert(schema.assessmentRubrics)
      .values({
        title: 'SMILE Test Rubric',
        mode: 'rubric_levels',
        isDefault: true,
      })
      .returning();
    testRubricId = rubric.id;

    const [criterion] = await db
      .insert(schema.rubricCriteria)
      .values({
        rubricId: testRubricId,
        name: 'Arbeitsverhalten',
        position: 1,
        items: [
          { key: 'arb_selbstaendig', desc: 'Arbeitet selbstständig' },
          { key: 'arb_sorgfaeltig', desc: 'Arbeitet sorgfältig' },
        ],
      })
      .returning();
    testCriterionId = criterion.id;

    invalidateRubricCache();
  }, 30_000);

  afterAll(async () => {
    if (app) await app.close();
    await closePool();
    if (savedEnv) {
      for (const key of Object.keys(process.env)) {
        if (!(key in savedEnv)) delete process.env[key];
      }
      Object.assign(process.env, savedEnv);
    }
  });

  function sessionCookie(teacherId: number): string {
    return app!.jwt.sign(
      {
        id: `teacher-${teacherId}`,
        username: `teacher${teacherId}`,
        role: 'teacher',
        teacherId,
        mustChangePassword: false,
      },
      { expiresIn: '1h' },
    );
  }

  describe('Rank Forgery Prevention (Behavioral)', () => {
    it('rejects a batch containing 200 fabricated item keys with HTTP 400 and writes 0 items', async () => {
      // Craft 200 fabricated items with fake itemKeys and spoofed criterionId
      const forgedItems = Array.from({ length: 200 }, (_, i) => ({
        itemKey: `forged_item_${i + 1}`,
        rating: '++',
        criterionId: '00000000-0000-0000-0000-000000000000',
      }));

      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          items: forgedItems,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Unbekanntes Beobachtungsmerkmal oder ungültiger Bewertungswert.');

      // Verify that NO items were written to PostgreSQL
      const writtenItems = await db
        .select()
        .from(schema.evaluationItems)
        .innerJoin(schema.evaluations, eq(schema.evaluationItems.evaluationId, schema.evaluations.id))
        .where(eq(schema.evaluations.pupilId, 7001));

      expect(writtenItems).toHaveLength(0);
    });

    it('rejects a mixed batch containing 1 valid item and 1 fabricated item', async () => {
      const mixedItems = [
        { itemKey: 'arb_selbstaendig', rating: '++' },
        { itemKey: 'fabricated_key_x', rating: '++' },
      ];

      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          items: mixedItems,
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Unbekanntes Beobachtungsmerkmal oder ungültiger Bewertungswert.');

      // Rejection is all-or-nothing: ensure even the valid item was not committed
      const writtenItems = await db.select().from(schema.evaluationItems);
      expect(writtenItems).toHaveLength(0);
    });
  });

  describe('Legitimate Writes & Server-Side Criterion Derivation', () => {
    it('saves legitimate items, deriving criterionId server-side and ignoring client-sent criterionId', async () => {
      const spoofedCriterionId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const validPayload = [
        { itemKey: 'arb_selbstaendig', rating: '++', criterionId: spoofedCriterionId },
        { itemKey: 'arb_sorgfaeltig', rating: '+', criterionId: spoofedCriterionId },
      ];

      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          items: validPayload,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.items).toHaveLength(2);

      // Verify in PostgreSQL: criterionId MUST match the actual testCriterionId, NOT spoofedCriterionId
      const savedItems = await db
        .select()
        .from(schema.evaluationItems)
        .innerJoin(schema.evaluations, eq(schema.evaluationItems.evaluationId, schema.evaluations.id))
        .where(eq(schema.evaluations.pupilId, 7001));

      expect(savedItems).toHaveLength(2);
      for (const row of savedItems) {
        expect(row.evaluation_items.criterionId).toBe(testCriterionId);
        expect(row.evaluation_items.criterionId).not.toBe(spoofedCriterionId);
        expect(row.evaluation_items.version).toBe(1);
      }
    });

    it('subsequent batch update modifies rating and increments OCC version to 2', async () => {
      const updatePayload = [
        { itemKey: 'arb_selbstaendig', rating: '-' },
      ];

      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          items: updatePayload,
        },
      });

      expect(res.statusCode).toBe(200);

      const items = await db
        .select()
        .from(schema.evaluationItems)
        .innerJoin(schema.evaluations, eq(schema.evaluationItems.evaluationId, schema.evaluations.id))
        .where(eq(schema.evaluationItems.itemKey, 'arb_selbstaendig'));

      expect(items).toHaveLength(1);
      expect(items[0].evaluation_items.rating).toBe('-');
      expect(items[0].evaluation_items.version).toBe(2);
    });
  });

  describe('Authorization and Pupil Scoping', () => {
    it('refuses teacher without teaching assignment in the class (403)', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(102)}` }, // Teacher 102 has no assignment in 501
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          items: [{ itemKey: 'arb_sorgfaeltig', rating: '+' }],
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toBe('Sie dürfen in dieser Klasse nicht bewerten.');
    });

    it('refuses writing ratings for a pupil belonging to a different class (400)', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 99999, // Pupil does not exist in class 501
          classId: 501,
          subjectCode: 'D',
          items: [{ itemKey: 'arb_sorgfaeltig', rating: '+' }],
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().error).toBe('Dieser Schüler gehört nicht zu dieser Klasse.');
    });
  });

  describe('POST /api/evaluations/batch-default', () => {
    it('applies default rating across active pupils and derives targets from rubric index', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-default',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          classId: 501,
          subjectCode: 'D',
          defaultRating: '+',
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.pupils).toBe(1);
      expect(json.items).toBe(2); // 2 rubric items in test rubric

      // Verify all items are now '+'
      const items = await db
        .select()
        .from(schema.evaluationItems)
        .innerJoin(schema.evaluations, eq(schema.evaluationItems.evaluationId, schema.evaluations.id))
        .where(eq(schema.evaluations.pupilId, 7001));

      expect(items).toHaveLength(2);
      expect(items.every((it) => it.evaluation_items.rating === '+')).toBe(true);
    });
  });

  describe('POST /api/evaluations/status', () => {
    it('updates proposedStatus, nextStep and comment in PostgreSQL', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/status',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          proposedStatus: 'Meister',
          nextStep: 'Selbstständige Projekte',
          comment: 'Hervorragende Arbeitsweise über das gesamte Semester.',
        },
      });

      expect(res.statusCode).toBe(200);

      const [evalRow] = await db
        .select()
        .from(schema.evaluations)
        .where(eq(schema.evaluations.pupilId, 7001));

      expect(evalRow).toBeDefined();
      expect(evalRow.proposedStatus).toBe('Meister');
      expect(evalRow.nextStep).toBe('Selbstständige Projekte');
      expect(evalRow.comment).toBe('Hervorragende Arbeitsweise über das gesamte Semester.');
      expect(evalRow.isSubmitted).toBe(false);
    });
  });
});
