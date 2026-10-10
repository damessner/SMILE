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
 * The tiebreak is `id` (a monotonically generated uuid), which is unique, so
 * the result is deterministic for every caller.
 */
export async function getLatestRound() {
  const [round] = await db
    .select()
    .from(observationRounds)
    .orderBy(desc(observationRounds.createdAt), desc(observationRounds.id))
    .limit(1);
  return round ?? null;
}
