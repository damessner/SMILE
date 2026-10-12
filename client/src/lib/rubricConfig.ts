/**
 * The rubric configuration the server is actually running with.
 *
 * `GET /api/classes/:classId/pupils` answers with `rubricConfig` — the values
 * read from `server/src/config.ts` at boot. `server/src/lib/ranking.ts` decides
 * the rank it *stores* from those same values, so a second copy living in the
 * client would let a deployment that raised `RANK_THRESHOLD_MEISTER` show
 * Meister on screen while the server still stores Lehrling.
 *
 * The values are install-wide (one process, one config), which is why they are
 * held here rather than threaded through every component prop: a subject
 * threshold is not per class or per pupil, and 12 `scoreSubject` call sites
 * across six components would each need a new prop to carry the same numbers.
 */

export interface RubricConfig {
  /** Positives at or above which a subject reports Meister. */
  meister?: number;
  /** Positives at or below that a subject still reports Geselle. */
  geselle?: number;
  /** Denominator of the raster: the `/18` in `16/18`. */
  itemCount?: number;
  /** How a multi-teacher pupil's items are combined. */
  aggregation?: string;
}

export interface RankThresholds {
  /** Positives at or above which a subject reports Meister. */
  meister: number;
  /** Positives at or above which a subject reports Geselle. */
  geselle: number;
}

/** The shipped defaults, used until a response carries the real config. */
export const DEFAULT_RANK_THRESHOLDS: RankThresholds = { meister: 14, geselle: 8 };

/** The shipped raster size. */
export const DEFAULT_RUBRIC_ITEM_COUNT = 18;

let active: RubricConfig = {};

/** Test seam: drop back to the shipped defaults. */
export function resetActiveRubricConfig(): void {
  active = {};
}

/**
 * Adopt the config a class response carried.
 *
 * A payload that is absent, partial, or self-contradictory is ignored rather
 * than applied: `positiveCount >= undefined` is always false, so a partial
 * config would silently demote every pupil to Lehrling, and a `geselle` above
 * `meister` could not order the ranks at all. Ignoring it keeps the last usable
 * config (initially the shipped defaults) in force.
 */
export function setActiveRubricConfig(config: unknown): void {
  if (!config || typeof config !== 'object') return;
  const c = config as RubricConfig;

  const meister = typeof c.meister === 'number' && Number.isFinite(c.meister) ? c.meister : null;
  const geselle = typeof c.geselle === 'number' && Number.isFinite(c.geselle) ? c.geselle : null;
  const itemCount = typeof c.itemCount === 'number' && Number.isFinite(c.itemCount) ? c.itemCount : null;

  if (meister === null || geselle === null || geselle >= meister) return;
  if (itemCount !== null && itemCount <= 0) return;

  active = { ...active, ...(meister !== null ? { meister } : {}), ...(geselle !== null ? { geselle } : {}) };
  if (itemCount !== null) active.itemCount = itemCount;
  if (typeof c.aggregation === 'string') active.aggregation = c.aggregation;
}

/** The thresholds the raster maths currently uses. */
export function activeRankThresholds(): RankThresholds {
  if (
    typeof active.meister === 'number' &&
    typeof active.geselle === 'number' &&
    active.geselle < active.meister
  ) {
    return { meister: active.meister, geselle: active.geselle };
  }
  return DEFAULT_RANK_THRESHOLDS;
}

/** The denominator the evidence labels and bars currently use. */
export function activeRubricItemCount(): number {
  if (typeof active.itemCount === 'number' && active.itemCount > 0) {
    return active.itemCount;
  }
  return DEFAULT_RUBRIC_ITEM_COUNT;
}

/**
 * The one rating a quick-grade writes into each raster cell, in cell order.
 *
 * The three fills are derived from the active thresholds rather than fixed, so
 * a one-click grade keeps meaning "this rank" after a reconfiguration:
 *
 * - Meister fills exactly `meister` crowns: it lands on the bar and not above
 *   it, so the raster never looks inflated relative to what the teacher asked
 *   for.
 * - Geselle fills to the midpoint of the band. Filling exactly `geselle`
 *   positives would leave no margin: a teacher demoting a single item would
 *   drop the pupil below the Geselle bar on the next recalculation.
 * - Lehrling fills to half of `geselle`, comfortably underneath it.
 *
 * The returned array is clamped to `itemCount`, because a rubric smaller than
 * the meister threshold cannot hold the fill.
 */
export function quickGradeFills(
  rank: 'Lehrling' | 'Geselle' | 'Meister',
  itemCount: number,
): Array<'crown' | 'smile' | 'struggle'> {
  const { meister, geselle } = activeRankThresholds();
  const cells = Math.max(0, Math.floor(itemCount));

  const positives =
    rank === 'Meister'
      ? meister
      : rank === 'Geselle'
        ? geselle + Math.floor((meister - geselle) / 2)
        : Math.floor(geselle / 2);

  const held = Math.min(cells, positives);
  return Array.from({ length: cells }, (_, i) =>
    i < held ? (rank === 'Meister' ? 'crown' : 'smile') : rank === 'Meister' ? 'smile' : 'struggle',
  );
}
