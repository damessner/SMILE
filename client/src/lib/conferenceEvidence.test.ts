import { afterEach, describe, expect, it } from 'vitest';
import {
  formatSubjectEvidence,
  computeSubjectEvidenceBars,
  getRankVisuals,
  type SubjectEvidenceItem,
} from './conferenceEvidence';
import type { AssessmentRank } from './pupilItems';
import {
  resetActiveRubricConfig,
  setActiveRubricConfig,
} from './rubricConfig';

// The rubric config is install-wide module state, so it is reset around every
// test that touches it. Without this a raised item count leaks into the next
// assertion, which is exactly the cross-test coupling it exists to prevent.
afterEach(() => {
  resetActiveRubricConfig();
});

describe('Conference Subject Evidence Formatting (Task 10)', () => {
  const multiSubjectEvidence: SubjectEvidenceItem[] = [
    {
      subjectCode: 'D',
      subjectName: 'Deutsch',
      positiveCount: 10,
      totalRated: 18,
      teacherShort: 'MUE',
    },
    {
      subjectCode: 'M',
      subjectName: 'Mathematik',
      positiveCount: 12,
      totalRated: 18,
      teacherShort: 'SCH',
    },
  ];

  it('formats subject evidence independently without combining positive totals above 18', () => {
    // Total positive count is 10 + 12 = 22, which exceeds 18 items.
    // Evidence must be displayed per-subject, never as a combined 22/18.
    const formatted = formatSubjectEvidence(multiSubjectEvidence);
    expect(formatted).toBe('D 10/18 · M 12/18');
    expect(formatted).not.toContain('22');
    expect(formatted).not.toContain('22/18');
  });

  it('computes independent, bounded evidence bars per subject', () => {
    const bars = computeSubjectEvidenceBars(multiSubjectEvidence);
    expect(bars).toHaveLength(2);

    expect(bars[0]).toEqual({
      key: 'D-MUE',
      subjectCode: 'D',
      subjectName: 'Deutsch',
      percent: 56,
      title: 'Deutsch: 10/18 positiv',
      fillColor: 'bg-blue-500',
    });

    expect(bars[1]).toEqual({
      key: 'M-SCH',
      subjectCode: 'M',
      subjectName: 'Mathematik',
      percent: 67,
      title: 'Mathematik: 12/18 positiv',
      fillColor: 'bg-blue-500',
    });
  });

  it('handles empty or absent evidence gracefully', () => {
    expect(formatSubjectEvidence([])).toBe('keine Bewertung');
    expect(formatSubjectEvidence(null)).toBe('keine Bewertung');
    expect(formatSubjectEvidence(undefined)).toBe('keine Bewertung');
    expect(computeSubjectEvidenceBars([])).toEqual([]);
    expect(computeSubjectEvidenceBars(null)).toEqual([]);
  });

  it('renders every subject against the 18-item rubric maximum and surfaces a partial rubric separately', () => {
    // A subject with 4 of 6 rated items must read "4/18", not "4/6": the bar
    // is a share of the 18-item rubric, so label, bar and rank must agree.
    const partial: SubjectEvidenceItem[] = [
      { subjectCode: 'D', positiveCount: 4, totalRated: 6 },
    ];

    expect(formatSubjectEvidence(partial)).toBe('D 4/18 (6 bewertet)');
    expect(computeSubjectEvidenceBars(partial)[0]?.title).toContain('4/18');
  });

  it('marks counts above the 18-item maximum as a data error instead of silently clamping', () => {
    // Duplicate item keys can push positiveCount past 18. The bar may still
    // clamp for layout, but the data error must stay visible.
    const broken: SubjectEvidenceItem[] = [
      { subjectCode: 'D', positiveCount: 20, totalRated: 20 },
    ];

    expect(formatSubjectEvidence(broken)).toContain('Datenfehler');
    const [bar] = computeSubjectEvidenceBars(broken);
    expect(bar?.percent).toBe(100);
    expect(bar?.title).toContain('Datenfehler');
  });
});

/**
 * One ladder of badge/bar classes for the three ranks and the undecided state.
 *
 * The same triple used to be written out by hand in BeobachtungsGrid and twice
 * more in ConferenceVotingModal, so a subject that changed rank colour in one
 * screen kept the old colour in the others.
 */
