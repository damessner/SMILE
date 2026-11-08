import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebUntisError } from './errors.js';

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, any>>,
  createEntry: vi.fn(async (_params: unknown) => ({ success: true })),
  resolve: vi.fn(),
}));

vi.mock('./client.js', () => ({
  getWebUntisClientForUser: mocks.resolve,
}));

vi.mock('../../db/index.js', () => {
  const update = () => {
    let values: Record<string, unknown> = {};
    const chain: any = {
      set: (next: Record<string, unknown>) => {
        values = next;
        return chain;
      },
      where: () => {
        const row = mocks.rows[0];
        if (row) Object.assign(row, values);
        const result: any = Promise.resolve(undefined);
        result.returning = async () => (row ? [row] : []);
        return result;
      },
    };
    return chain;
  };

  return {
    db: {
      select: () => ({
        from: () => ({
          where: () => ({
            orderBy: () => ({
              limit: async (limit: number) =>
                mocks.rows.filter((row) => row.status === 'pending').slice(0, limit),
            }),
          }),
        }),
      }),
      update,
    },
  };
});

import { processWebUntisOutbox } from './outbox.js';

function pendingRow(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    userId: 'user-1',
    kind: 'classreg_upsert',
    status: 'pending',
    attempts: 0,
    maxAttempts: 8,
    lastError: null,
    nextAttemptAt: new Date(2026, 10, 5, 9, 0),
    createdAt: new Date(2026, 10, 5, 9, 0),
    updatedAt: new Date(2026, 10, 5, 9, 0),
    payload: {
      pupilId: 101,
      classId: 430,
      eventKind: 'yellow',
      text: '[Gelbe Karte] Störung',
      categoryId: 2,
      date: '2026-11-05',
      time: '09:35',
    },
    ...overrides,
  };
}

describe('WebUntis outbox worker', () => {
  beforeEach(() => {
    mocks.rows.length = 0;
    mocks.createEntry.mockReset();
    mocks.createEntry.mockResolvedValue({ success: true });
    mocks.resolve.mockReset();
    mocks.resolve.mockResolvedValue({
      client: { createKlassenbuchEntry: mocks.createEntry },
      account: 'personal',
    });
  });

  it('writes a pending entry with its frozen date and time, then marks it done', async () => {
    const row = pendingRow();
    mocks.rows.push(row);

    const result = await processWebUntisOutbox({ now: new Date(2026, 10, 5, 9, 40) });

    expect(result).toMatchObject({ processed: 1, succeeded: 1, retried: 0, failed: 0 });
    expect(mocks.createEntry).toHaveBeenCalledWith({
      studentId: 101,
      classId: 430,
      date: '2026-11-05',
      time: '09:35',
      categoryId: 2,
      text: '[Gelbe Karte] Störung',
    });
    expect(row.status).toBe('done');
  });

  it('keeps a retryable failure pending and backs off', async () => {
    const row = pendingRow();
    mocks.rows.push(row);
    mocks.createEntry.mockRejectedValueOnce(
      new WebUntisError('WEBUNTIS_UNAVAILABLE', 'WebUntis ist nicht erreichbar.', { retryable: true }),
    );

    const result = await processWebUntisOutbox({ now: new Date(2026, 10, 5, 9, 40) });

    expect(result).toMatchObject({ processed: 1, retried: 1, failed: 0 });
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('nicht erreichbar');
    expect((row.nextAttemptAt as Date).getTime()).toBeGreaterThan(
      new Date(2026, 10, 5, 9, 40).getTime(),
    );
  });

  it('retries a rejected entry instead of marking it done', async () => {
    const row = pendingRow();
    mocks.rows.push(row);
    mocks.createEntry.mockResolvedValueOnce({ success: false });

    const result = await processWebUntisOutbox({ now: new Date(2026, 10, 5, 9, 40) });

    expect(result).toMatchObject({ processed: 1, retried: 1, failed: 0 });
    expect(row.status).toBe('pending');
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain('nicht übernommen');
  });

  it('marks a permanent failure as failed instead of retrying forever', async () => {
    const row = pendingRow();
    mocks.rows.push(row);
    mocks.createEntry.mockRejectedValueOnce(
      new WebUntisError('WEBUNTIS_PERMISSION_DENIED', 'Keine Berechtigung.'),
    );

    const result = await processWebUntisOutbox({ now: new Date(2026, 10, 5, 9, 40) });

    expect(result).toMatchObject({ processed: 1, retried: 0, failed: 1 });
    expect(row.status).toBe('failed');
    expect(mocks.createEntry).toHaveBeenCalledTimes(1);
  });

  it('fails an entry whose teacher has no linked account', async () => {
    const row = pendingRow();
    mocks.rows.push(row);
    mocks.resolve.mockResolvedValueOnce(null);

    const result = await processWebUntisOutbox({ now: new Date(2026, 10, 5, 9, 40) });

    expect(result).toMatchObject({ failed: 1 });
    expect(row.status).toBe('failed');
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });

  it('reclaims a processing claim abandoned by a crash or deploy', async () => {
    const row = pendingRow({ status: 'processing' });
    mocks.rows.push(row);

    const result = await processWebUntisOutbox({ now: new Date(2026, 10, 5, 9, 40) });

    expect(result).toMatchObject({ processed: 1, succeeded: 1 });
    expect(row.status).toBe('done');
    expect(mocks.createEntry).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed payload without calling WebUntis', async () => {
    const row = pendingRow({ payload: { pupilId: 'not-a-number' } });
    mocks.rows.push(row);

    const result = await processWebUntisOutbox({ now: new Date(2026, 10, 5, 9, 40) });

    expect(result).toMatchObject({ failed: 1 });
    expect(row.status).toBe('failed');
    expect(mocks.createEntry).not.toHaveBeenCalled();
  });
});
