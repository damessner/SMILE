import { eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { assessmentRubrics, rubricCriteria } from '../db/schema.js';

// ---------------------------------------------------------------------------
// Rubric allowlists — the item keys and rating values a write may use.
//
// These are domain facts about the Beobachtungsraster, so they live in one module
// that every write path imports. They used to be private to the WebSocket module,
// which is how the HTTP write path ended up validating nothing at all.
// ---------------------------------------------------------------------------

/**
 * Every rating value that may be stored on an observation item.
 *
 * `''` is a real value, not an oversight: tapping the active button in the grid clears
 * the cell back to blank, and `n.b.` ("nicht beurteilt") is a stored rating the ranking
 * treats as not-rated. Dropping either from this list would reject input the UI sends.
 */
export const VALID_RATINGS: ReadonlySet<string> = new Set([
  'crown',
  'smile',
  'strain',
  'struggle',
  'sad',
  'restart',
  'newstart',
  '+',
  '++',
  '-',
  'o',
  'n.b.',
  '',
]);

export interface RubricIndex {
  /** itemKey -> criterionId */
  keyToCriterion: Map<string, string>;
  validRatings: ReadonlySet<string>;
}

/**
 * Fold criteria rows into an index of every legal item key.
 *
 * Pure on purpose — no database, no clock, no cache — so the allowlist can be unit
 * tested without a live PostgreSQL. `loadRubricIndex` owns the querying and delegates
 * the fold here.
 *
 * `items` is a `jsonb` column, so its contents are untrusted at runtime: a row whose
 * `items` is not an array, or an item with no string `key`, contributes nothing rather
 * than throwing. A malformed rubric must not be able to take the write path down.
 */
export function buildRubricIndex(criteria: Array<{ id: string; items: unknown }>): RubricIndex {
  const keyToCriterion = new Map<string, string>();

  for (const c of criteria) {
    const items = Array.isArray(c.items) ? (c.items as Array<{ key?: unknown }>) : [];
    for (const item of items) {
      if (typeof item?.key === 'string') keyToCriterion.set(item.key, c.id);
    }
  }

  return { keyToCriterion, validRatings: VALID_RATINGS };
}

/** The criterion an item key belongs to, or null when the key is not in the rubric. */
export function resolveCriterionId(index: RubricIndex, itemKey: string): string | null {
  return index.keyToCriterion.get(itemKey) ?? null;
}

export function isValidRating(index: RubricIndex, rating: string): boolean {
  return index.validRatings.has(rating);
}

// ---------------------------------------------------------------------------
// Loading — one query per minute at most, not one per write.
// ---------------------------------------------------------------------------

const RUBRIC_CACHE_TTL_MS = 60_000;

let rubricCache: { index: RubricIndex; loadedAt: number } | null = null;

/**
 * The default rubric's index, loaded from the database and cached for a minute.
 *
 * A rating write is on the hot path of live grading and the rubric changes roughly
 * never, so re-reading it per write would be pure overhead.
 */
export async function loadRubricIndex(): Promise<RubricIndex> {
  if (rubricCache && Date.now() - rubricCache.loadedAt < RUBRIC_CACHE_TTL_MS) {
    return rubricCache.index;
  }

  const [rubric] = await db
    .select()
    .from(assessmentRubrics)
    .where(eq(assessmentRubrics.isDefault, true))
    .limit(1);

  const criteria = rubric
    ? await db.select().from(rubricCriteria).where(eq(rubricCriteria.rubricId, rubric.id))
    : [];

  const index = buildRubricIndex(criteria);
  rubricCache = { index, loadedAt: Date.now() };
  return index;
}

/** Drop the cached index. Test seam — called by `resetLiveSyncForTests`. */
export function invalidateRubricCache(): void {
  rubricCache = null;
}