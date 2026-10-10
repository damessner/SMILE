import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../lib/guards.js';
import { getPersistedUserSessionState } from '../lib/session.js';
import { handleWebSocketConnection, resetLiveSyncForTests } from './live-sync.js';
import * as liveSyncModule from './live-sync.js';

vi.mock('drizzle-orm', () => ({
  and: vi.fn(),
  desc: vi.fn(),
  eq: vi.fn(),
}));

vi.mock('../db/schema.js', () => ({
  classRoundLocks: { roundId: {}, classId: {}, isLocked: {} },
  evaluationItems: {},
  evaluations: {},
  observationRounds: { createdAt: {} },
  teachingAssignments: {},
}));

vi.mock('../lib/class-round-lock.js', () => ({
  getClassRoundLockState: vi.fn(async () => false),
  isClassRoundLocked: vi.fn((g: boolean, c: boolean) => Boolean(g || c)),
}));

vi.mock('../db/index.js', () => {
  const activeRound = { id: 'round-test', isLocked: false };
  const query = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: async () => [activeRound],
  };
  return {
    db: { select: () => query },
    getPool: () => ({ query: vi.fn() }),
  };
});

vi.mock('../config.js', () => ({
  config: {
    wsRoomMaxClients: 20,
    wsSoftLockTtlMs: 1_000,
    submissionDeadline: new Date('2099-01-01T00:00:00.000Z'),
  },
}));

vi.mock('../lib/guards.js', () => ({
  getClassAccess: vi.fn(async () => ({
    classId: 101,
    exists: true,
    isAdmin: false,
    isHeadmaster: false,
    isKv: false,
    teaches: true,
    isCoreTeacher: true,
    subjects: [{ code: 'D', name: 'Deutsch', isCoreSmile: true }, { code: 'M', name: 'Mathematik', isCoreSmile: true }],
    canRead: true,
    canRecord: true,
    canRate: true,
    canManagePupils: false,
    canRunConference: false,
  })),
  findPupilInClass: vi.fn(),
  canRateSubject: vi.fn((access: any, code: string) => access.subjects.some((subject: any) => subject.code === code)),
  MAX_POSTGRES_INTEGER: 2_147_483_647,
  parsePositiveInt: (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null,
  hasPersistedTeacherActor: (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value > 0,
  safeTeacherId: (value: unknown) => (typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null),
}));

vi.mock('../lib/session.js', () => ({
  getPersistedUserSessionState: vi.fn(async () => ({
    sessionVersion: 0,
    mustChangePassword: false,
  })),
}));

vi.mock('../lib/rubric.js', () => ({
  isValidRating: vi.fn(),
  invalidateRubricCache: vi.fn(),
  loadRubricIndex: vi.fn(),
  resolveCriterionId: vi.fn(),
}));

class TestSocket {
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

const USER: AuthUser = {
  id: 'teacher-1',
  username: 'teacher',
  role: 'teacher',
  teacherId: 1,
  mustChangePassword: false,
};

async function subscribe(socket: TestSocket, classId = 101, user: AuthUser = USER): Promise<void> {
  handleWebSocketConnection(socket, user, 'Lehrkraft');
  await socket.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId } });
}

afterEach(() => {
  resetLiveSyncForTests();
  vi.mocked(getPersistedUserSessionState).mockReset().mockResolvedValue({
    sessionVersion: 0,
    mustChangePassword: false,
  });
  vi.useRealTimers();
});

