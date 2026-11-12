import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

/**
 * Cross-class behaviour cards ("Alle Klassen").
 *
 * The write is attributed to the acting teacher and audited; the class/pupil
 * scoping checks stay in force. These tests pin the policy gate, not the card
 * itself: with BEHAVIOUR_SCHOOL_WIDE off a teacher must not be able to write into
 * a class they are not responsible for.
 */
const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  pupil: { id: 22, classId: 2, fullName: 'Bert Beispiel', isArchived: false } as Record<string, unknown> | null,
  insertedCards: [] as Array<Record<string, unknown>>,
  insertedAudits: [] as Array<{ table: string | null; values: Record<string, any> }>,
}));

vi.mock('../lib/guards.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/guards.js')>();
  return {
    ...actual,
    getClassAccess: vi.fn(async () => state.access),
    findPupilInClass: vi.fn(async () => state.pupil),
  };
});

vi.mock('../db/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../db/index.js')>();
  const { getTableName } = await import('drizzle-orm');
  const tableName = (table: unknown): string | null => {
    try {
      return getTableName(table as never);
    } catch {
      return null;
    }
  };
  const writeApi = {
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        if (tableName(table) === 'behavior_cards') {
          state.insertedCards.push(values);
          return {
            returning: async () => [
              { id: 'card-1', revokedAt: null, createdAt: new Date(), ...values },
            ],
          };
        }
        state.insertedAudits.push({ table: tableName(table), values });
        return Promise.resolve(undefined);
      },
    }),
  };
  return {
    ...actual,
    db: {
      ...writeApi,
      transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(writeApi),
    },
  };
});

vi.mock('../ws/live-sync.js', () => ({
  broadcastToClass: vi.fn(),
  closeUserWebSockets: vi.fn(),
  resetLiveSyncForTests: vi.fn(),
}));
vi.mock('../lib/teams.js', () => ({ queueRedCardRankChange: vi.fn() }));
vi.mock('../lib/notification-events.js', () => ({ queueClassEventNotification: vi.fn() }));
vi.mock('../lib/webuntis/sync.js', () => ({
  queueWebUntisClassregEvent: vi.fn(),
  queueWebUntisClassregCorrection: vi.fn(),
}));

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-cross-class-tests',
  CORS_ALLOWED_ORIGINS: '',
  BEHAVIOUR_SCHOOL_WIDE: 'true',
};

let app: FastifyInstance;
let savedEnvironment: NodeJS.ProcessEnv;
let configModule: typeof import('../config.js');

function issueCard(overrides: Record<string, unknown> = {}) {
  return app.inject({
    method: 'POST',
    url: '/api/cards',
    headers: { cookie: `smile_session=${app.jwt.sign({
      id: 'behaviour-teacher',
      username: 'teacher',
      role: 'teacher',
      teacherId: 101,
      mustChangePassword: false,
      sessionVersion: 0,
    })}` },
    payload: { pupilId: 22, classId: 2, cardType: 'green', ...overrides },
  });
}

beforeAll(async () => {
  savedEnvironment = { ...process.env };
  Object.assign(process.env, TEST_ENV);
  configModule = await import('../config.js');
  const { buildServer } = await import('../index.js');
  app = await buildServer(async () => ({
    sessionVersion: 0,
    mustChangePassword: false,
    teacherActive: true,
    role: 'teacher',
  }));
  await app.ready();
}, 30_000);

afterAll(async () => {
  await app?.close();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, savedEnvironment);
});

beforeEach(() => {
  (configModule.config as { behaviourSchoolWide: boolean }).behaviourSchoolWide = true;
  state.insertedCards = [];
  state.insertedAudits = [];
  state.pupil = { id: 22, classId: 2, fullName: 'Bert Beispiel', isArchived: false };
  state.access = {
    classId: 2,
    exists: true,
    canRecord: false,
    canRead: false,
    canRate: false,
    canManagePupils: false,
    canRunConference: false,
    isAdmin: false,
    isHeadmaster: false,
    isKv: false,
    teaches: false,
    isCoreTeacher: false,
    subjects: [],
  };
});

describe('POST /api/cards across classes', () => {
  it('allows a staff member to give a card in another class and audits it', async () => {
    const res = await issueCard();
    expect(res.statusCode).toBe(201);
    expect(state.insertedCards).toHaveLength(1);
    expect(state.insertedCards[0]).toMatchObject({ pupilId: 22, classId: 2, cardType: 'green' });

    const crossClassAudit = state.insertedAudits.find(
      (row) => row.values?.action === 'CROSS_CLASS_BEHAVIOUR_CARD',
    );
    expect(crossClassAudit).toBeTruthy();
    expect(crossClassAudit!.values).toMatchObject({
      entity: 'pupil',
      entityId: '22',
      payload: { classId: 2, cardType: 'green' },
    });
  });

  it('refuses the cross-class card when the school policy is disabled', async () => {
    (configModule.config as { behaviourSchoolWide: boolean }).behaviourSchoolWide = false;

    const res = await issueCard();
    expect(res.statusCode).toBe(403);
    expect(state.insertedCards).toHaveLength(0);
    expect(state.insertedAudits).toHaveLength(0);
  });

  it('keeps the pupil-in-class check even with the policy on', async () => {
    state.pupil = null;

    const res = await issueCard();
    expect(res.statusCode).toBe(400);
    expect(state.insertedCards).toHaveLength(0);
  });

  it('does not write a cross-class audit row for the teacher\'s own class', async () => {
    state.access = { ...state.access, canRecord: true };

    const res = await issueCard();
    expect(res.statusCode).toBe(201);
    expect(state.insertedCards).toHaveLength(1);
    expect(
      state.insertedAudits.some((row) => row.values?.action === 'CROSS_CLASS_BEHAVIOUR_CARD'),
    ).toBe(false);
  });
});
