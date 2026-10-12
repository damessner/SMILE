import { describe, expect, it, vi } from 'vitest';

// Track the ordering the helper asked for so the test can assert on the real
// SQL shape, not on the mocked return value.
const orderCalls: unknown[][] = [];

vi.mock('drizzle-orm', () => {
  const desc = (column: unknown) => ({ __desc: true, column });
  return { desc, and: vi.fn(), eq: vi.fn() };
});

vi.mock('../db/schema.js', () => ({
  observationRounds: { createdAt: { name: 'created_at' }, id: { name: 'id' } },
}));

vi.mock('../db/index.js', () => {
  const query = {
    from: () => query,
    where: () => query,
    orderBy: (...args: unknown[]) => {
      orderCalls.push(args);
      return query;
    },
    limit: async () => [activeRound],
  };
  const activeRound = { id: 'round-current', isLocked: false };
  return {
    db: { select: () => query },
    getPool: () => ({ query: vi.fn() }),
  };
});

describe('getLatestRound', () => {
  it('orders by creation date and breaks ties on id so the newest round is deterministic', async () => {
    const { getLatestRound } = await import('./rounds.js');

    const round = await getLatestRound();

    expect(round).toMatchObject({ id: 'round-current' });
    expect(orderCalls).toHaveLength(1);
    const [[createdAtArg, idArg]] = orderCalls;
    // Both sort directions are descending, and the id column must take part in
    // the ordering at all - a copy that only orders by created_at leaves the
    // result undefined for rows sharing a timestamp.
    expect(createdAtArg).toMatchObject({ __desc: true });
    expect(idArg).toMatchObject({ __desc: true });
  });
});
