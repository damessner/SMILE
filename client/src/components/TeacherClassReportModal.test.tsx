import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TeacherClassReportModal } from './TeacherClassReportModal';
import type { Evaluation, PupilWithData, RubricCriterion, SchoolClass, User } from '../types';

const CLASS_ID = 3;
const GERMAN = { code: 'D', name: 'Deutsch', isCoreSmile: true };
const MATHS = { code: 'M', name: 'Mathematik', isCoreSmile: true };

const EIGHTEEN_CRITERIA: RubricCriterion[] = Array.from({ length: 18 }, (_, i) => ({
  id: `crit_${i + 1}`,
  name: `Merkmal ${i + 1}`,
  position: i + 1,
  items: [{ key: `item_${i + 1}` }],
}));

const SIX_CRITERIA: RubricCriterion[] = Array.from({ length: 6 }, (_, i) => ({
  id: `crit_${i + 1}`,
  name: `Merkmal ${i + 1}`,
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
    submittedAt: '2026-10-02T10:00:00Z',
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

describe('TeacherClassReportModal subject-scoped reports', () => {
  it('renders separate sections per subject and does not merge results into one aggregate score', () => {
    const dItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-d-${i}`,
      itemKey: `item_${i + 1}`,
      rating: i < 6 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00Z',
    }));
    const mItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-m-${i}`,
      itemKey: `item_${i + 1}`,
      rating: i < 16 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00Z',
    }));

    const anna = pupil(1, 'Anna Multi', [
      evaluation('D', dItems as any),
      evaluation('M', mItems as any),
    ]);

    const currentClass: SchoolClass = {
      id: CLASS_ID,
      name: '3a',
      grade: 3,
      mySubjects: [GERMAN, MATHS],
    };
    const currentUser: User = {
      id: 'u1',
      username: 'teacher1',
      role: 'teacher',
      teacher: { id: 1, fullName: 'Max Mustermann', shortName: 'MM' },
    };

    render(
      <TeacherClassReportModal
        currentClass={currentClass}
        pupils={[anna]}
        criteria={EIGHTEEN_CRITERIA}
        currentUser={currentUser}
        onClose={vi.fn()}
      />,
    );

    // Each subject must have its own section/report
    expect(screen.getByText(/Deutsch \(D\)/i)).toBeInTheDocument();
    expect(screen.getByText(/Mathematik \(M\)/i)).toBeInTheDocument();

    // D should show 6 / 18 Lehrling; M should show 16 / 18 Meister
    expect(screen.getByText(/\b6 \/ 18/i)).toBeInTheDocument();
    expect(screen.getByText(/\b16 \/ 18/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Lehrling/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Meister/i).length).toBeGreaterThan(0);

    // No merged 18 / 18 score
    expect(screen.queryByText(/18 \/ 18/i)).toBeNull();
  });

  it('tracks the configured rubric length in the positive-count denominator', () => {
    // 6 configured keys, all positive in German
    const dItems = Array.from({ length: 6 }, (_, i) => ({
      id: `it-d-${i}`,
      itemKey: `item_${i + 1}`,
      rating: 'smile',
      updatedAt: '2026-10-01T10:00:00Z',
    }));

    const anna = pupil(1, 'Anna Multi', [evaluation('D', dItems as any)]);

    const currentClass: SchoolClass = {
      id: CLASS_ID,
      name: '3a',
      grade: 3,
      mySubjects: [GERMAN],
    };
    const currentUser: User = {
      id: 'u1',
      username: 'teacher1',
      role: 'teacher',
      teacher: { id: 1, fullName: 'Max Mustermann', shortName: 'MM' },
    };

    render(
      <TeacherClassReportModal
        currentClass={currentClass}
        pupils={[anna]}
        criteria={SIX_CRITERIA}
        currentUser={currentUser}
        onClose={vi.fn()}
      />,
    );

    // Denominator is the configured rubric length (6), not the hardcoded 18
    expect(screen.getByText(/\b6 \/ 6/i)).toBeInTheDocument();
  });
});
