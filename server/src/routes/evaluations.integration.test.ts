import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import * as schema from '../db/schema.js';
import {
  getIntegrationTestMode,
  createTestDatabaseClientConfig,
  probeTestDatabaseConnection,
  validateTestDatabaseUrl,
  verifyTestDatabaseConnection,
} from '../lib/test-db-guard.js';

class IntegrationSocket {
  readyState = 1;
  closeCode: number | undefined;
  messages: Array<Record<string, unknown>> = [];
  private handlers = new Map<string, (...args: any[]) => unknown>();

  on(event: string, handler: (...args: any[]) => unknown): void {
    this.handlers.set(event, handler);
  }

  send(raw: string): void {
    this.messages.push(JSON.parse(raw));
  }

  close(code = 1000): void {
    this.closeCode = code;
    this.readyState = 3;
    void this.handlers.get('close')?.();
  }

  async receive(message: unknown): Promise<void> {
    await this.handlers.get('message')?.(Buffer.from(JSON.stringify(message)));
  }
}

// Probe for an explicitly configured PostgreSQL instance exclusively via TEST_DATABASE_URL.
// Silent fallback to scratch files is disabled to avoid accidental target selection.
const integrationMode = getIntegrationTestMode({
  testDatabaseUrl: process.env.TEST_DATABASE_URL,
  skipRequested: process.env.SKIP_POSTGRES_INTEGRATION === 'true' || (!process.env.TEST_DATABASE_URL && process.env.CI !== 'true'),
  ci: process.env.CI === 'true',
});
const testDbUrl = integrationMode.run ? integrationMode.url : null;
const testDbTarget = testDbUrl ? validateTestDatabaseUrl(testDbUrl) : null;
const isDbReachable = integrationMode.run;

if (integrationMode.run) {
  try {
    await probeTestDatabaseConnection(integrationMode.url);
  } catch {
    throw new Error(
      'Integration database probe failed. Verify the disposable target and least-privilege role; connection details are redacted.'
    );
  }
} else {
  console.warn(`[evaluations.integration.test] Skipping PostgreSQL tests: ${integrationMode.reason}.`);
}

// Safety unit tests running unconditionally
describe('Database Target Safety Guard', () => {
  it('rejects a non-test database name before connecting', () => {
    expect(() =>
      validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/smile_db')
    ).toThrow("Refusing target database: 'smile_db'");

    expect(() =>
      validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/postgres')
    ).toThrow("Refusing target database: 'postgres'");
  });
});

