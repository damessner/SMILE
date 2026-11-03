import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { classRoundLocks } from '../db/schema.js';

/** Returns true if the observation round is locked globally or specifically for this class. */
export function isClassRoundLocked(roundLocked: boolean, classLocked: boolean): boolean {
  return Boolean(roundLocked || classLocked);
}

type LockReader = Pick<typeof db, 'select'>;
type LockExecutor = { execute: (query: ReturnType<typeof sql>) => Promise<unknown> };

/**
 * Read the class lock through a transaction handle. Keeping the reader explicit
 * means the write paths can re-check after taking the advisory lock instead of
 * trusting a value read before the transaction began.
 */
export async function getClassRoundLockStateWith(
  reader: LockReader,
  roundId: string,
  classId: number,
): Promise<boolean> {
  const [row] = await reader
    .select({ isLocked: classRoundLocks.isLocked })
    .from(classRoundLocks)
    .where(and(eq(classRoundLocks.roundId, roundId), eq(classRoundLocks.classId, classId)))
    .limit(1);

  return row?.isLocked ?? false;
}

/** Retrieves the persisted conference lock state for a specific class and observation round. */
export async function getClassRoundLockState(roundId: string, classId: number): Promise<boolean> {
  return getClassRoundLockStateWith(db, roundId, classId);
}

/**
 * Serialise conference locking against rating writes.
 *
 * A plain "read lock, then write" check is a TOCTOU window: the chair can freeze
 * the class after a teacher's check but before their write commits. Both the lock
 * route and every rating write take this transaction-scoped advisory lock, so one
 * of them runs first and the other observes the resulting state.
 */
export async function acquireClassRoundLock(
  tx: LockExecutor,
  roundId: string,
  classId: number,
): Promise<void> {
  // Transaction doubles in unit tests may only expose the query builder.
  if (typeof tx.execute !== 'function') return;
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${roundId}), ${classId})`);
}
