/**
 * Pure helper for displaying per-subject rubric evidence in conference views.
 * Adheres strictly to Invariant 5: rubric criteria are scoped per canonical subject
 * (max 18 items per subject) and positive counts must never be aggregated across subjects.
 */

/**
 * Rubric item maximum (Invariant 5). Every label and bar is a share of this,
 * so a partially-rated subject reads `4/18 (6 bewertet)` and never `4/6`, and a
 * count above it is surfaced as a data error instead of silently clamping.
 *
 * This is the shipped default. The live denominator is whatever
 * `activeRubricItemCount()` reports once the server's `rubricConfig` arrives,
 * because the denominator is configuration and not a fact about the rubric.
 */
export const MAX_RUBRIC_ITEMS = 18;

import type { AssessmentRank } from './pupilItems';
import { activeRubricItemCount, activeRankThresholds } from './rubricConfig';

/**
 * The one ladder of rank colours.
 *
 * `badgeBg` doubles as the badge's text and border colour, so `textColor` is
 * exposed separately for callers that colour text without a border. `neutral`
 * marks the undecided state, where nothing has been rated yet — a pending
 * subject must never borrow the lowest rank's red.
 */
export interface RankVisuals {
  badgeBg: string;
  barColor: string;
  textColor: string;
  neutral: boolean;
}

const RANK_VISUALS: Record<AssessmentRank, { badgeBg: string; barColor: string }> = {
  Meister: {
    badgeBg: 'bg-amber-400/20 text-amber-300 border-amber-400/40',
    barColor: 'bg-amber-400',
  },
  Geselle: {
    badgeBg: 'bg-blue-500/20 text-blue-300 border-blue-500/40',
    barColor: 'bg-blue-500',
  },
  Lehrling: {
    badgeBg: 'bg-rose-500/20 text-rose-300 border-rose-500/40',
    barColor: 'bg-rose-500',
  },
};

export function getRankVisuals(
  rank: AssessmentRank | null | undefined,
): RankVisuals {
  if (rank && rank in RANK_VISUALS) {
    const { badgeBg, barColor } = RANK_VISUALS[rank];
    return {
      badgeBg,
      barColor,
      textColor: badgeBg.match(/text-\S+/)?.[0] ?? 'text-slate-400',
      neutral: false,
    };
  }
  return {
    badgeBg: 'bg-slate-800/50 text-slate-400 border-slate-700',
    barColor: 'bg-slate-600',
    textColor: 'text-slate-400',
    neutral: true,
  };
}

export interface SubjectEvidenceItem {
  subjectCode: string;
  subjectName?: string;
  positiveCount: number;
  totalRated?: number;
  teacherShort?: string;
}

function formatCount(s: SubjectEvidenceItem, itemCount: number): string {
  if (s.positiveCount > itemCount) {
    // Duplicate item keys can push a count past the rubric maximum. The bar
    // still clamps for layout; the label must not hide the underlying error.
    return `${s.positiveCount}/${itemCount} – Datenfehler (max. ${itemCount})`;
  }
  const partial =
    typeof s.totalRated === 'number' && s.totalRated < itemCount
      ? ` (${s.totalRated} bewertet)`
      : '';
  return `${s.positiveCount}/${itemCount}${partial}`;
}

export function formatSubjectEvidence(
  evidence: SubjectEvidenceItem[] | undefined | null,
  itemCount: number = activeRubricItemCount(),
): string {
  if (!evidence || evidence.length === 0) return 'keine Bewertung';
  return evidence.map((s) => `${s.subjectCode} ${formatCount(s, itemCount)}`).join(' · ');
}

export function computeSubjectEvidenceBars(
  evidence: SubjectEvidenceItem[] | undefined | null,
  itemCount: number = activeRubricItemCount(),
): Array<{
  key: string;
  subjectCode: string;
  subjectName?: string;
  percent: number;
  title: string;
  fillColor: string;
}> {
  if (!evidence || evidence.length === 0) return [];
  const { meister, geselle } = activeRankThresholds();
  return evidence.map((s) => {
    // The bar is filled from this subject's own positive count, so a pupil
    // confirmed as Meister does not paint a weak Mathe amber. The boundaries
    // are the delivered rank thresholds, and a subject nobody rated stays
    // neutral: "not assessed" is not a low score.
    const fillColor = s.totalRated === 0
      ? getRankVisuals(null).barColor
      : getRankVisuals(
          s.positiveCount >= meister
            ? 'Meister'
            : s.positiveCount >= geselle
              ? 'Geselle'
              : 'Lehrling',
        ).barColor;
    return {
      key: `${s.subjectCode}-${s.teacherShort || ''}`,
      subjectCode: s.subjectCode,
      subjectName: s.subjectName,
      percent: Math.min(100, Math.round((s.positiveCount / itemCount) * 100)),
      title: `${s.subjectName || s.subjectCode}: ${formatCount(s, itemCount)} positiv`,
      fillColor,
    };
  });
}
