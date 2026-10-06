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
// Batch write validation — the single gate every HTTP batch of ratings passes.
// ---------------------------------------------------------------------------

/**
 * One rating as a client sends it. `criterionId` is deliberately absent: it is
 * derived from `itemKey` server-side, so there is nothing for a client to claim.
 */
export interface BatchItemInput {
  itemKey: string;
  rating: string;
}

export interface ValidatedBatchItem {
  itemKey: string;
  rating: string;
  /** Derived from the rubric, never taken from the request body. */
  criterionId: string;
}

export type BatchValidation =
  | { ok: true; items: ValidatedBatchItem[] }
  | { ok: false; error: string };

/** One German message for every rejected item, matching the existing HTTP tone. */
const REJECTED_ITEM_ERROR = 'Unbekanntes Beobachtungsmerkmal oder ungültiger Bewertungswert.';

/**
 * Validate a whole batch of ratings against the rubric before anything is written.
 *
 * This is the fix for the forgery that made ranks forgeable: the HTTP path used to
 * check only that `itemKey` was present and then wrote the client's own
 * `criterionId`, so 200 invented keys rated `'++'` became 200 positive ratings —
 * an automatic Meister. Now every key must exist in the rubric and the criterion is
 * derived here, which is what the WebSocket path already did.
 *
 * Rejection is all-or-nothing. Returning the valid items and dropping the forged
 * ones would silently look like a successful save, so the first problem fails the
 * request.
 *
 * Pure — no database — so the forgery case is unit-testable. The caller supplies
 * the index via `loadRubricIndex`.
 *
 * Checks run in order: shape, size, cap, then each item's key and rating. The first
 * failure determines the message.
 */
export function validateBatchItems(
  inputs: unknown,
  index: RubricIndex,
  maxItems: number,
): BatchValidation {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    return { ok: false, error: 'Es wurden keine Bewertungen übermittelt.' };
  }
  if (inputs.length > maxItems) {
    return { ok: false, error: 'Zu viele Bewertungen auf einmal.' };
  }

  const items: ValidatedBatchItem[] = [];

  for (const raw of inputs) {
    // `inputs` is untrusted JSON. A non-string is distinguished from `''`, because
    // `''` is itself a legal rating (clearing a cell) while a missing rating is not.
    const itemKey = typeof (raw as BatchItemInput)?.itemKey === 'string'
      ? (raw as BatchItemInput).itemKey
      : null;
    const rating = typeof (raw as BatchItemInput)?.rating === 'string'
      ? (raw as BatchItemInput).rating
      : null;

    // An empty key is rejected by this check rather than left to the lookup below,
    // so a blank key in the rubric data cannot become a writable target. The
    // WebSocket path screens a falsy key in its own guard; this path must not
    // depend on that guard, nor on rubric data never containing a blank key.
    if (itemKey === null || itemKey === '') {
      return { ok: false, error: REJECTED_ITEM_ERROR };
    }

    const criterionId = resolveCriterionId(index, itemKey);
    if (criterionId === null) {
      return { ok: false, error: REJECTED_ITEM_ERROR };
    }

    if (rating === null || !isValidRating(index, rating)) {
      return { ok: false, error: REJECTED_ITEM_ERROR };
    }

    items.push({ itemKey, rating, criterionId });
  }

  return { ok: true, items };
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