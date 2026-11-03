import { desc } from 'drizzle-orm';
import { db } from '../db/index.js';
import { observationRounds } from '../db/schema.js';

/**
 * The newest observation round, or null when the table is empty.
 *
 * Three call sites used to carry their own copy of this query (conference
 * decisions, the evaluation write path and the live-sync broadcast path). Each
 * copy ordered by `created_at` alone, which is not a total order: two rounds
 * created in the same transaction - or by a replayed migration - can share a
 * timestamp, and then "the latest round" depended on the order the planner
 * happened to return. Different call sites could therefore resolve *different*
 * rounds for the same request, which is exactly the disagreement that let a
 * write land on a round the board was already reading from.
 *
 * The tiebreak is `id`, which is unique. It is a random UUID rather than a
 * time-ordered one, so it makes the result deterministic for every caller but
 * does not imply which of two same-instant rounds is newer; callers that need
 * that ordering must set distinct timestamps.
 */
export async function getLatestRound() {
  const [round] = await db
    .select()
    .from(observationRounds)
    .orderBy(desc(observationRounds.createdAt), desc(observationRounds.id))
    .limit(1);
  return round ?? null;
}
