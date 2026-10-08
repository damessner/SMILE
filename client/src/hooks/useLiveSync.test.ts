import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveSync } from './useLiveSync';
import type { User } from '../types';
import { batchUpdateItems } from '../services/api';

vi.mock('../services/api', () => ({
  batchUpdateItems: vi.fn(),
  SESSION_EXPIRED_EVENT: 'smile-session-expired',
}));

class MockWebSocket {
  static OPEN = 1;
  static autoOpen = true;
  static instances: MockWebSocket[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onclose: ((ev: any) => void) | null = null;
  onmessage: ((ev: any) => void) | null = null;
  onerror: ((ev: any) => void) | null = null;
  readyState = 1;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
    if (MockWebSocket.autoOpen) {
      setTimeout(() => {
        this.onopen?.();
      }, 0);
    }
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.onclose?.({ code: 1000 });
  });

  simulateMessage(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose(code: number, reason = 'network failure') {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

(window as any).WebSocket = MockWebSocket;

const mockUser: User = {
  id: 'u-1',
  username: 'teacher1',
  role: 'teacher',
  mustChangePassword: false,
};

describe('useLiveSync event handling symmetry', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    MockWebSocket.autoOpen = true;
  });

  it('dispatches onRatingUpdated for all server broadcast event types including TIMEOUT_ISSUED and FINAL_RANK_CONFIRMED', async () => {
    const onRatingUpdated = vi.fn();

    renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws).toBeDefined();

    const SERVER_EMITTED_EVENTS = [
      'CARD_ISSUED',
      'CARD_REVOKED',
      'BATCH_ITEMS_UPDATED',
      'BATCH_DEFAULTS_APPLIED',
      'PUPIL_RANKING_SUBMITTED',
      'PUPIL_RANKING_REOPENED',
      'STATUS_UPDATED',
      'TIMEOUT_ISSUED',
      'TIMEOUT_RESOLVED',
      'FINAL_RANK_CONFIRMED',
      'FINAL_RANK_REVOKED',
    ];

    for (const eventType of SERVER_EMITTED_EVENTS) {
      act(() => {
        ws.simulateMessage({ type: eventType, pupilId: 1, classId: 101 });
      });
      expect(onRatingUpdated).toHaveBeenCalledWith(
        expect.objectContaining({ type: eventType, pupilId: 1 })
      );
    }
  });

  it('logs a warning for unknown live sync events', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    renderHook(() => useLiveSync(101, mockUser));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws).toBeDefined();

    act(() => {
      ws.simulateMessage({ type: 'UNKNOWN_CUSTOM_EVENT', foo: 'bar' });
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'Unknown live sync message type:',
      'UNKNOWN_CUSTOM_EVENT'
    );
    warnSpy.mockRestore();
  });

  it('does not dispatch retired server event aliases', async () => {
    const onRatingUpdated = vi.fn();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });

    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    expect(ws).toBeDefined();
    for (const type of ['TIMEOUT_CREATED', 'FINAL_RANK_LOCKED']) {
      act(() => ws.simulateMessage({ type }));
      expect(onRatingUpdated).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith('Unknown live sync message type:', type);
    }
    warnSpy.mockRestore();
  });

  it('exposes the authoritative canRate permission from SYNCED', async () => {
    const { result } = renderHook(() => useLiveSync(101, mockUser));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => ws.simulateMessage({ type: 'SYNCED', classId: 101, canRate: false }));

    expect(result.current.canRate).toBe(false);
  });

  it('surfaces uncorrelated WebSocket errors instead of only logging them', async () => {
    const { result } = renderHook(() => useLiveSync(101, mockUser));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances.at(-1)!;
    act(() => ws.simulateMessage({ type: 'ERROR', message: 'Klasse konnte nicht geöffnet werden.' }));

    expect(result.current.connectionError).toBe('Klasse konnte nicht geöffnet werden.');
  });

  it('sends the subject with a focus message so matching-item locks do not cross subjects', async () => {
    const { result } = renderHook(() => useLiveSync(101, mockUser));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    act(() => {
      (result.current.sendFocus as (...args: any[]) => void)(1, 'org_1', 'M');
    });

    const message = JSON.parse(String(ws.send.mock.calls.at(-1)?.[0]));
    expect(message).toMatchObject({
      type: 'CELL_FOCUS',
      payload: { classId: 101, pupilId: 1, itemKey: 'org_1', subjectCode: 'M' },
    });
  });

  it('keeps D and M locks distinct and only clears the unlocked subject', async () => {
    const { result } = renderHook(() => useLiveSync(101, mockUser));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    act(() => {
      ws.simulateMessage({ type: 'CELL_LOCKED', classId: 101, subjectCode: 'D', pupilId: 1, itemKey: 'org_1', teacherName: 'D-Lehrkraft' });
      ws.simulateMessage({ type: 'CELL_LOCKED', classId: 101, subjectCode: 'M', pupilId: 1, itemKey: 'org_1', teacherName: 'M-Lehrkraft' });
    });
    expect(result.current.softLocks.size).toBe(2);

    act(() => {
      ws.simulateMessage({ type: 'CELL_UNLOCKED', classId: 101, subjectCode: 'D', pupilId: 1, itemKey: 'org_1' });
    });
    expect([...result.current.softLocks.keys()]).toEqual(['M|1|org_1']);
  });

  it('reconnects with a bounded delay and re-subscribes to the selected class', async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useLiveSync(101, mockUser));
    try {
      await act(async () => vi.advanceTimersByTimeAsync(0));

      const first = MockWebSocket.instances[0];
      expect(first.send).toHaveBeenCalledWith(JSON.stringify({
        type: 'SUBSCRIBE_CLASS',
        payload: { classId: 101 },
      }));
      act(() => first.simulateClose(1006));
      expect(result.current.isConnected).toBe(false);

      await act(async () => vi.advanceTimersByTimeAsync(249));
      expect(MockWebSocket.instances).toHaveLength(1);
      await act(async () => vi.advanceTimersByTimeAsync(1));

      expect(MockWebSocket.instances).toHaveLength(2);
      act(() => MockWebSocket.instances[1].onopen?.());
      expect(MockWebSocket.instances[1].send).toHaveBeenCalledWith(JSON.stringify({
        type: 'SUBSCRIBE_CLASS',
        payload: { classId: 101 },
      }));
    } finally {
      unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not retry a policy close and dispatches session recovery', async () => {
    vi.useFakeTimers();
    const sessionExpired = vi.fn();
    window.addEventListener('smile-session-expired', sessionExpired);
    const { result, unmount } = renderHook(() => useLiveSync(101, mockUser));
    try {
      await act(async () => vi.advanceTimersByTimeAsync(0));
      const socket = MockWebSocket.instances[0];
      act(() => socket.simulateClose(1008, 'unauthenticated'));

      expect(result.current.connectionError).toBe('unauthenticated');
      expect(sessionExpired).toHaveBeenCalledTimes(1);
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(MockWebSocket.instances).toHaveLength(1);
    } finally {
      unmount();
      window.removeEventListener('smile-session-expired', sessionExpired);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('does not log the teacher out for a class-level policy close', async () => {
    vi.useFakeTimers();
    const sessionExpired = vi.fn();
    window.addEventListener('smile-session-expired', sessionExpired);
    const { result, unmount } = renderHook(() => useLiveSync(101, mockUser));
    try {
      await act(async () => vi.advanceTimersByTimeAsync(0));
      act(() => MockWebSocket.instances[0].simulateClose(1008, 'not authorised'));

      expect(result.current.connectionError).toBe('not authorised');
      expect(sessionExpired).not.toHaveBeenCalled();
      await act(async () => vi.advanceTimersByTimeAsync(10_000));
      expect(MockWebSocket.instances).toHaveLength(1);
    } finally {
      unmount();
      window.removeEventListener('smile-session-expired', sessionExpired);
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('stops reconnecting after five consecutive transport failures', async () => {
    vi.useFakeTimers();
    MockWebSocket.autoOpen = false;
    const { result, unmount } = renderHook(() => useLiveSync(101, mockUser));
    const delays = [250, 500, 1_000, 2_000, 4_000];
    try {
      for (const [attempt, delay] of delays.entries()) {
        const socket = MockWebSocket.instances.at(-1)!;
        act(() => socket.onopen?.());
        act(() => socket.simulateClose(1006));
        await act(async () => vi.advanceTimersByTimeAsync(delay));
        expect(MockWebSocket.instances).toHaveLength(attempt + 2);
      }

      const last = MockWebSocket.instances.at(-1)!;
      act(() => last.onopen?.());
      act(() => last.simulateClose(1006));
      await act(async () => vi.advanceTimersByTimeAsync(10_000));

      expect(MockWebSocket.instances).toHaveLength(6);
      expect(result.current.connectionError).toBe('Live-Verbindung konnte nicht wiederhergestellt werden.');
    } finally {
      unmount();
      vi.clearAllTimers();
      vi.useRealTimers();
      MockWebSocket.autoOpen = true;
    }
  });

  it('waits for a matching server acknowledgement before resolving a rating write', async () => {
    const onRatingUpdated = vi.fn();
    const { result } = renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    let write: Promise<void> | undefined;
    act(() => {
      write = result.current.sendRating(1, 'criterion-1', 'org_1', 'smile', 1, 'D');
    });

    const message = JSON.parse(String(ws.send.mock.calls.at(-1)?.[0]));
    const requestId = message.payload.clientMutationId;
    expect(requestId).toEqual(expect.any(String));
    let settled = false;
    void write!.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    await act(async () => {
      ws.simulateMessage({
        type: 'RATING_ACK',
        clientMutationId: requestId,
      });
      await write;
    });
    await expect(write).resolves.toBeUndefined();
  });

  it('rejects a rating write when the server returns a correlated ERROR', async () => {
    const { result } = renderHook(() => useLiveSync(101, mockUser));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    let write: Promise<void> | undefined;
    act(() => {
      write = result.current.sendRating(1, 'criterion-1', 'org_1', 'smile', 1, 'D');
    });
    const message = JSON.parse(String(ws.send.mock.calls.at(-1)?.[0]));
    const rejection = expect(write).rejects.toThrow('Die Abgabefrist ist abgelaufen.');

    await act(async () => {
      ws.simulateMessage({
        type: 'ERROR',
        clientMutationId: message.payload.clientMutationId,
        message: 'Die Abgabefrist ist abgelaufen.',
      });
    });

    await rejection;
  });

  it('applies the latest rating and version from a server conflict to the local evaluation', async () => {
    const onRatingUpdated = vi.fn();
    renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    act(() => {
      ws.simulateMessage({
        type: 'CONFLICT',
        evaluationId: 'eval-math-1',
        pupilId: 7,
        itemKey: 'org_1',
        subjectCode: 'M',
        currentRating: 'sad',
        currentVersion: 9,
        updatedBy: 'Kollegin',
        message: 'Konflikt',
      });
    });

    expect(onRatingUpdated).toHaveBeenCalledWith({
      type: 'RATING_UPDATED',
      evaluationId: 'eval-math-1',
      pupilId: 7,
      itemKey: 'org_1',
      rating: 'sad',
      version: 9,
      updatedBy: 'Kollegin',
      updatedAt: undefined,
      subjectCode: 'M',
    });
  });

  it('reloads the class when a conflict carries no evaluation to reconcile', async () => {
    const onRatingUpdated = vi.fn();
    renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    act(() => {
      // The server lost the race and found no evaluation row left to patch: patching a
      // single cell here would leave every other stale value on screen.
      ws.simulateMessage({
        type: 'CONFLICT',
        classId: 101,
        pupilId: 7,
        itemKey: 'org_1',
        subjectCode: 'M',
        currentRating: '',
        currentVersion: 0,
        updatedBy: '',
        message: 'Konflikt',
      });
    });

    expect(onRatingUpdated).toHaveBeenCalledWith({
      type: 'BATCH_ITEMS_UPDATED',
      classId: 101,
      pupilId: 7,
      subjectCode: 'M',
    });
  });

  it('reloads the class when a conflict reports an evaluation but no current version', async () => {
    const onRatingUpdated = vi.fn();
    renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];

    act(() => {
      ws.simulateMessage({
        type: 'CONFLICT',
        evaluationId: 'eval-math-1',
        classId: 101,
        pupilId: 7,
        itemKey: 'org_1',
        subjectCode: 'M',
        message: 'Konflikt',
      });
    });

    expect(onRatingUpdated).toHaveBeenCalledWith({
      type: 'BATCH_ITEMS_UPDATED',
      classId: 101,
      pupilId: 7,
      subjectCode: 'M',
    });
    expect(onRatingUpdated).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'RATING_UPDATED' }),
    );
  });

  it('reloads the class when an HTTP conflict has no evaluation id to patch', async () => {
    const onRatingUpdated = vi.fn();
    vi.mocked(batchUpdateItems).mockRejectedValueOnce(Object.assign(new Error('Konflikt'), {
      code: 'CONFLICT',
      details: {
        classId: 101,
        pupilId: 1,
        itemKey: 'org_1',
        subjectCode: 'M',
      },
    }));
    const { result } = renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    MockWebSocket.instances.at(-1)!.readyState = 3;

    await expect(result.current.sendRating(1, 'criterion-1', 'smile', 'org_1', 4, 'M') as any)
      .rejects.toThrow('Konflikt');
    expect(onRatingUpdated).toHaveBeenCalledWith({
      type: 'BATCH_ITEMS_UPDATED',
      classId: 101,
      pupilId: 1,
      subjectCode: 'M',
    });
  });

  it('rejects a failed HTTP fallback instead of logging and resolving it as saved', async () => {
    vi.mocked(batchUpdateItems).mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useLiveSync(101, mockUser));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
    ws.readyState = 3;

    await expect(result.current.sendRating(1, 'criterion-1', 'org_1', 'smile', 1, 'D'))
      .rejects.toThrow('offline');
  });

  it('applies the confirmed item version after a successful HTTP fallback', async () => {
    const onRatingUpdated = vi.fn();
    const updatedAt = '2026-10-07T14:00:00.000Z';
    vi.mocked(batchUpdateItems).mockResolvedValueOnce({
      items: [{
        id: 'item-1',
        evaluationId: 'eval-math-1',
        itemKey: 'org_1',
        rating: 'smile',
        version: 4,
        updatedAt,
      }],
    });
    const { result } = renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    MockWebSocket.instances.at(-1)!.readyState = 3;

    await act(async () => {
      await result.current.sendRating(1, 'criterion-1', 'org_1', 'smile', 3, 'M');
    });

    expect(onRatingUpdated).toHaveBeenCalledWith({
      type: 'RATING_UPDATED',
      evaluationId: 'eval-math-1',
      pupilId: 1,
      classId: 101,
      itemId: 'item-1',
      itemKey: 'org_1',
      rating: 'smile',
      version: 4,
      updatedAt,
      subjectCode: 'M',
    });
  });

  it('reconciles the displayed item after an HTTP fallback concurrency conflict', async () => {
    const onRatingUpdated = vi.fn();
    vi.mocked(batchUpdateItems).mockRejectedValueOnce(Object.assign(new Error('Konflikt'), {
      code: 'CONFLICT',
      details: {
        evaluationId: 'eval-1',
        pupilId: 1,
        itemKey: 'org_1',
        subjectCode: 'M',
        currentRating: 'sad',
        currentVersion: 9,
        updatedBy: 'Kollegin',
      },
    }));
    const { result } = renderHook(() => useLiveSync(101, mockUser, onRatingUpdated));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    MockWebSocket.instances.at(-1)!.readyState = 3;

    await expect(result.current.sendRating(1, 'criterion-1', 'org_1', 'smile', 7, 'M'))
      .rejects.toThrow('Konflikt');
    expect(batchUpdateItems).toHaveBeenCalledWith(1, 101, 'M', [
      { criterionId: 'criterion-1', itemKey: 'org_1', rating: 'smile', version: 7 },
    ]);
    expect(onRatingUpdated).toHaveBeenCalledWith(expect.objectContaining({
      type: 'RATING_UPDATED',
      evaluationId: 'eval-1',
      subjectCode: 'M',
      rating: 'sad',
      version: 9,
    }));
  });
});
