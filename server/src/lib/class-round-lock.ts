import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { classRoundLocks } from '../db/schema.js';

/**
 * Returns true if the observation round is locked globally or specifically for this class.
 */
export function isClassRoundLocked(roundLocked: boolean, classLocked: boolean): boolean {
  return Boolean(roundLocked || classLocked);
}

/**
 * Retrieves the persisted conference lock state for a specific class and observation round.
 * An absent row defaults to unlocked (false).
 */
export async function getClassRoundLockState(roundId: string, classId: number): Promise<boolean> {
  const [row] = await db
    .select({ isLocked: classRoundLocks.isLocked })
    .from(classRoundLocks)
    .where(and(eq(classRoundLocks.roundId, roundId), eq(classRoundLocks.classId, classId)))
    .limit(1);

  return row?.isLocked ?? false;
}
