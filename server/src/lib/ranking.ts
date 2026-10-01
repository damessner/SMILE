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
   * With `RANK_AGGREGATION=total` this is `positiveCount`, preserving the behaviour the
   * system has always reported. With `normalized` each evaluation is rescaled to an
   * 18-item raster before averaging, so "14" always means "14 of 18" no matter how many
   * core-subject teachers rated the pupil.
   */
  scoreForThreshold: number;
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
    const items = g.items ?? [];
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
    const perItem = config.rubricItemCount;
    const scaledTotal = contributing.reduce((sum, e) => sum + (e.positive / perItem) * perItem, 0);
    scoreForThreshold = scaledTotal / contributing.length;
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