describe('subject-scoped WebSocket cell locks', () => {
  it('expires each subject lock and broadcasts an unlock for the same subject only', async () => {
    vi.useFakeTimers();
    const deutschOwner = new TestSocket();
    const mathOwner = new TestSocket();
    const observer = new TestSocket();
    await subscribe(deutschOwner);
    await subscribe(mathOwner);
    await subscribe(observer);

    await deutschOwner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'D' },
    });
    await mathOwner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'M' },
    });
    expect(observer.messages.filter((message) => message.type === 'CELL_LOCKED')).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1_000);

    const unlocks = observer.messages.filter((message) => message.type === 'CELL_UNLOCKED');
    expect(unlocks).toHaveLength(2);
    expect(unlocks.map((message) => message.subjectCode).sort()).toEqual(['D', 'M']);
  });

  it('releases only that client’s locks when its connection closes', async () => {
    const owner = new TestSocket();
    const observer = new TestSocket();
    await subscribe(owner);
    await subscribe(observer);

    await owner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'D' },
    });
    owner.close();

    await vi.waitFor(() => expect(observer.messages).toContainEqual({
        type: 'CELL_UNLOCKED',
        classId: 101,
        pupilId: 501,
        itemKey: 'org_1',
        subjectCode: 'D',
      }));
  });

  it('releases an owner’s locks when it unsubscribes from that class', async () => {
    const owner = new TestSocket();
    const observer = new TestSocket();
    await subscribe(owner);
    await subscribe(observer);

    await owner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'M' },
    });
    await owner.receive({ type: 'UNSUBSCRIBE_CLASS', payload: { classId: 101 } });

    expect(observer.messages).toContainEqual({
      type: 'CELL_UNLOCKED',
      classId: 101,
      pupilId: 501,
      itemKey: 'org_1',
      subjectCode: 'M',
    });
  });

  it('does not let a class reader without a subject assignment publish a cell lock', async () => {
    const owner = new TestSocket();
    const observer = new TestSocket();
    await subscribe(owner);
    await subscribe(observer);

    await owner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'E' },
    });

    expect(observer.messages.some((message) => message.type === 'CELL_LOCKED')).toBe(false);
  });

  it('refuses a rating from an administrator without a persisted teacher actor', async () => {
    const socket = new TestSocket();
    const admin: AuthUser = {
      id: 'admin-without-teacher',
      username: 'admin',
      role: 'admin',
      mustChangePassword: false,
      sessionVersion: 0,
    };
    await subscribe(socket, 101, admin);

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 101,
        pupilId: 501,
        itemKey: 'org_1',
        subjectCode: 'D',
        rating: '+',
        expectedVersion: 0,
        clientMutationId: 'admin-rating-test',
      },
    });

    expect(socket.messages).toContainEqual({
      type: 'ERROR',
      message: 'Bewertungen sind nicht verfügbar, weil kein Lehrkraftkonto zur Erfassung zugeordnet ist.',
      code: 'SYSTEM_ACTOR_NOT_CONFIGURED',
      clientMutationId: 'admin-rating-test',
    });
  });

  it('keeps identical cells in separate class rooms independent', async () => {
    vi.useFakeTimers();
    const class101Owner = new TestSocket();
    const class101Observer = new TestSocket();
    const class102Owner = new TestSocket();
    const class102Observer = new TestSocket();
    await subscribe(class101Owner, 101);
    await subscribe(class101Observer, 101);
    await subscribe(class102Owner, 102);
    await subscribe(class102Observer, 102);

    await class101Owner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'D' },
    });
    await class102Owner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 102, pupilId: 501, itemKey: 'org_1', subjectCode: 'D' },
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(class101Observer.messages).toContainEqual(expect.objectContaining({
      type: 'CELL_UNLOCKED',
      classId: 101,
      subjectCode: 'D',
      pupilId: 501,
      itemKey: 'org_1',
    }));
    expect(class102Observer.messages).toContainEqual(expect.objectContaining({
      type: 'CELL_UNLOCKED',
      classId: 102,
      subjectCode: 'D',
      pupilId: 501,
      itemKey: 'org_1',
    }));
  });

  it('sends active subject locks to a client that subscribes after reconnecting', async () => {
    const owner = new TestSocket();
    const beforeDisconnect = new TestSocket();
    await subscribe(owner);
    await subscribe(beforeDisconnect);
    await owner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'M' },
    });

    const reconnect = new TestSocket();
    await subscribe(reconnect);

    expect(reconnect.messages).toContainEqual(expect.objectContaining({
      type: 'CELL_LOCKED',
      classId: 101,
      subjectCode: 'M',
      pupilId: 501,
      itemKey: 'org_1',
    }));
  });

  it('rejects class subscription after the token session was revoked on another worker', async () => {
    vi.mocked(getPersistedUserSessionState).mockResolvedValueOnce({
      sessionVersion: 1,
      mustChangePassword: false,
    });
    const staleSocket = new TestSocket();
    await subscribe(staleSocket, 101, { ...USER, id: 'revoked-teacher', sessionVersion: 0 });

    expect(staleSocket.closeCode).toBe(1008);
    expect(staleSocket.messages.some((message) => message.type === 'SYNCED')).toBe(false);
  });

  it('does not broadcast class data to a socket revoked on another worker', async () => {
    const staleUser = { ...USER, id: 'revoked-teacher', sessionVersion: 0 };
    const staleSocket = new TestSocket();
    await subscribe(staleSocket, 101, staleUser);
    vi.mocked(getPersistedUserSessionState).mockImplementation(async (userId) => ({
      sessionVersion: userId === staleUser.id ? 1 : 0,
      mustChangePassword: false,
    }));

    await liveSyncModule.broadcastToClass(101, { type: 'RATING_UPDATED', pupilId: 501 });

    expect(staleSocket.closeCode).toBe(1008);
    expect(staleSocket.messages.some((message) => message.type === 'RATING_UPDATED')).toBe(false);
  });

  it('closes a reset user’s socket and releases its locks immediately', async () => {
    const owner = new TestSocket();
    const observer = new TestSocket();
    await subscribe(owner);
    await subscribe(observer, 101, { ...USER, id: 'observer-teacher' });
    await owner.receive({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 501, itemKey: 'org_1', subjectCode: 'D' },
    });

    const closeUserWebSockets = (liveSyncModule as any).closeUserWebSockets;
    expect(closeUserWebSockets).toBeTypeOf('function');
    closeUserWebSockets(USER.id);

    expect(owner.closeCode).toBe(1008);
    expect(owner.messages).toContainEqual(expect.objectContaining({
      type: 'ERROR',
      code: 'PASSWORD_CHANGE_REQUIRED',
    }));
    await vi.waitFor(() => expect(observer.messages).toContainEqual(expect.objectContaining({
      type: 'CELL_UNLOCKED',
      classId: 101,
      subjectCode: 'D',
      pupilId: 501,
    })));
  });

  it('rejects UPDATE_RATING with CLASS_CONFERENCE_LOCKED when the class conference is locked', async () => {
    const socket = new TestSocket();
    await subscribe(socket);

    const { getClassRoundLockState } = await import('../lib/class-round-lock.js');
    vi.mocked(getClassRoundLockState).mockResolvedValueOnce(true);

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 101,
        pupilId: 501,
        subjectCode: 'D',
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
        clientMutationId: 'mut-lock-1',
      },
    });

    expect(socket.messages).toContainEqual({
      type: 'ERROR',
      message: 'Die Klassenkonferenz ist gesperrt. Bewertungen können nicht mehr geändert werden.',
      code: 'CLASS_CONFERENCE_LOCKED',
      clientMutationId: 'mut-lock-1',
    });
  });
});
