import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { KelPdfModal } from './KelPdfModal';
import type { Evaluation, PupilWithData, RubricCriterion } from '../types';

const CLASS_ID = 3;
const GERMAN = { code: 'D', name: 'Deutsch' };
const MATHS = { code: 'M', name: 'Mathematik' };

const SIX_CRITERIA: RubricCriterion[] = Array.from({ length: 6 }, (_, i) => ({
  id: `crit_${i + 1}`,
  name: `Dimension ${i + 1}`,
  position: i + 1,
  items: [
    { key: `item_${i * 3 + 1}` },
    { key: `item_${i * 3 + 2}` },
    { key: `item_${i * 3 + 3}` },
  ],
}));

const ONE_ITEM_CRITERIA: RubricCriterion[] = Array.from({ length: 6 }, (_, i) => ({
  id: `crit_${i + 1}`,
  name: `Dimension ${i + 1}`,
  position: i + 1,
  items: [{ key: `item_${i + 1}` }],
}));

function evaluation(subjectCode: string, items: Evaluation['items'] = []): Evaluation {
  return {
    id: `eval-${subjectCode}`,
    roundId: 'round-1',
    pupilId: 1,
    classId: CLASS_ID,
    subjectCode,
    teacherId: 1,
    isSubmitted: true,
    items,
  };
}

function pupil(id: number, fullName: string, evaluations: Evaluation[] = []): PupilWithData {
  return {
    id,
    classId: CLASS_ID,
    fullName,
    isArchived: false,
    evaluations,
    cards: [],
    greenCardCount: 0,
    yellowCardCount: 0,
  };
}

describe('KelPdfModal subject-scoped KEL report sections', () => {
  it('renders separate sections per subject and does not merge ratings into a synthetic 18/18 Meister', () => {
    // 6 positive items in German (Lehrling)
    const dItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-d-${i}`,
      criterionId: `crit_${Math.floor(i / 3) + 1}`,
      itemKey: `item_${i + 1}`,
      rating: i < 6 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00Z',
    }));
    // 16 positive items in Maths (Meister)
    const mItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-m-${i}`,
      criterionId: `crit_${Math.floor(i / 3) + 1}`,
      itemKey: `item_${i + 1}`,
      rating: i < 16 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00Z',
    }));

    const anna = pupil(1, 'Anna Multi', [
      evaluation('D', dItems as any),
      evaluation('M', mItems as any),
    ]);

    render(
      <KelPdfModal
        pupil={anna}
        className="3a"
        criteria={SIX_CRITERIA}
        subjects={[GERMAN, MATHS]}
        onClose={vi.fn()}
      />,
    );

    // Both subject sections must appear
    expect(screen.getByText(/Deutsch \(D\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Mathematik \(M\)/i)).toBeInTheDocument();

    // D section has Lehrling, M section has Meister (also in header summary)
    expect(screen.getAllByText(/Lehrling/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Meister/i).length).toBeGreaterThanOrEqual(1);

    // No cross-subject merged score like 18/18 or 22/18
    expect(screen.queryByText(/18 von 18/i)).toBeNull();
    expect(screen.queryByText(/22 von 18/i)).toBeNull();
  });

  it('tracks the configured rubric length in the status denominator', () => {
    // 6 configured keys, all positive in German
    const dItems = Array.from({ length: 6 }, (_, i) => ({
      id: `it-d-${i}`,
      criterionId: `crit_${i + 1}`,
      itemKey: `item_${i + 1}`,
      rating: 'smile',
      updatedAt: '2026-10-01T10:00:00Z',
    }));

    const anna = pupil(1, 'Anna Multi', [evaluation('D', dItems as any)]);

    render(
      <KelPdfModal
        pupil={anna}
        className="3a"
        criteria={ONE_ITEM_CRITERIA}
        subjects={[GERMAN]}
        onClose={vi.fn()}
      />,
    );

    // Status counts only real entered cells (configured length 6, not 18)
    expect(screen.getByText(/Status: 6 positiv · 6 bewertet/i)).toBeInTheDocument();
    expect(screen.queryByText(/18 bewertet/i)).toBeNull();
  });
});