describe('getRankVisuals', () => {
  it('gives Meister its gold badge and bar', () => {
    const visuals = getRankVisuals('Meister');
    expect(visuals.badgeBg).toBe('bg-amber-400/20 text-amber-300 border-amber-400/40');
    expect(visuals.barColor).toBe('bg-amber-400');
    expect(visuals.textColor).toBe('text-amber-300');
  });

  it('gives Geselle its blue badge and bar', () => {
    const visuals = getRankVisuals('Geselle');
    expect(visuals.badgeBg).toBe('bg-blue-500/20 text-blue-300 border-blue-500/40');
    expect(visuals.barColor).toBe('bg-blue-500');
    expect(visuals.textColor).toBe('text-blue-300');
  });

  it('gives Lehrling its rose badge and bar', () => {
    const visuals = getRankVisuals('Lehrling');
    expect(visuals.badgeBg).toBe('bg-rose-500/20 text-rose-300 border-rose-500/40');
    expect(visuals.barColor).toBe('bg-rose-500');
    expect(visuals.textColor).toBe('text-rose-300');
  });

  it('stays neutral for an undecided pupil so a pending subject never borrows the lowest rank red', () => {
    const visuals = getRankVisuals(null);
    expect(visuals.badgeBg).toBe('bg-slate-800/50 text-slate-400 border-slate-700');
    expect(visuals.barColor).toBe('bg-slate-600');
    expect(visuals.textColor).toBe('text-slate-400');
    expect(visuals.neutral).toBe(true);
  });

  it('marks every decided rank as not neutral', () => {
    const ranks: AssessmentRank[] = ['Meister', 'Geselle', 'Lehrling'];
    for (const rank of ranks) {
      expect(getRankVisuals(rank).neutral).toBe(false);
    }
  });
});

describe('Conference evidence uses the delivered rubric item count as its denominator', () => {
  const subject: SubjectEvidenceItem = {
    subjectCode: 'D',
    subjectName: 'Deutsch',
    positiveCount: 10,
    totalRated: 12,
    teacherShort: 'MUE',
  };

  it('reads the denominator from the active config, not a baked-in 18', () => {
    setActiveRubricConfig({ meister: 10, geselle: 5, itemCount: 12 });

    expect(formatSubjectEvidence([subject])).toBe('D 10/12');
    expect(computeSubjectEvidenceBars([subject])[0]?.percent).toBe(83);
    expect(computeSubjectEvidenceBars([subject])[0]?.title).toContain('10/12');
  });

  it('falls back to the shipped 18 when the server delivered no item count', () => {
    setActiveRubricConfig({ meister: 14, geselle: 8 });

    expect(formatSubjectEvidence([subject])).toBe('D 10/18 (12 bewertet)');
    expect(computeSubjectEvidenceBars([subject])[0]?.percent).toBe(56);
  });

  it('reports a data error against the delivered denominator, not the default', () => {
    setActiveRubricConfig({ meister: 14, geselle: 8, itemCount: 12 });
    const overfull: SubjectEvidenceItem = { ...subject, positiveCount: 20, totalRated: 12 };

    expect(formatSubjectEvidence([overfull])).toBe('D 20/12 – Datenfehler (max. 12)');
  });
});

describe('Conference evidence bars carry their own subject colour', () => {
  const subject = (
    subjectCode: string,
    positiveCount: number,
    totalRated = 18,
  ): SubjectEvidenceItem => ({
    subjectCode,
    subjectName: subjectCode === 'D' ? 'Deutsch' : subjectCode === 'M' ? 'Mathematik' : subjectCode,
    positiveCount,
    totalRated,
  });

  it('colours each bar from that subject’s own positive count, not the pupil’s rank', () => {
    // A pupil confirmed as Meister while Mathe is weak must not paint every
    // subject amber: the raster is per subject, and so is the bar.
    const bars = computeSubjectEvidenceBars([
      subject('M', 12), // 12 >= 8 -> Geselle band
      subject('D', 20), // 20 >= 14 -> Meister band
      subject('E', 3), //  3 <  8 -> Lehrling band
    ]);

    expect(bars.map((b) => b.fillColor)).toEqual(['bg-blue-500', 'bg-amber-400', 'bg-rose-500']);
  });

  it('reads the band boundaries from the delivered thresholds', () => {
    setActiveRubricConfig({ meister: 20, geselle: 12 });

    const bars = computeSubjectEvidenceBars([subject('D', 16), subject('M', 14)]);

    // 16 clears 12 but not 20; 14 does the same. Neither is Meister any more.
    expect(bars.map((b) => b.fillColor)).toEqual(['bg-blue-500', 'bg-blue-500']);
  });

  it('leaves an unrated subject neutral instead of borrowing the lowest rank’s red', () => {
    // Nothing rated at all is not a weak subject: painting it rose would read
    // as "assessed and found wanting", the same confusion Invariant 5 forbids
    // for the rank badge.
    const [bar] = computeSubjectEvidenceBars([subject('M', 0, 0)]);

    expect(bar.fillColor).toBe('bg-slate-600');
  });
});