describe.runIf(isDbReachable)('Evaluations PostgreSQL Integration Tests', () => {
  let app: FastifyInstance | null = null;
  let db: typeof import('../db/index.js').db;
  let closePool: typeof import('../db/index.js').closePool;
  let getPool: typeof import('../db/index.js').getPool;
  let verifyConfiguredTestPool: (requireEmpty: boolean) => Promise<void>;
  let runMigrations: typeof import('../db/index.js').runMigrations;
  let invalidateRubricCache: typeof import('../lib/rubric.js').invalidateRubricCache;
  let schemaReady = false;
  let testRoundId: string | undefined;
  let testRubricId: string | undefined;
  let testCriterionId: string;

  const FIXTURE_TEACHER_IDS = [101, 102];
  const FIXTURE_CLASS_IDS = [501, 502];
  const FIXTURE_ASSIGNMENT_IDS = [901, 902, 903];
  const FIXTURE_PUPIL_IDS = [7001, 7002];
  const TEST_USER_IDS = {
    teacher101: '00000000-0000-0000-0000-000000000101',
    teacher102: '00000000-0000-0000-0000-000000000102',
    admin: '00000000-0000-0000-0000-000000000999',
  };
  const FIXTURE_USER_IDS = Object.values(TEST_USER_IDS);

  async function cleanTestFixtures() {
    await verifyConfiguredTestPool(false);
    await db.execute(sql`
      DELETE FROM pupil_behavior_actions
      WHERE pupil_id IN (${sql.join(FIXTURE_PUPIL_IDS.map((id) => sql`${id}`), sql`, `)})
    `);
    await db.execute(sql`
      DELETE FROM evaluation_items
      WHERE evaluation_id IN (
        SELECT id FROM evaluations WHERE pupil_id IN (${sql.join(FIXTURE_PUPIL_IDS.map((id) => sql`${id}`), sql`, `)})
      )
    `);
    await db.delete(schema.evaluations).where(inArray(schema.evaluations.pupilId, FIXTURE_PUPIL_IDS));
    await db.delete(schema.passwordResets).where(inArray(schema.passwordResets.userId, FIXTURE_USER_IDS));
    await db.delete(schema.users).where(inArray(schema.users.id, FIXTURE_USER_IDS));
    await db.delete(schema.teachingAssignments).where(inArray(schema.teachingAssignments.id, FIXTURE_ASSIGNMENT_IDS));
    await db.delete(schema.pupils).where(inArray(schema.pupils.id, FIXTURE_PUPIL_IDS));
    await db.delete(schema.schoolClasses).where(inArray(schema.schoolClasses.id, FIXTURE_CLASS_IDS));
    for (const tid of FIXTURE_TEACHER_IDS) {
      await db.delete(schema.teachers).where(eq(schema.teachers.id, tid));
    }
    await db.delete(schema.classRoundLocks).where(inArray(schema.classRoundLocks.classId, FIXTURE_CLASS_IDS));
    if (testRubricId) {
      await db.delete(schema.rubricCriteria).where(eq(schema.rubricCriteria.rubricId, testRubricId));
      await db.delete(schema.assessmentRubrics).where(eq(schema.assessmentRubrics.id, testRubricId));
    }
    if (testRoundId) {
      await db.delete(schema.observationRounds).where(eq(schema.observationRounds.id, testRoundId));
    }
    await db.delete(schema.auditLogs).where(and(
      inArray(schema.auditLogs.entity, ['pupil', 'class']),
      inArray(schema.auditLogs.entityId, [...FIXTURE_PUPIL_IDS, ...FIXTURE_CLASS_IDS].map(String)),
    ));
  }

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
    if (!testDbUrl) throw new Error('PostgreSQL test setup ran without a validated URL.');
    savedEnv = { ...process.env };
    Object.assign(process.env, TEST_ENV);

    // Import the DB pool and config only after replacing DATABASE_URL and disabling
    // dotenv's developer .env lookup. Bind the migration/cleanup pool to the exact
    // canonical fields that the preflight probe verified; do not reconnect from the
    // raw URL after checking a separate probe socket.
    const configModule = await import('../config.js');
    if (configModule.databaseUrl() !== testDbUrl) {
      throw new Error('Integration database configuration does not match the validated test target.');
    }
    const dbModule = await import('../db/index.js');
    dbModule.configureIntegrationTestPool(createTestDatabaseClientConfig(testDbUrl));
    db = dbModule.db;
    getPool = dbModule.getPool;
    closePool = dbModule.closePool;
    runMigrations = dbModule.runMigrations;
    verifyConfiguredTestPool = async (requireEmpty: boolean) => {
      const client = await getPool().connect();
      try {
        await verifyTestDatabaseConnection(client, testDbTarget!.user, { requireEmpty });
      } finally {
        client.release();
      }
    };
    const rubricModule = await import('../lib/rubric.js');
    invalidateRubricCache = rubricModule.invalidateRubricCache;

    verifyConfiguredTestPool = async (requireEmpty: boolean) => {
      const client = await getPool().connect();
      try {
        await verifyTestDatabaseConnection(client, testDbTarget!.user, { requireEmpty });
      } finally {
        client.release();
      }
    };

    // Verify the actual migration pool session and emptiness immediately before
    // running any migration. Cleanup repeats identity/privilege verification but
    // does not require the migrated test schema to be empty.
    await verifyConfiguredTestPool(true);
    await runMigrations();
    schemaReady = true;

    const { buildServer } = await import('../index.js');
    app = await buildServer();

    // 1. Seed Teachers
    await db.insert(schema.teachers).values([
      { id: 101, shortName: 'AUT', fullName: 'Authorized Teacher', active: true },
      { id: 102, shortName: 'UNA', fullName: 'Unauthorized Teacher', active: true },
    ]);

    const syntheticPasswordHash = await bcrypt.hash('OldTestPassword123', 4);
    await db.insert(schema.users).values([
      {
        id: TEST_USER_IDS.teacher101,
        username: 'teacher101',
        passwordHash: syntheticPasswordHash,
        role: 'teacher',
        teacherId: 101,
        mustChangePassword: false,
        sessionVersion: 0,
      },
      {
        id: TEST_USER_IDS.teacher102,
        username: 'teacher102',
        passwordHash: syntheticPasswordHash,
        role: 'teacher',
        teacherId: 102,
        mustChangePassword: false,
        sessionVersion: 0,
      },
      {
        id: TEST_USER_IDS.admin,
        username: 'test-admin',
        passwordHash: syntheticPasswordHash,
        role: 'admin',
        mustChangePassword: false,
        sessionVersion: 0,
      },
    ]);

    // 2. Seed Classes
    await db.insert(schema.schoolClasses).values([
      { id: 501, name: '9X', grade: 4, headTeacher1: 'AUT' },
      { id: 502, name: '9Y', grade: 4, headTeacher1: 'UNA' },
    ]);

    // 3. Seed Teaching Assignments
    await db.insert(schema.teachingAssignments).values([
      { id: 901, teacherId: 101, classId: 501, subjectCode: 'D', subjectName: 'Deutsch' },
      { id: 902, teacherId: 102, classId: 502, subjectCode: 'D', subjectName: 'Deutsch' },
    ]);

    // 4. Seed Pupils in Classes
    await db.insert(schema.pupils).values([
      { id: 7001, classId: 501, fullName: 'Integration Pupil 1', isArchived: false },
      { id: 7002, classId: 502, fullName: 'Integration Pupil 2', isArchived: false },
    ]);

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
    if (schemaReady) await cleanTestFixtures();
    if (app) await app.close();
    if (closePool) await closePool();
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
        id: teacherId === 101 ? TEST_USER_IDS.teacher101 : TEST_USER_IDS.teacher102,
        username: `teacher${teacherId}`,
        role: 'teacher',
        teacherId,
        mustChangePassword: false,
        sessionVersion: 0,
      },
      { expiresIn: '1h' },
    );
  }

  describe('WebSocket strict payload behavior (Task 5.1)', () => {
    it('rejects invalid rating values without writing and does not lock malformed focus ids', async () => {
      const { handleWebSocketConnection, resetLiveSyncForTests } = await import('../ws/live-sync.js');
      resetLiveSyncForTests();

      const first = new IntegrationSocket();
      const second = new IntegrationSocket();
      const user = {
        id: TEST_USER_IDS.teacher101,
        username: 'teacher101',
        role: 'teacher' as const,
        teacherId: 101,
        mustChangePassword: false,
        sessionVersion: 0,
      };
      handleWebSocketConnection(first, user, 'Authorized Teacher');
      handleWebSocketConnection(second, user, 'Authorized Teacher');

      try {
        await first.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId: 501 } });
        await second.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId: 501 } });

        await first.receive({
          type: 'CELL_FOCUS',
          payload: { classId: 501, pupilId: '7001junk', itemKey: 'arb_selbstaendig' },
        });
        expect(second.messages.some((message) => message.type === 'CELL_LOCKED')).toBe(false);

        await first.receive({
          type: 'CELL_FOCUS',
          payload: { classId: 501, pupilId: 7001, itemKey: 'arb_selbstaendig', subjectCode: 'D' },
        });
        expect(second.messages.some((message) => message.type === 'CELL_LOCKED')).toBe(true);

        await first.receive({
          type: 'UPDATE_RATING',
          payload: {
            classId: 501,
            pupilId: 7001,
            subjectCode: 'D',
            itemKey: 'arb_selbstaendig',
            rating: 'INVALID',
            expectedVersion: 1,
          },
        });
        expect(first.messages).toContainEqual({ type: 'ERROR', message: 'Unbekannter Bewertungswert.' });

        const writtenItems = await db
          .select()
          .from(schema.evaluationItems)
          .innerJoin(schema.evaluations, eq(schema.evaluationItems.evaluationId, schema.evaluations.id))
          .where(eq(schema.evaluations.pupilId, 7001));
        expect(writtenItems).toHaveLength(0);
      } finally {
        first.close();
        second.close();
        resetLiveSyncForTests();
      }
    });

    it('acknowledges a persisted WebSocket rating write to its originating client', async () => {
      const { handleWebSocketConnection, resetLiveSyncForTests } = await import('../ws/live-sync.js');
      resetLiveSyncForTests();

      const sender = new IntegrationSocket();
      const observer = new IntegrationSocket();
      const user = {
        id: TEST_USER_IDS.teacher101,
        username: 'teacher101',
        role: 'teacher' as const,
        teacherId: 101,
        mustChangePassword: false,
        sessionVersion: 0,
      };
      handleWebSocketConnection(sender, user, 'Authorized Teacher');
      handleWebSocketConnection(observer, user, 'Authorized Teacher');
      const clientMutationId = 'ws-ack-test-1';
      let createdEvaluationId: string | undefined;

      try {
        await sender.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId: 501 } });
        await observer.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId: 501 } });
        await sender.receive({
          type: 'CELL_FOCUS',
          payload: { classId: 501, pupilId: 7001, itemKey: 'arb_selbstaendig', subjectCode: 'D' },
        });
        await sender.receive({
          type: 'UPDATE_RATING',
          payload: {
            classId: 501,
            pupilId: 7001,
            subjectCode: 'D',
            itemKey: 'arb_selbstaendig',
            rating: '+',
            expectedVersion: 0,
            clientMutationId,
          },
        });

        expect(sender.messages).toContainEqual({ type: 'RATING_ACK', clientMutationId });
        expect(observer.messages.some((message) => message.type === 'RATING_UPDATED')).toBe(true);
        expect(observer.messages.some((message) => message.type === 'CELL_UNLOCKED')).toBe(true);

        const [createdEvaluation] = await db
          .select()
          .from(schema.evaluations)
          .where(and(
            eq(schema.evaluations.pupilId, 7001),
            eq(schema.evaluations.subjectCode, 'D'),
          ));
        createdEvaluationId = createdEvaluation?.id;
        const persisted = await db
          .select()
          .from(schema.evaluationItems)
          .where(and(
            eq(schema.evaluationItems.evaluationId, createdEvaluationId!),
            eq(schema.evaluationItems.itemKey, 'arb_selbstaendig'),
          ));
        expect(persisted).toHaveLength(1);
        expect(persisted[0].rating).toBe('+');

        await sender.receive({
          type: 'UPDATE_RATING',
          payload: {
            classId: 501,
            pupilId: 7001,
            subjectCode: 'D',
            itemKey: 'arb_selbstaendig',
            rating: 'sad',
            expectedVersion: 2,
            clientMutationId: 'ws-conflict-test-1',
          },
        });
        expect(sender.messages).toContainEqual(expect.objectContaining({
          type: 'CONFLICT',
          clientMutationId: 'ws-conflict-test-1',
          evaluationId: createdEvaluationId,
          subjectCode: 'D',
          currentRating: '+',
          currentVersion: 1,
        }));
      } finally {
        if (createdEvaluationId) {
          await db.delete(schema.evaluationItems).where(and(
            eq(schema.evaluationItems.evaluationId, createdEvaluationId),
            eq(schema.evaluationItems.itemKey, 'arb_selbstaendig'),
          ));
          await db.delete(schema.evaluations).where(eq(schema.evaluations.id, createdEvaluationId));
        }
        sender.close();
        observer.close();
        resetLiveSyncForTests();
      }
    });
  });

  describe('Rank Forgery Prevention (Behavioral)', () => {
    it('rejects a second HTTP first-write fallback that still expects the cell to be absent', async () => {
      try {
        const first = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/batch-items',
          headers: { cookie: `smile_session=${sessionCookie(102)}` },
          payload: {
            pupilId: 7002,
            classId: 502,
            subjectCode: 'D',
            items: [{ itemKey: 'arb_selbstaendig', rating: '+', version: 0 }],
          },
        });
        expect(first.statusCode).toBe(200);
        expect(first.json().items[0].version).toBe(1);

        const stale = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/batch-items',
          headers: { cookie: `smile_session=${sessionCookie(102)}` },
          payload: {
            pupilId: 7002,
            classId: 502,
            subjectCode: 'D',
            items: [{ itemKey: 'arb_selbstaendig', rating: 'sad', version: 0 }],
          },
        });

        expect(stale.statusCode).toBe(409);
        expect(stale.json()).toMatchObject({
          code: 'CONFLICT',
          currentRating: '+',
          currentVersion: 1,
        });
      } finally {
        const [evaluation] = await db
          .select()
          .from(schema.evaluations)
          .where(and(
            eq(schema.evaluations.pupilId, 7002),
            eq(schema.evaluations.classId, 502),
            eq(schema.evaluations.subjectCode, 'D'),
          ));
        if (evaluation) {
          await db.delete(schema.evaluationItems).where(eq(schema.evaluationItems.evaluationId, evaluation.id));
          await db.delete(schema.evaluations).where(eq(schema.evaluations.id, evaluation.id));
        }
      }
    });

    it('rejects a batch containing 200 fabricated item keys with HTTP 400 and writes 0 items', async () => {
      const forgedItems = Array.from({ length: 200 }, (_, i) => ({
        itemKey: `forged_item_${i + 1}`,
        rating: '++',
        version: 0,
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

      const writtenItems = await db
        .select()
        .from(schema.evaluationItems)
        .innerJoin(schema.evaluations, eq(schema.evaluationItems.evaluationId, schema.evaluations.id))
        .where(eq(schema.evaluations.pupilId, 7001));

      expect(writtenItems).toHaveLength(0);
    });

    it('rejects a mixed batch containing 1 valid item and 1 fabricated item', async () => {
      const mixedItems = [
        { itemKey: 'arb_selbstaendig', rating: '++', version: 0 },
        { itemKey: 'fabricated_key_x', rating: '++', version: 0 },
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

      const writtenItems = await db.select().from(schema.evaluationItems);
      expect(writtenItems).toHaveLength(0);
    });
  });

  describe('Legitimate Writes & Server-Side Criterion Derivation', () => {
    it('saves legitimate items, deriving criterionId server-side and ignoring client-sent criterionId', async () => {
      const spoofedCriterionId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
      const validPayload = [
        { itemKey: 'arb_selbstaendig', rating: '++', version: 0, criterionId: spoofedCriterionId },
        { itemKey: 'arb_sorgfaeltig', rating: '+', version: 0, criterionId: spoofedCriterionId },
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
        { itemKey: 'arb_selbstaendig', rating: '-', version: 1 },
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

    it('rejects a stale version on the single-item HTTP fallback and returns current state', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          items: [{ itemKey: 'arb_selbstaendig', rating: 'smile', version: 1 }],
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({
        code: 'CONFLICT',
        itemKey: 'arb_selbstaendig',
        subjectCode: 'D',
        currentRating: '-',
        currentVersion: 2,
      });
    });
  });

  describe('Authorization and Pupil Scoping', () => {
    it('refuses teacher without teaching assignment in the class (403)', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/batch-items',
        headers: { cookie: `smile_session=${sessionCookie(102)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'D',
          items: [{ itemKey: 'arb_sorgfaeltig', rating: '+', version: 0 }],
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
          pupilId: 99999,
          classId: 501,
          subjectCode: 'D',
          items: [{ itemKey: 'arb_sorgfaeltig', rating: '+', version: 0 }],
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
          forceOverwrite: true,
        },
      });

      expect(res.statusCode).toBe(200);
      const json = res.json();
      expect(json.success).toBe(true);
      expect(json.pupils).toBe(1);
      expect(json.items).toBe(2);

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

  describe('Behavior-Action IDOR Prevention (Task 2.2)', () => {
    it('refuses cross-pupil IDOR when KV of class A attempts deleting class B action via pupil A URL', async () => {
      // Create action on pupil 7002 (Class 502) authored by teacher 102
      const [actionB] = await db
        .insert(schema.pupilBehaviorActions)
        .values({
          pupilId: 7002,
          stageLevel: 1,
          stageTitle: 'Stufe 1 Verwarnung',
          teacherId: 102,
        })
        .returning();

      // Teacher 101 (KV in class 501 / pupil 7001) tries to delete actionB via pupil 7001 URL
      const res = await app!.inject({
        method: 'DELETE',
        url: `/api/pupils/7001/behavior-actions/${actionB.id}`,
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().error).toBe('Maßnahme nicht gefunden');

      // Verify actionB was NOT deleted
      const check = await db
        .select()
        .from(schema.pupilBehaviorActions)
        .where(eq(schema.pupilBehaviorActions.id, actionB.id));
      expect(check).toHaveLength(1);

      // Clean up action
      await db.delete(schema.pupilBehaviorActions).where(eq(schema.pupilBehaviorActions.id, actionB.id));
    });

    it('refuses unauthorized teacher attempting to delete action on pupil in different class (403)', async () => {
      const [actionB] = await db
        .insert(schema.pupilBehaviorActions)
        .values({
          pupilId: 7002,
          stageLevel: 1,
          stageTitle: 'Stufe 1 Verwarnung',
          teacherId: 102,
        })
        .returning();

      // Teacher 101 has no rights in class 502
      const res = await app!.inject({
        method: 'DELETE',
        url: `/api/pupils/7002/behavior-actions/${actionB.id}`,
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
      });

      expect(res.statusCode).toBe(403);

      // Verify actionB still exists
      const check = await db
        .select()
        .from(schema.pupilBehaviorActions)
        .where(eq(schema.pupilBehaviorActions.id, actionB.id));
      expect(check).toHaveLength(1);

      // Clean up action
      await db.delete(schema.pupilBehaviorActions).where(eq(schema.pupilBehaviorActions.id, actionB.id));
    });

    it('allows author/KV to delete action in own class and records audit log', async () => {
      const [actionB] = await db
        .insert(schema.pupilBehaviorActions)
        .values({
          pupilId: 7002,
          stageLevel: 1,
          stageTitle: 'Stufe 1 Verwarnung',
          teacherId: 102,
        })
        .returning();

      // Teacher 102 (author & KV of 502) deletes action
      const res = await app!.inject({
        method: 'DELETE',
        url: `/api/pupils/7002/behavior-actions/${actionB.id}`,
        headers: { cookie: `smile_session=${sessionCookie(102)}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify action was deleted
      const check = await db
        .select()
        .from(schema.pupilBehaviorActions)
        .where(eq(schema.pupilBehaviorActions.id, actionB.id));
      expect(check).toHaveLength(0);
    });
  });

  describe('Subject Code Authorization (Task 1.1)', () => {
    it('refuses D-only teacher writing M with 403', async () => {
      // Teacher 101 only teaches 'D' in class 501. Attempting to write 'M' must be rejected with 403.
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/status',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'M',
          proposedStatus: 'Geselle',
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('nicht bewerten');
    });

    it('allows D-only teacher writing assigned subject and normalizes alias SD', async () => {
      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/status',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'SD',
          proposedStatus: 'Geselle',
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().subjectCode).toBe('D');
    });

    it('refuses an administrator rating until a non-sentinel actor FK is configured', async () => {
      const adminCookie = app!.jwt.sign(
        { id: TEST_USER_IDS.admin, username: 'test-admin', role: 'admin', mustChangePassword: false, sessionVersion: 0 },
        { expiresIn: '1h' },
      );

      const res = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/status',
        headers: { cookie: `smile_session=${adminCookie}` },
        payload: {
          pupilId: 7001,
          classId: 501,
          subjectCode: 'M',
          proposedStatus: 'Meister',
        },
      });

      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe('SYSTEM_ACTOR_NOT_CONFIGURED');
      const rows = await db
        .select()
        .from(schema.evaluations)
        .where(and(
          eq(schema.evaluations.pupilId, 7001),
          eq(schema.evaluations.classId, 501),
          eq(schema.evaluations.subjectCode, 'M'),
        ));
      expect(rows).toHaveLength(0);
    });
  });

  describe('Live presence policy (Task 4.1)', () => {
    it('does not broadcast unused USER_JOINED/USER_LEFT events', async () => {
      const { handleWebSocketConnection, resetLiveSyncForTests } = await import('../ws/live-sync.js');

      class TestSocket {
        readyState = 1;
        messages: Array<Record<string, unknown>> = [];
        handlers = new Map<string, (...args: any[]) => unknown>();

        on(event: string, handler: (...args: any[]) => unknown) {
          this.handlers.set(event, handler);
        }

        send(raw: string) {
          this.messages.push(JSON.parse(raw));
        }

        close() {
          void this.handlers.get('close')?.();
        }

        async receive(message: unknown) {
          await this.handlers.get('message')?.(Buffer.from(JSON.stringify(message)));
        }
      }

      resetLiveSyncForTests();
      const first = new TestSocket();
      const second = new TestSocket();
      const user = {
        id: TEST_USER_IDS.teacher101,
        username: 'teacher101',
        role: 'teacher' as const,
        teacherId: 101,
        mustChangePassword: false,
        sessionVersion: 0,
      };
      handleWebSocketConnection(first, user, 'Authorized Teacher');
      handleWebSocketConnection(second, user, 'Authorized Teacher');
      try {
        await first.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId: 501 } });
        await second.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId: 501 } });
        second.close();

        expect(first.messages.map((message) => message.type)).not.toContain('USER_JOINED');
        expect(first.messages.map((message) => message.type)).not.toContain('USER_LEFT');
        expect(second.messages.map((message) => message.type)).not.toContain('USER_JOINED');
        expect(second.messages.map((message) => message.type)).not.toContain('USER_LEFT');
      } finally {
        first.close();
        second.close();
        resetLiveSyncForTests();
      }
    });
  });

  describe('Server submission deadline', () => {
    it('returns the same effective UTC cutoff used by write routes', async () => {
      const res = await app!.inject({
        method: 'GET',
        url: '/api/classes/501/pupils',
        headers: { cookie: `smile_session=${sessionCookie(101)}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().submissionDeadline).toBe('2099-01-01T00:00:00.000Z');
    });
  });

  describe('Persisted session revocation (Task 2.5)', () => {
    it('forces an existing session through reset and revokes it after password change', async () => {
      const oldTeacherCookie = `smile_session=${sessionCookie(101)}`;
      const adminToken = app!.jwt.sign({
        id: TEST_USER_IDS.admin,
        username: 'test-admin',
        role: 'admin',
        sessionVersion: 0,
        mustChangePassword: false,
      }, { expiresIn: '1h' });

      const reset = await app!.inject({
        method: 'POST',
        url: '/api/auth/request-reset',
        headers: { cookie: `smile_session=${adminToken}` },
        payload: { username: 'teacher101', note: 'synthetic integration reset' },
      });
      expect(reset.statusCode).toBe(201);

      const blockedWrite = await app!.inject({
        method: 'POST',
        url: '/api/evaluations/status',
        headers: { cookie: oldTeacherCookie },
        payload: { pupilId: 7001, classId: 501, subjectCode: 'D', proposedStatus: 'Meister' },
      });
      expect(blockedWrite.statusCode).toBe(403);
      expect(blockedWrite.json().code).toBe('PASSWORD_CHANGE_REQUIRED');

      const wrongPassword = await app!.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: { cookie: oldTeacherCookie },
        payload: { currentPassword: 'synthetic-wrong-password', newPassword: 'NewTestPassword456' },
      });
      expect(wrongPassword.statusCode).toBe(401);
      expect(wrongPassword.json().code).toBe('INVALID_CURRENT_PASSWORD');

      const passwordChange = await app!.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: { cookie: oldTeacherCookie },
        payload: { currentPassword: 'OldTestPassword123', newPassword: 'NewTestPassword456' },
      });
      expect(passwordChange.statusCode).toBe(200);

      const resetRows = await db
        .select()
        .from(schema.passwordResets)
        .where(eq(schema.passwordResets.userId, TEST_USER_IDS.teacher101));
      expect(resetRows).toHaveLength(1);
      expect(resetRows[0].completedAt).toBeInstanceOf(Date);

      const oldSession = await app!.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { cookie: oldTeacherCookie },
      });
      expect(oldSession.statusCode).toBe(401);

      const setCookie = passwordChange.headers['set-cookie'];
      const cookieLine = Array.isArray(setCookie) ? setCookie[0] : setCookie;
      const freshToken = cookieLine?.match(/smile_session=([^;]+)/)?.[1];
      expect(freshToken).toBeTruthy();
      const freshSession = await app!.inject({
        method: 'GET',
        url: '/api/auth/session',
        headers: { cookie: `smile_session=${freshToken}` },
      });
      expect(freshSession.statusCode).toBe(200);
      expect(freshSession.json().mustChangePassword).toBe(false);

      // Restore the fixture so later tests can keep signing sessionVersion 0.
      const { invalidateSessionStateCache } = await import('../lib/session.js');
      await db.update(schema.users)
        .set({ mustChangePassword: false, sessionVersion: 0 })
        .where(eq(schema.users.id, TEST_USER_IDS.teacher101));
      invalidateSessionStateCache(TEST_USER_IDS.teacher101);
    });

    it('closes an already-open WebSocket after an administrator reset', async () => {
      const { handleWebSocketConnection, resetLiveSyncForTests } = await import('../ws/live-sync.js');
      resetLiveSyncForTests();
      const socket = new IntegrationSocket();
      handleWebSocketConnection(socket, {
        id: TEST_USER_IDS.teacher102,
        username: 'teacher102',
        role: 'teacher',
        teacherId: 102,
        sessionVersion: 0,
        mustChangePassword: false,
      }, 'Unauthorized Teacher');

      try {
        await socket.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId: 502 } });
        const adminToken = app!.jwt.sign({
          id: TEST_USER_IDS.admin,
          username: 'test-admin',
          role: 'admin',
          sessionVersion: 0,
          mustChangePassword: false,
        }, { expiresIn: '1h' });
        const reset = await app!.inject({
          method: 'POST',
          url: '/api/auth/request-reset',
          headers: { cookie: `smile_session=${adminToken}` },
          payload: { username: 'teacher102' },
        });
        expect(reset.statusCode).toBe(201);

        await socket.receive({
          type: 'UPDATE_RATING',
          payload: {
            classId: 502,
            pupilId: 7002,
            subjectCode: 'D',
            itemKey: 'arb_selbstaendig',
            rating: '+',
            expectedVersion: 1,
            clientMutationId: 'reset-ws-test-1',
          },
        });
        // The reset pushes this ERROR from closeUserWebSockets, which is not tied
        // to a client mutation, so no clientMutationId is attached.
        expect(socket.messages).toContainEqual(expect.objectContaining({
          type: 'ERROR',
          code: 'PASSWORD_CHANGE_REQUIRED',
          message: 'Bitte setzen Sie zuerst ein neues Passwort.',
        }));
        expect(socket.closeCode).toBe(1008);

        const evaluationsAfterRejectedWrite = await db
          .select()
          .from(schema.evaluations)
          .where(eq(schema.evaluations.pupilId, 7002));
        expect(evaluationsAfterRejectedWrite).toHaveLength(0);
      } finally {
        socket.close();
        resetLiveSyncForTests();
        const { invalidateSessionStateCache } = await import('../lib/session.js');
        await db.update(schema.users)
          .set({ mustChangePassword: false, sessionVersion: 0 })
          .where(eq(schema.users.id, TEST_USER_IDS.teacher102));
        invalidateSessionStateCache(TEST_USER_IDS.teacher102);
      }
    });

    it('does not let an administrator with a pending reset issue another reset', async () => {
      await db.update(schema.users)
        .set({
          mustChangePassword: true,
          sessionVersion: sql`${schema.users.sessionVersion} + 1`,
        })
        .where(eq(schema.users.id, TEST_USER_IDS.admin));
      // A raw SQL update bypasses the in-process session-state cache, so drop the
      // cached admin state before the request reads it.
      const { invalidateSessionStateCache } = await import('../lib/session.js');
      invalidateSessionStateCache(TEST_USER_IDS.admin);
      const staleAdminToken = app!.jwt.sign({
        id: TEST_USER_IDS.admin,
        username: 'test-admin',
        role: 'admin',
        sessionVersion: 0,
        mustChangePassword: false,
      }, { expiresIn: '1h' });

      try {
        const res = await app!.inject({
          method: 'POST',
          url: '/api/auth/request-reset',
          headers: { cookie: `smile_session=${staleAdminToken}` },
          payload: { username: 'teacher101' },
        });

        expect(res.statusCode).toBe(403);
        expect(res.json().code).toBe('PASSWORD_CHANGE_REQUIRED');
      } finally {
        await db.update(schema.users)
          .set({ mustChangePassword: false, sessionVersion: 0 })
          .where(eq(schema.users.id, TEST_USER_IDS.admin));
        invalidateSessionStateCache(TEST_USER_IDS.admin);
      }
    });
  });

  describe('Subject-Scoped Statistics Overview', () => {
    it('returns subject-scoped results and keeps conference decision separate', async () => {
      // Seed assignment for second subject M on class 501
      const SECOND_ASSIGNMENT_ID = 903;
      await db.insert(schema.teachingAssignments).values({
        id: SECOND_ASSIGNMENT_ID,
        teacherId: 101,
        classId: 501,
        subjectCode: 'M',
        subjectName: 'Mathematik',
      }).onConflictDoUpdate({
        target: schema.teachingAssignments.id,
        set: { teacherId: 101, classId: 501, subjectCode: 'M', subjectName: 'Mathematik' },
      });

      // Earlier legitimate-write tests may already have created this exact
      // evaluation (round, pupil, class, subject). Reset it so the seeded item is
      // the only one scored (the test asserts positiveCount === 1).
      const existingEvalD = await db
        .select({ id: schema.evaluations.id })
        .from(schema.evaluations)
        .where(and(
          eq(schema.evaluations.roundId, testRoundId!),
          eq(schema.evaluations.pupilId, 7001),
          eq(schema.evaluations.classId, 501),
          eq(schema.evaluations.subjectCode, 'D'),
        ))
        .limit(1);
      if (existingEvalD[0]) {
        await db.delete(schema.evaluationItems)
          .where(eq(schema.evaluationItems.evaluationId, existingEvalD[0].id));
        await db.delete(schema.evaluations)
          .where(eq(schema.evaluations.id, existingEvalD[0].id));
      }

      // Seed an evaluation for pupil 7001 in D
      const [evalD] = await db.insert(schema.evaluations).values({
        roundId: testRoundId!,
        pupilId: 7001,
        classId: 501,
        subjectCode: 'D',
        teacherId: 101,
        proposedStatus: 'Geselle',
      }).returning();

      // Seed an evaluation item in D
      await db.insert(schema.evaluationItems).values({
        evaluationId: evalD.id,
        criterionId: testCriterionId,
        itemKey: 'item_1',
        rating: 'smile',
        version: 1,
        updatedByTeacherId: 101,
      });

      // Seed a confirmed conference decision (Meister) for pupil 7001
      await db.delete(schema.finalRanks).where(and(
        eq(schema.finalRanks.pupilId, 7001),
        eq(schema.finalRanks.roundId, testRoundId!),
      ));
      await db.insert(schema.finalRanks).values({
        roundId: testRoundId!,
        pupilId: 7001,
        classId: 501,
        rank: 'Meister',
        overrideReason: 'Konferenzbeschluss',
        confirmedBy: 101,
      });

      try {
        const res = await app!.inject({
          method: 'GET',
          url: '/api/statistics/overview?classId=501',
          headers: { cookie: `smile_session=${sessionCookie(101)}` },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        const p7001 = body.pupils.find((p: any) => p.id === 7001);
        expect(p7001).toBeDefined();

        // Subject-scoped results: D and M must be separate
        const dResult = p7001.subjectResults.find((s: any) => s.subjectCode === 'D');
        const mResult = p7001.subjectResults.find((s: any) => s.subjectCode === 'M');
        expect(dResult).toBeDefined();
        expect(mResult).toBeDefined();

        // D is scored from its item
        expect(dResult.positiveCount).toBe(1);
        expect(dResult.totalRated).toBe(1);
        expect(dResult.calculatedRank).toBe('Lehrling');

        // M has no evaluation, so it is pending (calculatedRank null, totalRated 0)
        expect(mResult.positiveCount).toBe(0);
        expect(mResult.totalRated).toBe(0);
        expect(mResult.calculatedRank).toBeNull();
        expect(mResult.teacherVote).toBeNull();

        // Conference decision is separate
        expect(p7001.conferenceDecision).toEqual({
          rank: 'Meister',
          isConfirmed: true,
          overrideReason: 'Konferenzbeschluss',
        });

        // Distribution counts only rated subject results (1 for D, 0 for M)
        expect(body.distribution.total).toBe(1);
        expect(body.distribution.lehrling).toBe(1);
      } finally {
        await db.delete(schema.finalRanks).where(and(
          eq(schema.finalRanks.pupilId, 7001),
          eq(schema.finalRanks.roundId, testRoundId!),
        ));
        await db.delete(schema.evaluationItems).where(eq(schema.evaluationItems.evaluationId, evalD.id));
        await db.delete(schema.evaluations).where(eq(schema.evaluations.id, evalD.id));
        await db.delete(schema.teachingAssignments).where(eq(schema.teachingAssignments.id, SECOND_ASSIGNMENT_ID));
      }
    });
  });

  describe('Class Conference Lock Enforcement (Task 8)', () => {
    it('rejects all evaluation mutations with 423 CLASS_CONFERENCE_LOCKED when class is locked', async () => {
      // Lock class 501
      await db.insert(schema.classRoundLocks).values({
        roundId: testRoundId!,
        classId: 501,
        isLocked: true,
      }).onConflictDoUpdate({
        target: [schema.classRoundLocks.roundId, schema.classRoundLocks.classId],
        set: { isLocked: true },
      });

      try {
        // 1. /batch-default
        const resBatchDefault = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/batch-default',
          headers: { cookie: `smile_session=${sessionCookie(101)}` },
          payload: { classId: 501, subjectCode: 'D', defaultRating: 'smile', forceOverwrite: true },
        });
        expect(resBatchDefault.statusCode).toBe(423);
        expect(resBatchDefault.json().code).toBe('CLASS_CONFERENCE_LOCKED');

        // 2. /status
        const resStatus = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/status',
          headers: { cookie: `smile_session=${sessionCookie(101)}` },
          payload: { pupilId: 7001, classId: 501, subjectCode: 'D', comment: 'Versuch Kommentar' },
        });
        expect(resStatus.statusCode).toBe(423);
        expect(resStatus.json().code).toBe('CLASS_CONFERENCE_LOCKED');

        // 3. /submit
        const resSubmit = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/submit',
          headers: { cookie: `smile_session=${sessionCookie(101)}` },
          payload: { pupilId: 7001, classId: 501, subjectCode: 'D' },
        });
        expect(resSubmit.statusCode).toBe(423);
        expect(resSubmit.json().code).toBe('CLASS_CONFERENCE_LOCKED');

        // 4. /reopen
        const resReopen = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/reopen',
          headers: { cookie: `smile_session=${sessionCookie(101)}` },
          payload: { pupilId: 7001, classId: 501, subjectCode: 'D' },
        });
        expect(resReopen.statusCode).toBe(423);
        expect(resReopen.json().code).toBe('CLASS_CONFERENCE_LOCKED');

        // 5. /batch-items — a real rubric key, so the payload passes validation
        // and the class lock is what rejects the request (423), not a 400.
        const resBatchItems = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/batch-items',
          headers: { cookie: `smile_session=${sessionCookie(101)}` },
          payload: {
            pupilId: 7001,
            classId: 501,
            subjectCode: 'D',
            items: [{ itemKey: 'arb_selbstaendig', rating: 'smile', version: 0 }],
          },
        });
        expect(resBatchItems.statusCode).toBe(423);
        expect(resBatchItems.json().code).toBe('CLASS_CONFERENCE_LOCKED');

        // 6. Unlocked second class (502) is not blocked
        const resClass502Status = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/status',
          headers: { cookie: `smile_session=${sessionCookie(102)}` },
          payload: { pupilId: 7002, classId: 502, subjectCode: 'D', comment: 'Offene Klasse' },
        });
        expect(resClass502Status.statusCode).not.toBe(423);

        // 7. Conference decision endpoints remain accessible while class is locked.
        // The only registered conference routes are /:classId/lock|vote|vote-all|summary,
        // so confirm/unconfirm run through the vote endpoint's action switch. These
        // calls previously targeted /api/conferences/confirm and /api/conferences/unconfirm,
        // which have never been registered: both 404'd, so the "conferences stay
        // usable under lock" property had no working guard at all.
        // Conference decisions are restricted to the Schulleitung, so the
        // "still usable under lock" steps use an admin token.
        const leadershipToken = app!.jwt.sign({
          id: TEST_USER_IDS.admin,
          username: 'test-admin',
          role: 'admin',
          sessionVersion: 0,
          mustChangePassword: false,
        }, { expiresIn: '1h' });
        const resConfirm = await app!.inject({
          method: 'POST',
          url: '/api/conferences/501/vote',
          headers: { cookie: `smile_session=${leadershipToken}` },
          payload: {
            pupilId: 7001,
            action: 'confirm',
            rank: 'Meister',
            overrideReason: 'Beschluss trotz Sperre',
          },
        });
        expect(resConfirm.statusCode).toBe(200);
        expect(resConfirm.json().rank).toBe('Meister');

        const resUnconfirm = await app!.inject({
          method: 'POST',
          url: '/api/conferences/501/vote',
          headers: { cookie: `smile_session=${leadershipToken}` },
          payload: { pupilId: 7001, action: 'unconfirm' },
        });
        expect(resUnconfirm.statusCode).toBe(200);
        expect(resUnconfirm.json().isConfirmed).toBe(false);

        // 8. vote-all stays available under the same lock
        const resVoteAll = await app!.inject({
          method: 'POST',
          url: '/api/conferences/501/vote-all',
          headers: { cookie: `smile_session=${leadershipToken}` },
          payload: { items: [{ pupilId: 7001, rank: 'Meister' }] },
        });
        expect(resVoteAll.statusCode).toBe(200);
        expect(resVoteAll.json().count).toBe(1);
      } finally {
        await db.delete(schema.classRoundLocks).where(and(
          eq(schema.classRoundLocks.roundId, testRoundId!),
          eq(schema.classRoundLocks.classId, 501),
        ));
        await db.delete(schema.finalRanks).where(and(
          eq(schema.finalRanks.pupilId, 7001),
          eq(schema.finalRanks.roundId, testRoundId!),
        ));
      }
    });

    it('refuses writes when latest round is globally locked and does not fall back to older unlocked round', async () => {
      // Create a newer observation round that is locked
      const [newerLockedRound] = await db.insert(schema.observationRounds).values({
        name: 'Newer Locked Period',
        isLocked: true,
        createdAt: new Date(Date.now() + 10000),
      }).returning();

      try {
        const res = await app!.inject({
          method: 'POST',
          url: '/api/evaluations/status',
          headers: { cookie: `smile_session=${sessionCookie(101)}` },
          payload: { pupilId: 7001, classId: 501, subjectCode: 'D', comment: 'Globale Sperre' },
        });
        expect(res.statusCode).toBe(400);
        expect(res.json().error).toBe('Kein aktiver Zeitraum');
      } finally {
        await db.delete(schema.observationRounds).where(eq(schema.observationRounds.id, newerLockedRound.id));
      }
    });
  });

  describe('Fixture Isolation', () => {
    it('cleans only its own fixture rows', async () => {
      const EXTERNAL_TEACHER_ID = 9998;
      const [externalRubric] = await db.insert(schema.assessmentRubrics).values({
        title: 'SMILE Test Rubric',
        mode: 'rubric_levels',
        isDefault: false,
      }).returning();
      const [externalRound] = await db.insert(schema.observationRounds).values({
        name: 'Integration Test Period',
        isLocked: false,
      }).returning();
      await db.insert(schema.teachers).values({
        id: EXTERNAL_TEACHER_ID,
        shortName: 'EXT',
        fullName: 'External Unrelated Teacher',
        active: true,
      });

      try {
        await cleanTestFixtures();

        const externalFound = await db
          .select()
          .from(schema.teachers)
          .where(eq(schema.teachers.id, EXTERNAL_TEACHER_ID));

        expect(externalFound).toHaveLength(1);
        expect(externalFound[0].shortName).toBe('EXT');

        const externalRubricFound = await db
          .select()
          .from(schema.assessmentRubrics)
          .where(eq(schema.assessmentRubrics.id, externalRubric.id));
        expect(externalRubricFound).toHaveLength(1);

        const externalRoundFound = await db
          .select()
          .from(schema.observationRounds)
          .where(eq(schema.observationRounds.id, externalRound.id));
        expect(externalRoundFound).toHaveLength(1);

        const fixtureFound = await db
          .select()
          .from(schema.teachers)
          .where(inArray(schema.teachers.id, FIXTURE_TEACHER_IDS));
        expect(fixtureFound).toHaveLength(0);
      } finally {
        await db.delete(schema.teachers).where(eq(schema.teachers.id, EXTERNAL_TEACHER_ID));
        await db.delete(schema.assessmentRubrics).where(eq(schema.assessmentRubrics.id, externalRubric.id));
        await db.delete(schema.observationRounds).where(eq(schema.observationRounds.id, externalRound.id));
      }
    });
  });
});
