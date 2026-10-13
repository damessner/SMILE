/**
 * Process-wide restore gate.
 *
 * While a restore holds the gate the database is being replaced, so writes must be
 * refused and live sockets must not be re-admitted. The restore route acquires it
 * before the first destructive statement and releases it after success or rollback.
 *
 * Enforcement points outside the restore route (the write hook in index.ts and the
 * /ws upgrade handler in ws/live-sync.ts) must consult isRestoreInProgress().
 */
let restoreInProgress = false;

export function isRestoreInProgress(): boolean {
  return restoreInProgress;
}

/** Returns false, without changing state, when another restore already holds the gate. */
export function tryBeginRestore(): boolean {
  if (restoreInProgress) return false;
  restoreInProgress = true;
  return true;
}

export function endRestore(): void {
  restoreInProgress = false;
}

/** Test seam: clears the gate regardless of holder. */
export function resetRestoreGateForTests(): void {
  restoreInProgress = false;
}
