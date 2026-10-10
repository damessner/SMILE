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
  submissionDeadline?: string | null,
  criteria: Array<{ id: string; name: string; position: number; items: Array<{ key: string }> }> = CRITERIA,
  classSubjects: Array<{ code: string; name: string; isCoreSmile: boolean }> = mySubjects,
) {
  const currentClass: SchoolClass = { id: CLASS_ID, name: '3a', grade: 3, mySubjects: classSubjects };
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
      submissionDeadline={submissionDeadline}
      criteria={criteria}
    />,
  );
}

/** The configured rubric: exactly the criteria keys the school actually uses. */
const CRITERIA = Array.from({ length: 18 }, (_, i) => ({
  id: `c-${i}`,
  name: `Kriterium ${i}`,
  position: i,
  items: [{ key: `crit_${i}` }],
}));

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

describe('getPupilRank deduplication across subjects', () => {
  it('deduplicates items across multiple subjects and never exceeds 18 points', () => {
    // Pupil has 18 positive items in German and 18 positive items in Maths (same rubric keys)
    const germanItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-d-${i}`,
      itemKey: `crit_${i}`,
      rating: 'smile',
      version: 1,
    }));
    const mathsItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-m-${i}`,
      itemKey: `crit_${i}`,
      rating: 'crown',
      version: 1,
    }));

    const anna = pupil(1, 'Anna Multi', [
      { ...evaluation('D', false), items: germanItems as any },
      { ...evaluation('M', false), items: mathsItems as any },
    ]);

    renderOverview([anna], [GERMAN, MATHS]);
    // Must display D 18/18 Meister and M 18/18 Meister, never 36 / 18 Punkte
    expect(screen.getByText(/D 18\/18 Meister/i)).toBeInTheDocument();
    expect(screen.getByText(/M 18\/18 Meister/i)).toBeInTheDocument();
    expect(screen.queryByText(/36/)).toBeNull();
  });
});

describe('submission deadline display and behavior', () => {
  it('indicates when the deadline has expired', () => {
    const anna = pupil(1, 'Anna Musster', [evaluation('D', true, '2026-10-06T09:00:00.000Z')]);
    renderOverview([anna], [GERMAN], '2020-01-01T00:00:00.000Z');
    expect(screen.getByText(/\(Abgelaufen\)/)).toBeInTheDocument();
  });

  it('indicates active deadline when in future', () => {
    const anna = pupil(1, 'Anna Musster', [evaluation('D', true, '2026-10-06T09:00:00.000Z')]);
    renderOverview([anna], [GERMAN], '2099-01-01T00:00:00.000Z');
    expect(screen.queryByText(/\(Abgelaufen\)/)).toBeNull();
  });
});

describe('subject-labelled scores per subject', () => {
  it('shows distinct scores and ranks per subject rather than an any-positive merged result', () => {
    const germanItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-d-${i}`,
      itemKey: `crit_${i}`,
      rating: i < 6 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00.000Z',
    }));
    const mathsItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-m-${i}`,
      itemKey: `crit_${i}`,
      rating: i < 16 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00.000Z',
    }));

    const anna = pupil(1, 'Anna Multi', [
      { ...evaluation('D', false), items: germanItems as any },
      { ...evaluation('M', false), items: mathsItems as any },
    ]);

    renderOverview([anna], [GERMAN, MATHS]);

    expect(screen.getByText(/D 6\/18 Lehrling/i)).toBeInTheDocument();
    expect(screen.getByText(/M 16\/18 Meister/i)).toBeInTheDocument();
    expect(screen.queryByText(/18 \/ 18 Punkte/i)).toBeNull();
  });
});

describe('scoring uses the configured rubric, not legacy evaluation rows', () => {
  it('counts only configured criteria keys when the data holds dropped keys', () => {
    // The pupil has 18 item rows, but 3 of them use keys the rubric no longer
    // contains. Counts must come from the configured criteria, so only 15 of the
    // 18 configured criteria are rated - not all 18 from the stale rows.
    const items = Array.from({ length: 18 }, (_, i) => ({
      id: `it-d-${i}`,
      itemKey: i < 15 ? `crit_${i}` : `dropped_${i}`,
      rating: 'smile',
      version: 1,
    }));
    const anna = pupil(1, 'Anna Multi', [{ ...evaluation('D', false), items: items as any }]);

    renderOverview([anna], [GERMAN]);

    expect(screen.getByText(/D 15\/18 Meister/i)).toBeInTheDocument();
  });
});

describe('submission scope falls back to the class subject list', () => {
  it('files a pupil under *bewertet* when the class assigns the subjects', () => {
    // mySubjects prop is empty, but currentClass.mySubjects teaches D and M and
    // both are submitted: the folder split must use the effective subject list,
    // not the (empty) teacher prop, or every pupil stays *offen* forever.
    const anna = pupil(1, 'Anna Musster', [
      evaluation('D', true, '2026-10-06T09:00:00.000Z'),
      evaluation('M', true, '2026-10-06T09:05:00.000Z'),
    ]);

    renderOverview([anna], [], undefined, undefined, [GERMAN, MATHS]);

    expect(openCount()).toBe('0');
    expect(rankedCount()).toBe('1');
  });
});