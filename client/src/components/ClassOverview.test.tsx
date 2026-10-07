import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClassOverview } from './ClassOverview';
import type { Evaluation, PupilWithData, SchoolClass, User } from '../types';

/**
 * Call-site coverage for `ClassOverview`'s subject scoping.
 *
 * Both decisions the component makes are per-teacher and per-subject, and neither
 * had a test: the Open/Ranked folder split (which pupils this teacher still has to
 * act on) and `getSubmissionInfo` (which evaluation the card badges as submitted).
 * Reverting either to an unscoped `evaluations.some(e => e.isSubmitted)` /
 * `evaluations.find(e => e.isSubmitted)` leaves every other suite green.
 */

const CLASS_ID = 3;
const GERMAN = { code: 'D', name: 'Deutsch', isCoreSmile: true };
const MATHS = { code: 'M', name: 'Mathematik', isCoreSmile: true };

function evaluation(subjectCode: string, isSubmitted: boolean, submittedAt?: string): Evaluation {
  return {
    id: `eval-${subjectCode}`,
    roundId: 'round-1',
    pupilId: 1,
    classId: CLASS_ID,
    subjectCode,
    teacherId: 1,
    isSubmitted,
    submittedAt: submittedAt ?? null,
    items: [],
  };
}

function pupil(id: number, fullName: string, evaluations: Evaluation[]): PupilWithData {
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

function renderOverview(
  pupils: PupilWithData[],
  mySubjects: Array<{ code: string; name: string; isCoreSmile: boolean }> = [GERMAN, MATHS],
) {
  const currentClass: SchoolClass = { id: CLASS_ID, name: '3a', grade: 3, mySubjects };
  const currentUser: User = { id: 'u1', username: 'abc', role: 'teacher', teacherId: 1 };

  return render(
    <ClassOverview
      currentClass={currentClass}
      pupils={pupils}
      onStartRating={vi.fn()}
      onOpenKelReport={vi.fn()}
      onOpenCardDrawer={vi.fn()}
      onReopenEvaluation={vi.fn()}
      canAccessRaster
      mySubjects={mySubjects}
      currentUser={currentUser}
    />,
  );
}

/** The count on the "Offen / Zu bewerten" folder tab. */
function openCount(): string {
  return screen.getByRole('button', { name: /Offen/ }).textContent?.match(/\d+$/)?.[0] ?? '';
}

/** The count on the "Bewertet (Abgeschlossen)" folder tab. */
function rankedCount(): string {
  return screen.getByRole('button', { name: /Bewertet/ }).textContent?.match(/\d+$/)?.[0] ?? '';
}

/** Show the *bewertet* folder; it is not the one rendered by default. */
function showRankedFolder(): void {
  fireEvent.click(screen.getByRole('button', { name: /Bewertet/ }));
}

describe("the Open/Ranked split is scoped to the teacher's own subjects", () => {
  it('files a pupil under *offen* when Deutsch is submitted and Mathematik is not', () => {
    // The defect shape Invariant 4 exists for: a pupil submitted in one subject was
    // filed as done, and the teacher skipped the subject that was still open.
    const anna = pupil(1, 'Anna Musster', [
      evaluation('D', true, '2026-10-06T09:00:00.000Z'),
      evaluation('M', false),
    ]);
    renderOverview([anna]);

    expect(openCount()).toBe('1');
    expect(rankedCount()).toBe('0');
    // The *offen* folder is the one rendered by default, and she is in it.
    expect(screen.getByText('Anna Musster')).toBeInTheDocument();
  });

  it('files a pupil under *bewertet* once every subject in scope is submitted', () => {
    // The control: the split must be able to reach the other folder, or the case
    // above would pass for the wrong reason.
    const anna = pupil(1, 'Anna Musster', [
      evaluation('D', true, '2026-10-06T09:00:00.000Z'),
      evaluation('M', true, '2026-10-06T09:05:00.000Z'),
    ]);
    renderOverview([anna]);

    expect(openCount()).toBe('0');
    expect(rankedCount()).toBe('1');

    showRankedFolder();
    expect(screen.getByText('Anna Musster')).toBeInTheDocument();
  });

  it('ignores a submission in a subject this teacher does not teach here', () => {
    // The teacher teaches only Mathematik in this class. Anna's Deutsch submission
    // is another teacher's business and must not move her out of *offen*.
    const anna = pupil(1, 'Anna Musster', [evaluation('D', true)]);
    renderOverview([anna], [MATHS]);

    expect(openCount()).toBe('1');
    expect(rankedCount()).toBe('0');
    expect(screen.getByText('Anna Musster')).toBeInTheDocument();
  });
});

describe("the card badge is scoped to the teacher's own subjects", () => {
  it('badges the submission inside the teacher\'s own subjects', () => {
    const anna = pupil(1, 'Anna Musster', [evaluation('D', true, '2026-10-06T09:00:00.000Z')]);
    renderOverview([anna], [GERMAN]);

    showRankedFolder();
    expect(screen.getByText('Eingereicht')).toBeInTheDocument();
    // The action button follows the badge, so this pins the same decision twice.
    expect(screen.getByText('Prüfen')).toBeInTheDocument();
  });

  it('shows no badge when the only submission belongs to another subject', () => {
    // `getSubmissionInfo` is the other unpinned call site: unscoped, it would badge
    // Anna as submitted — and offer a reopen control for a decision this teacher
    // never made — on the strength of another teacher's write.
    const anna = pupil(1, 'Anna Musster', [evaluation('D', true)]);
    renderOverview([anna], [MATHS]);

    expect(screen.queryByText('Eingereicht')).toBeNull();
    expect(screen.queryByText('Prüfen')).toBeNull();
    expect(screen.getByText('Bewerten')).toBeInTheDocument();
  });
});