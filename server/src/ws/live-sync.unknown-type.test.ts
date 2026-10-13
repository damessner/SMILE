import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthUser } from '../lib/guards.js';

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

  on(event: string, handler: (...args: any[]) => unknown): void {
    this.handlers.set(event, handler);
  }

  send(raw: string): void {
    this.messages.push(JSON.parse(raw));
  }

  close(): void {}

  async receive(message: unknown): Promise<void> {
    const handler = this.handlers.get('message');
    if (!handler) throw new Error('message handler was not registered');
    await handler(Buffer.from(JSON.stringify(message)));
  }
}

const TEST_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  SMILE_ENV_FILE: 'no-such-env-file-for-live-sync-unknown-type-tests',
};

const user: AuthUser = {
  id: 'teacher-1',
  username: 'teacher',
  role: 'teacher',
  teacherId: 1,
  mustChangePassword: false,
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

let now = 1_000_000;
let warnSpy: ReturnType<typeof vi.spyOn>;
let dateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  now = 1_000_000;
  dateSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  dateSpy.mockRestore();
  warnSpy.mockRestore();
  resetLiveSyncForTests?.();
});

/** Parsed structured warnings emitted for unknown message types. */
function unknownTypeLogs(): Array<Record<string, unknown>> {
  return warnSpy.mock.calls
    .map((args: unknown[]) => String(args[0]))
    .filter((line) => line.includes('ws_unknown_message_type'))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('unknown WebSocket message types', () => {
  it('stays silent on the wire: no reply to the client', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({ type: 'NOT_A_REAL_EVENT', payload: { classId: 1 } });

    expect(socket.messages).toEqual([]);
  });

  it('logs a structured warning with the type name and no payload', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({ type: 'NOT_A_REAL_EVENT', payload: { secret: 'do-not-log-this-value' } });

    const logs = unknownTypeLogs();
    expect(logs).toEqual([
      expect.objectContaining({
        level: 'warn',
        event: 'ws_unknown_message_type',
        messageType: 'NOT_A_REAL_EVENT',
        suppressedSinceLastLog: 0,
      }),
    ]);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain('do-not-log-this-value');
  });

  it('truncates the logged type to 64 characters', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({ type: 'X'.repeat(200), payload: {} });

    const [log] = unknownTypeLogs();
    expect(log.messageType).toBe('X'.repeat(64));
  });

  it('escapes control characters so a type name cannot forge a log line', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({ type: 'EVIL\nFAKE {"level":"error"}', payload: {} });

    const lines = warnSpy.mock.calls.map((args: unknown[]) => String(args[0]));
    const unknownLines = lines.filter((line) => line.includes('ws_unknown_message_type'));
    expect(unknownLines).toHaveLength(1);
    expect(unknownLines[0]).not.toContain('\n');
  });

  it('logs at most once per 10 seconds per socket and reports how many were suppressed', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    now = 1_000_000;
    await socket.receive({ type: 'NOISY', payload: {} });
    now += 1_000;
    await socket.receive({ type: 'NOISY', payload: {} });
    await socket.receive({ type: 'NOISY', payload: {} });
    now += 8_999;
    await socket.receive({ type: 'NOISY', payload: {} });
    expect(unknownTypeLogs()).toHaveLength(1);

    now += 1; // 10 seconds after the first log
    await socket.receive({ type: 'NOISY', payload: {} });

    const logs = unknownTypeLogs();
    expect(logs).toHaveLength(2);
    expect(logs[1]).toEqual(expect.objectContaining({ messageType: 'NOISY', suppressedSinceLastLog: 3 }));
    expect(socket.messages).toEqual([]);
  });

  it('throttles each socket independently', async () => {
    const first = new TestSocket();
    const second = new TestSocket();
    handleWebSocketConnection(first, user, 'Lehrkraft');
    handleWebSocketConnection(second, user, 'Lehrkraft');

    await first.receive({ type: 'NOISY', payload: {} });
    await first.receive({ type: 'NOISY', payload: {} });
    await second.receive({ type: 'NOISY', payload: {} });

    expect(unknownTypeLogs()).toHaveLength(2);
  });

  it('does not log known message types', async () => {
    const socket = new TestSocket();
    handleWebSocketConnection(socket, user, 'Lehrkraft');

    await socket.receive({ type: 'UNSUBSCRIBE_CLASS', payload: { classId: 1 } });

    expect(unknownTypeLogs()).toEqual([]);
  });
});
