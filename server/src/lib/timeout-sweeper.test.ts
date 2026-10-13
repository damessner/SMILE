import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { LW_CLASS_ID } from './guards.js';

const { updateReturningMock, insertValuesMock, broadcastMock } = vi.hoisted(() => ({
  updateReturningMock: vi.fn(),
  insertValuesMock: vi.fn(async () => undefined),
  broadcastMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          returning: updateReturningMock,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: insertValuesMock,
    })),
  },
}));

vi.mock('../ws/live-sync.js', () => ({
  broadcastToClass: broadcastMock,
}));

import {
  AUTO_RESOLVE_NOTE,
  registerTimeoutSweeper,
  startTimeoutSweeper,
  sweepExpiredTimeouts,
} from './timeout-sweeper.js';
import { endRestore, resetRestoreGateForTests, tryBeginRestore } from './restore-lock.js';

describe('timeout sweeper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetRestoreGateForTests();
    updateReturningMock.mockResolvedValue([]);
  });

  it('updates only expired active rows and sets resolvedBy to null', async () => {
    const now = new Date(2026, 9, 7, 10, 35, 0, 0);
    const sampleIncident = {
      id: 'incident-1',
      pupilId: 10,
      classId: 3,
      status: 'resolved',
      resolvedAt: now,
      resolvedBy: null,
      resolutionNote: AUTO_RESOLVE_NOTE,
      expiresAt: now,
    };
    updateReturningMock.mockResolvedValue([sampleIncident]);

    const count = await sweepExpiredTimeouts(now);
    expect(count).toBe(1);

    // Audit log has null actor (no invented teacher)
    expect(insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: null,
        action: 'TIME_OUT_AUTO_RESOLVED',
        entity: 'timeout_incident',
        entityId: 'incident-1',
        payload: {
          pupilId: 10,
          classId: 3,
          expiredAt: now,
        },
      }),
    );

    // Broadcasts to both pupil class and LW room 999
    expect(broadcastMock).toHaveBeenCalledWith(3, {
      type: 'TIMEOUT_RESOLVED',
      incident: sampleIncident,
    });
    expect(broadcastMock).toHaveBeenCalledWith(LW_CLASS_ID, {
      type: 'TIMEOUT_RESOLVED',
      incident: sampleIncident,
    });
  });

  it('does nothing when no timeouts are expired', async () => {
    updateReturningMock.mockResolvedValue([]);
    const count = await sweepExpiredTimeouts();
    expect(count).toBe(0);
    expect(insertValuesMock).not.toHaveBeenCalled();
    expect(broadcastMock).not.toHaveBeenCalled();
  });

  it('leaves expired rows untouched while a restore holds the gate', async () => {
    expect(tryBeginRestore()).toBe(true);
    try {
      updateReturningMock.mockResolvedValue([
        { id: 'incident-1', pupilId: 10, classId: 3, expiresAt: new Date(2026, 9, 7, 10, 35) },
      ]);
      const count = await sweepExpiredTimeouts(new Date(2026, 9, 7, 10, 36));

      expect(count).toBe(0);
      expect(updateReturningMock).not.toHaveBeenCalled();
      expect(insertValuesMock).not.toHaveBeenCalled();
      expect(broadcastMock).not.toHaveBeenCalled();
    } finally {
      endRestore();
    }
  });

  it('stops timer on onClose hook', async () => {
    let closeHook: (() => void) | null = null;
    const fakeApp = {
      addHook: vi.fn((event: string, fn: any) => {
        if (event === 'onClose') closeHook = () => fn(fakeApp, () => {});
      }),
    } as unknown as FastifyInstance;

    const sweeper = registerTimeoutSweeper(fakeApp, 60_000);
    expect(fakeApp.addHook).toHaveBeenCalledWith('onClose', expect.any(Function));

    // Calling the close hook should stop the timer without error
    expect(closeHook).not.toBeNull();
    closeHook!();
    sweeper.stop();
  });
});
