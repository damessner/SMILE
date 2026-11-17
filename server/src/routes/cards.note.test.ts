import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';

const CARD_ID = '11111111-1111-4111-8111-111111111111';

const state = vi.hoisted(() => ({
  access: {} as Record<string, unknown>,
  pupil: { id: 22, classId: 2, fullName: 'Bert Beispiel', isArchived: false } as Record<string, unknown> | null,
  existingCard: null as Record<string, unknown> | null,
  updatedRow: null as Record<string, unknown> | null,
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
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (state.existingCard ? [state.existingCard] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            if (!state.existingCard || state.existingCard.revokedAt) return [];
            const row = { ...state.existingCard, ...values };
            state.updatedRow = row;
            return [row];
          },
        }),
      }),
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        state.insertedAudits.push({ table: tableName(table), values });
        return Promise.resolve(undefined);
      },
    }),
  };
  return {
    ...actual,
    db: {
      ...writeApi,
      transaction: async (fn: (tx: typeof writeApi) => Promise<unknown>) => fn(writeApi),
    },
  };
});

const broadcastMock = vi.hoisted(() => vi.fn());
vi.mock('../ws/live-sync.js', () => ({
  broadcastToClass: broadcastMock,
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
  SMILE_ENV_FILE: 'no-such-env-file-for-card-note-tests',
  CORS_ALLOWED_ORIGINS: '',
};

let app: FastifyInstance;
let savedEnvironment: NodeJS.ProcessEnv;

function cookieFor(overrides: Record<string, unknown> = {}) {
  return `smile_session=${app.jwt.sign({
    id: 'teacher-1',
    username: 't1',
    role: 'teacher',
    teacherId: 101,
    mustChangePassword: false,
    sessionVersion: 0,
    ...overrides,
  })}`;
}

function updateNote(
  note: string | null,
  cookie = cookieFor(),
  cardId = CARD_ID,
) {
  return app.inject({
    method: 'PUT',
    url: `/api/cards/${cardId}/note`,
    headers: { cookie },
    payload: { note },
  });
}

beforeAll(async () => {
  savedEnvironment = { ...process.env };
  Object.assign(process.env, TEST_ENV);
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
  broadcastMock.mockReset();
  state.insertedAudits = [];
  state.updatedRow = null;
  state.pupil = { id: 22, classId: 2, fullName: 'Bert Beispiel', isArchived: false };
  state.existingCard = {
    id: CARD_ID,
    pupilId: 22,
    classId: 2,
    teacherId: 101,
    cardType: 'yellow',
    note: null,
    createdAt: new Date('2026-11-17T08:00:00Z'),
    revokedAt: null,
  };
  state.access = {
    classId: 2,
    exists: true,
    canRecord: true,
    canRead: true,
    canRate: false,
    canManagePupils: false,
    canRunConference: false,
    isAdmin: false,
    isHeadmaster: false,
    isKv: false,
    teaches: true,
    isCoreTeacher: false,
    subjects: [],
  };
});

describe('PUT /api/cards/:id/note', () => {
  it('allows the issuing teacher to add a note afterwards and emits audit + live-sync', async () => {
    const res = await updateNote('  Hausübung wiederholt vergessen  ');

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.card.note).toBe('Hausübung wiederholt vergessen');

    expect(state.insertedAudits).toHaveLength(1);
    expect(state.insertedAudits[0]!.values).toMatchObject({
      action: 'CARD_NOTE_UPDATED',
      entity: 'pupil',
      entityId: '22',
      payload: {
        cardId: CARD_ID,
        classId: 2,
        cardType: 'yellow',
        previousNote: null,
        note: 'Hausübung wiederholt vergessen',
        wasIssuer: true,
      },
    });
    expect(broadcastMock).toHaveBeenCalledWith(
      2,
      expect.objectContaining({
        type: 'CARD_NOTE_UPDATED',
        card: expect.objectContaining({ id: CARD_ID, note: 'Hausübung wiederholt vergessen' }),
      }),
    );
  });

  it('allows KV and leadership to amend an existing note and allows clearing yellow/green notes', async () => {
    state.existingCard!.note = 'Alte Notiz';
    state.existingCard!.teacherId = 999; // Issued by someone else
    state.access = { ...state.access, isKv: true };

    const editRes = await updateNote('Präzisierte Notiz');
    expect(editRes.statusCode).toBe(200);
    expect(editRes.json().card.note).toBe('Präzisierte Notiz');

    // Clearing a non-red card note stores null cleanly.
    const clearRes = await updateNote('   ');
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.json().card.note).toBeNull();
  });

  it('forbids another non-KV colleague from altering someone else’s card note', async () => {
    state.existingCard!.teacherId = 999;

    const res = await updateNote('Fremde Notiz überschrieben');
    expect(res.statusCode).toBe(403);
    expect(state.updatedRow).toBeNull();
    expect(state.insertedAudits).toHaveLength(0);
    expect(broadcastMock).not.toHaveBeenCalled();
  });

  it('requires a non-empty reason on red cards even when updating later', async () => {
    state.existingCard = {
      ...state.existingCard!,
      cardType: 'red',
      note: 'Ursprünglicher Vorfall',
    };

    const emptyRes = await updateNote('   ');
    expect(emptyRes.statusCode).toBe(400);
    expect(state.updatedRow).toBeNull();

    const validRes = await updateNote('Aktualisierte Vorfallsbeschreibung');
    expect(validRes.statusCode).toBe(200);
    expect(validRes.json().card.note).toBe('Aktualisierte Vorfallsbeschreibung');
  });

  it('rejects revoked cards, invalid IDs, missing cards, and mismatched pupil-in-class rows', async () => {
    const badId = await updateNote('Test', cookieFor(), 'not-a-uuid');
    expect(badId.statusCode).toBe(400);

    state.existingCard = { ...state.existingCard!, revokedAt: new Date() };
    const revokedRes = await updateNote('Nachtrag');
    expect(revokedRes.statusCode).toBe(400);

    state.existingCard = { ...state.existingCard!, revokedAt: null };
    state.pupil = null;
    const wrongClassRes = await updateNote('Nachtrag');
    expect(wrongClassRes.statusCode).toBe(400);

    state.existingCard = null;
    const missingRes = await updateNote('Nachtrag');
    expect(missingRes.statusCode).toBe(404);
  });
});
