import { config } from '../config.js';

export type Rank = 'Lehrling' | 'Geselle' | 'Meister';

export const RANKS: readonly Rank[] = ['Lehrling', 'Geselle', 'Meister'] as const;

export function isRank(value: unknown): value is Rank {
  return typeof value === 'string' && (RANKS as readonly string[]).includes(value);
}

/** Ratings that count towards the pupil's positive total. */
export function isPositiveRating(rating: string | null | undefined): boolean {
  return rating === 'crown' || rating === 'smile' || rating === '++' || rating === '+';
}

/** A rating that represents an actual decision (excludes 'n.b.' and blanks). */
export function isCountedRating(rating: string | null | undefined): boolean {
  return !!rating && rating !== 'n.b.' && rating.trim() !== '';
}

export interface RatingLike {
  rating: string;
  /**
   * Rubric criterion this rating belongs to. Optional so callers that only carry
   * ratings keep working, but present on every real query: without it a duplicated
   * item row cannot be recognised and would be counted twice.
   */
  itemKey?: string;
  /** When the rating was last written; newest wins for a duplicated itemKey. */
  updatedAt?: string | Date;
}

/**
 * Positive / total item counts for one pupil, grouped by the evaluation they belong to.
 */
export interface RatingGroups {
  positiveCount: number;
  totalRated: number;
  /** Number of distinct evaluations that contributed items. */
  evaluationCount: number;
  /**
   * The figure the rank thresholds are compared against.
   *
   * With `RANK_AGGREGATION=total` (the default, preserving historical behaviour) this
   * is `positiveCount`: every positive item across all of a pupil's evaluations. That
   * total is unbounded — a pupil rated by three core-subject teachers can reach 54
   * items — so 14 is easier to reach with more co-teachers than with one.
   *
   * With `normalized` it is the *mean* positive count across the evaluations that
   * actually contributed items.
   *
   * It does NOT rescale to an 18-item raster, which is what the setting's own docstring
   * used to claim. The "scaling" step was `(positive / 18) * 18`, which is an identity,
   * so the only thing the mode ever did was divide by the number of contributing
   * evaluations. Corrected here rather than left as a comment that misdescribes the
   * code; the arithmetic is now written as the average it actually is. See hardening
   * roadmap D8 — making this mean "14 of 18" needs the per-evaluation *rated* count as
   * the denominator, which is a product decision, not a one-line change.
   */
  scoreForThreshold: number;
}

/**
 * Collapse duplicate rows for the same rubric criterion into the one the client
 * shows: newest `updatedAt` wins, and equal timestamps keep the earlier row.
 *
 * The tie-break is deliberately order, never rating value, so a resolution
 * cannot be biased toward a positive outcome — the same rule `scoreSubject`
 * applies on the client. Items without an `itemKey` cannot be identified as
 * duplicates and are all kept.
 */
export function dedupeRatingsByItemKey(items: RatingLike[]): RatingLike[] {
  const byKey = new Map<string, RatingLike>();
  const withoutKey: RatingLike[] = [];

  for (const item of items ?? []) {
    if (typeof item.itemKey !== 'string' || item.itemKey === '') {
      withoutKey.push(item);
      continue;
    }
    const existing = byKey.get(item.itemKey);
    if (!existing) {
      byKey.set(item.itemKey, item);
      continue;
    }
    if (ratingTimestamp(item) > ratingTimestamp(existing)) {
      byKey.set(item.itemKey, item);
    }
  }

  return [...byKey.values(), ...withoutKey];
}

/** Missing or unparsable timestamps sort as the oldest, so a real one wins. */
function ratingTimestamp(item: RatingLike): number {
  if (!item.updatedAt) return Number.NEGATIVE_INFINITY;
  const ts = new Date(item.updatedAt).getTime();
  return Number.isNaN(ts) ? Number.NEGATIVE_INFINITY : ts;
}

/**
 * Single source of truth for how a pupil's observation items become a rank.
 *
 * Previously this logic was duplicated in `routes/conferences.ts` and
 * `routes/statistics.ts` with hardcoded 14/8 thresholds, and the seeded
 * `assessment_rubrics.grade_boundaries` was never read by any code path.
 * All callers now go through here.
 */
export function summarizeRatings(
  groups: Array<{ evaluationId: string; items: RatingLike[] }>,
): RatingGroups {
  const perEvaluation = groups.map((g) => {
    // One row per criterion before counting, so a duplicated item key cannot
    // inflate the figures past the 18-item raster.
    const items = dedupeRatingsByItemKey(g.items ?? []);
    return {
      positive: items.filter((i) => isPositiveRating(i.rating)).length,
      rated: items.filter((i) => isCountedRating(i.rating)).length,
    };
  });

  const positiveCount = perEvaluation.reduce((sum, e) => sum + e.positive, 0);
  const totalRated = perEvaluation.reduce((sum, e) => sum + e.rated, 0);
  const contributing = perEvaluation.filter((e) => e.rated > 0);

  let scoreForThreshold = positiveCount;

  if (config.rankAggregation === 'normalized' && contributing.length > 0) {
    // The mean positive count per contributing evaluation. Written without the
    // `(positive / perItem) * perItem` round trip this used to perform, which cancelled
    // out to `positive` and made the normalisation a no-op.
    scoreForThreshold = positiveCount / contributing.length;
  }

  return {
    positiveCount,
    totalRated,
    evaluationCount: groups.length,
    scoreForThreshold,
  };
}

/** Map a threshold score onto a rank. A red card demotes by one step, never below Lehrling. */
export function rankFromScore(score: number): Rank {
  if (score >= config.rankThresholds.meister) return 'Meister';
  if (score >= config.rankThresholds.geselle) return 'Geselle';
  return 'Lehrling';
}

export function demote(rank: Rank): Rank {
  if (rank === 'Meister') return 'Geselle';
  if (rank === 'Geselle') return 'Lehrling';
  return 'Lehrling';
}

export interface RankOutcome {
  baseRank: Rank;
  finalRank: Rank;
  hasRedCardDemotion: boolean;
}

/**
 * Full rank for a pupil: observation score, then an instant one-step demotion for an
 * active red card. Returns `baseRank` too so the UI can explain the change.
 */
export function calculateRank(positiveScore: number, hasActiveRedCard: boolean): RankOutcome {
  const baseRank = rankFromScore(positiveScore);
  if (!hasActiveRedCard) {
    return { baseRank, finalRank: baseRank, hasRedCardDemotion: false };
  }
  const finalRank = demote(baseRank);
  return {
    baseRank,
    finalRank,
    hasRedCardDemotion: finalRank !== baseRank,
  };
}