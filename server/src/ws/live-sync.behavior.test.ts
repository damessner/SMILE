import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../lib/guards.js';
import { getPersistedUserSessionState } from '../lib/session.js';

vi.mock('../lib/session.js', () => ({
  getPersistedUserSessionState: vi.fn(async () => ({
    sessionVersion: 0,
    mustChangePassword: false,
    teacherActive: true,
  })),
}));

class TestSocket {
  readyState = 1;
  handlers = new Map<string, (...args: any[]) => unknown>();
  messages: unknown[] = [];
  closeCode: number | undefined;
  closeReason: string | undefined;

  on(event: string, handler: (...args: any[]) => unknown): void {
    this.handlers.set(event, handler);
  }

  send(raw: string): void {
    this.messages.push(JSON.parse(raw));
  }

  close(code?: number, reason?: string): void {
    this.closeCode = code;
    this.closeReason = reason;
  }

  async receive(message: unknown): Promise<void> {
    const handler = this.handlers.get('message');
    if (!handler) throw new Error('message handler was not registered');
    await handler(Buffer.from(JSON.stringify(message)));
  }
}

const TEST_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-live-sync-tests',
};

let savedEnv: NodeJS.ProcessEnv;
let handleWebSocketConnection: typeof import('./live-sync.js').handleWebSocketConnection;
let resetLiveSyncForTests: typeof import('./live-sync.js').resetLiveSyncForTests;

beforeAll(async () => {
  savedEnv = { ...process.env };
  Object.assign(process.env, TEST_ENV);
  const liveSync = await import('./live-sync.js');
  handleWebSocketConnection = liveSync.handleWebSocketConnection;
  resetLiveSyncForTests = liveSync.resetLiveSyncForTests;
});

afterAll(() => {
  resetLiveSyncForTests?.();
  for (const key of Object.keys(process.env)) {
    if (!(key in savedEnv)) delete process.env[key];
  }
  Object.assign(process.env, savedEnv);
});

afterEach(() => resetLiveSyncForTests?.());

describe('live UPDATE_RATING subject validation', () => {
  it('rejects an unknown subject before class lookup or database access', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 'Astronomie',
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
      },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültiges Unterrichtsfach.' });
  });

  it('echoes a safe mutation id when rejecting a live rating before database access', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 'Astronomie',
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
        clientMutationId: 'mutation-1',
      },
    });

    expect(socket.messages).toContainEqual({
      type: 'ERROR',
      message: 'Ungültiges Unterrichtsfach.',
      clientMutationId: 'mutation-1',
    });
  });

  it('accepts a known legacy alias and then applies the class-room gate', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 'SD',
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
      },
    });

    expect(socket.messages).toContainEqual({
      type: 'ERROR',
      message: 'Sie haben diese Klasse nicht geöffnet.',
    });
  });

  it('rejects malformed expectedVersion instead of silently defaulting to version 1', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 'D',
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 1.5,
      },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültige Bewertungsversion.' });
  });

  it('rejects a live rating write with no expectedVersion', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    }, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 'D',
        itemKey: 'org_1',
        rating: '+',
      },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültige Bewertungsversion.' });
  });

  it('rejects a non-string subject instead of silently defaulting the write to Deutsch', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 123,
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
      },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültiges Unterrichtsfach.' });
  });

  it('rejects a live rating write with no subject instead of silently defaulting to Deutsch', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    }, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
      },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültiges Unterrichtsfach.' });
  });

  it('rejects unknown UPDATE_RATING fields before room authorization or database access', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 'D',
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
        privilege: 'admin',
      },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Unbekanntes Feld in Bewertung.' });
  });

  it('bounds the ignored criterionId retained for client compatibility', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'UPDATE_RATING',
      payload: {
        classId: 1,
        pupilId: 2,
        subjectCode: 'D',
        itemKey: 'org_1',
        rating: '+',
        expectedVersion: 0,
        criterionId: 'x'.repeat(37),
      },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültige Bewertungsnachricht.' });
  });

  it('rejects unknown SUBSCRIBE_CLASS fields before class lookup', async () => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({
      type: 'SUBSCRIBE_CLASS',
      payload: { classId: 1, role: 'admin' },
    });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültige Klassenanmeldung.' });
  });

  it('ignores unknown event payloads without changing room membership', async () => {
    const { getRoomSizes } = await import('./live-sync.js');
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({ type: 'UNRECOGNIZED_EVENT', payload: { classId: 1 } });

    expect(getRoomSizes()).toEqual({});
    expect(socket.messages).toEqual([]);
  });

  it.each(['1junk', 1.5, 2147483648])('rejects malformed class identifiers on subscribe: %s', async (classId) => {
    const socket = new TestSocket();
    const user: AuthUser = {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    };
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({ type: 'SUBSCRIBE_CLASS', payload: { classId } });

    expect(socket.messages).toContainEqual({ type: 'ERROR', message: 'Ungültige Klassen-ID.' });
  });

  it('drops messages once the socket bucket is empty, reports RATE_LIMITED once, then closes after repeated violations', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    }, 'Lehrkraft');

    // The default burst is 40; consume it with messages that have no side effects.
    for (let i = 0; i < 40; i += 1) {
      await socket.receive({ type: 'UNRECOGNIZED_EVENT', payload: {} });
    }
    expect(socket.messages).toEqual([]);

    // The next message is dropped and the client is told once.
    await socket.receive({ type: 'UNRECOGNIZED_EVENT', payload: {} });
    expect(socket.messages).toContainEqual(
      expect.objectContaining({ type: 'ERROR', code: 'RATE_LIMITED' }),
    );

    // Twenty consecutive violations close the socket with 1008.
    for (let i = 0; i < 20; i += 1) {
      await socket.receive({ type: 'UNRECOGNIZED_EVENT', payload: {} });
    }
    expect(socket.closeCode).toBe(1008);
    expect(socket.closeReason).toBe('rate limit exceeded');
  });

  it('closes a deactivated teacher\u2019s socket with 1008 on the next message', async () => {
    vi.mocked(getPersistedUserSessionState).mockResolvedValueOnce({
      sessionVersion: 0,
      mustChangePassword: false,
      teacherActive: false,
    });
    const socket = new TestSocket();
    handleWebSocketConnection(socket, {
      id: 'teacher-1',
      username: 'teacher',
      role: 'teacher',
      teacherId: 1,
      mustChangePassword: false,
    }, 'Lehrkraft');

    await socket.receive({ type: 'UNRECOGNIZED_EVENT', payload: {} });

    expect(socket.messages).toContainEqual(
      expect.objectContaining({ type: 'ERROR', code: 'ACCOUNT_DEACTIVATED' }),
    );
    expect(socket.closeCode).toBe(1008);
  });
});
