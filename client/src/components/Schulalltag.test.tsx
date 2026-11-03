import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Schulalltag } from './Schulalltag';
import { ToastProvider } from './Toast';
import { ConfirmProvider } from './ConfirmDialog';
import type { Evaluation, PupilWithData, SchoolClass, User } from '../types';
import type { RubricCriterion } from '../types';

vi.mock('../services/api', () => ({
  getClassCards: vi.fn().mockResolvedValue([]),
  getCurrentTimetable: vi.fn().mockResolvedValue({ lessons: [], currentPeriod: null }),
  getActiveTimeouts: vi.fn().mockResolvedValue([]),
  getTimeoutHistory: vi.fn().mockResolvedValue([]),
  issueCard: vi.fn().mockResolvedValue({ success: true, card: { id: 'c1' } }),
  revokeCard: vi.fn().mockResolvedValue({ success: true }),
  sendToTimeout: vi.fn().mockResolvedValue({ success: true }),
  resolveTimeout: vi.fn().mockResolvedValue({ success: true }),
}));

const CLASS_ID = 3;
const GERMAN = { code: 'D', name: 'Deutsch', isCoreSmile: true };
const MATHS = { code: 'M', name: 'Mathematik', isCoreSmile: true };

const CRITERIA: RubricCriterion[] = Array.from({ length: 18 }, (_, i) => ({
  id: `c${i}`,
  name: `Kriterium ${i + 1}`,
  position: i,
  items: [{ key: `item_${i + 1}`, label: `Item ${i + 1}` }],
}));

function evaluation(subjectCode: string, items: Evaluation['items'] = []): Evaluation {
  return {
    id: `eval-${subjectCode}`,
    roundId: 'round-1',
    pupilId: 1,
    classId: CLASS_ID,
    subjectCode,
    teacherId: 1,
    isSubmitted: false,
    items,
  };
}

function submittedEvaluation(
  subjectCode: string,
  proposedStatus: 'Lehrling' | 'Geselle' | 'Meister',
  items: Evaluation['items'] = [],
): Evaluation {
  return { ...evaluation(subjectCode, items), proposedStatus, isSubmitted: true };
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

function renderSchulalltag(
  pupils: PupilWithData[],
  mySubjects: Array<{ code: string; name: string; isCoreSmile: boolean }> = [GERMAN, MATHS],
  criteria: RubricCriterion[] = CRITERIA,
) {
  const currentClass: SchoolClass = { id: CLASS_ID, name: '3a', grade: 3, mySubjects };
  const currentUser: User = { id: 'u1', username: 'teacher1', role: 'teacher', teacherId: 1 };

  return render(
    <ToastProvider>
      <ConfirmProvider>
        <Schulalltag
          currentClass={currentClass}
          classes={[currentClass]}
          pupils={pupils}
          currentUser={currentUser}
          criteria={criteria}
          onSelectClass={vi.fn()}
          onRefreshClassData={vi.fn()}
        />
      </ConfirmProvider>
    </ToastProvider>,
  );
}

describe('Schulalltag subject-scoped results and independent red card demotions', () => {
  it('renders distinct subject scores for D and M rather than a merged single rank', async () => {
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

    renderSchulalltag([anna]);

    const annaEl = await screen.findByText('Anna Multi');
    const pupilRow = annaEl.closest<HTMLElement>('div.cursor-pointer')!;

    // The tile shows one rank only: the current lesson's subject (fallback D).
    expect(within(pupilRow).getByText('Lehrling')).toBeInTheDocument();
    // The old per-subject list / pending-subject text is gone from the main row.
    expect(within(pupilRow).queryByText(/D 6\/18/)).toBeNull();
    expect(within(pupilRow).queryByText(/M 16\/18/)).toBeNull();
  });

  it('uses the subject of the current lesson for the pupil tile rank', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getCurrentTimetable).mockResolvedValueOnce({
      dayOfWeek: 2,
      period: 3,
      currentLesson: { className: '3a', subjectCode: 'M' },
      todayLessons: [],
    } as any);

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

    renderSchulalltag([anna]);
    const row = (await screen.findByText('Anna Multi')).closest<HTMLElement>('div.cursor-pointer')!;

    await waitFor(() => expect(within(row).getByText('Meister')).toBeInTheDocument());
  });

  it('uses submitted teacher votes for the pupil-level tile, not one subject rank', async () => {
    const lowItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-low-${i}`,
      itemKey: `item_${i + 1}`,
      rating: i < 6 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00Z',
    }));
    const anna = pupil(1, 'Anna Multi', [
      submittedEvaluation('D', 'Meister', lowItems as any),
      submittedEvaluation('M', 'Meister', lowItems as any),
    ]);

    renderSchulalltag([anna]);
    const row = (await screen.findByText('Anna Multi')).closest<HTMLElement>('div.cursor-pointer')!;

    await waitFor(() => expect(within(row).getByText('Meister')).toBeInTheDocument());
    expect(within(row).queryByText('Lehrling')).toBeNull();
  });

  it('applies red card demotion independently per subject', async () => {
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

    // Mock getClassCards to return an active red card for Anna
    const api = await import('../services/api');
    vi.mocked(api.getClassCards).mockResolvedValueOnce([
      {
        id: 'card-red-1',
        pupil_id: 1,
        class_id: CLASS_ID,
        teacher_id: 1,
        teacher_name: 'Teacher 1',
        card_type: 'red',
        created_at: '2026-10-02T10:00:00Z',
      },
    ] as any);

    renderSchulalltag([anna]);

    // D remains Lehrling (lowest rank) and is the current-lesson fallback tile.
    const row = (await screen.findByText('Anna Multi')).closest<HTMLElement>('div.cursor-pointer')!;
    expect(within(row).getByText('Lehrling')).toBeInTheDocument();

    // The detail panel still carries the per-subject demotion information.
    await userEvent.click(row);
    expect(screen.getByText(/M: 16\/18 positiv/i)).toBeInTheDocument();
    expect(screen.getByText(/herabgestuft auf Geselle/i)).toBeInTheDocument();
  });
});

describe('Schulalltag per-subject panel, red card modal, and configured rubric', () => {
  function subjectItems(prefix: string, positives: number) {
    return Array.from({ length: 18 }, (_, i) => ({
      id: `it-${prefix}-${i}`,
      itemKey: `item_${i + 1}`,
      rating: i < positives ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00Z',
    }));
  }

  function pupilWithPendingD(pupilId: number, name: string) {
    return pupil(pupilId, name, [
      evaluation('D', []),
      evaluation('M', subjectItems('m', 16) as any),
    ]);
  }

  async function mockActiveRedCard() {
    const api = await import('../services/api');
    vi.mocked(api.getClassCards).mockResolvedValue([
      {
        id: 'card-red-1',
        pupil_id: 1,
        class_id: CLASS_ID,
        teacher_id: 1,
        teacher_name: 'Teacher 1',
        card_type: 'red',
        created_at: '2026-10-02T10:00:00Z',
      },
    ] as any);
  }

  it('shows per-subject results in the detail panel, with the unrated subject pending instead of a fabricated Lehrling', async () => {
    const anna = pupilWithPendingD(1, 'Anna Mixed');
    renderSchulalltag([anna]);

    const annaEl = await screen.findByText('Anna Mixed');
    await userEvent.click(annaEl.closest<HTMLElement>('div.cursor-pointer')!);

    // Per-subject counts against the configured 18-item rubric
    expect(screen.getByText(/D: 0\/18 positiv/i)).toBeInTheDocument();
    expect(screen.getByText(/M: 16\/18 positiv/i)).toBeInTheDocument();
    // Pending subject reports no rank; M keeps its calculated Meister
    expect(screen.getByText(/D: 0\/18 positiv · Basis-Rang: Ausstehend/i)).toBeInTheDocument();
    expect(screen.getByText(/M:.*Meister/i)).toBeInTheDocument();
    // The old single first-subject panel line is gone
    expect(screen.queryByText(/Kriterien:/)).toBeNull();
  });

  it('names the actual per-subject demotion in the red card modal instead of the first subject rank', async () => {
    await mockActiveRedCard();
    renderSchulalltag([pupilWithPendingD(1, 'Anna Mixed')]);

    const row = (await screen.findByText('Anna Mixed')).closest<HTMLElement>('div.cursor-pointer')!;
    await userEvent.click(within(row).getByRole('button', { name: /Rot/i }));

    // Step 1 warning mirrors the real demotion: M Meister -> Geselle, not a fabricated Lehrling
    expect(screen.getByText(/M: Meister/i)).toBeInTheDocument();
    expect(screen.getAllByText('Geselle').length).toBeGreaterThan(0);
    expect(screen.queryByText(/zu Lehrling degradieren/i)).toBeNull();
    // The pending subject is explicitly excluded from the demotion
    expect(screen.getByText(/nicht betroffen|kein Rangverlust/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Ja, weiter zur Vorfallsbeschreibung/i }));
    // Step 2 repeats the true demotion
    expect(screen.getByText(/M: Meister\s*➔\s*Geselle/i)).toBeInTheDocument();
  });

  it('scores against the configured rubric keys only, failing closed when no criteria are provided', async () => {
    const dItems = Array.from({ length: 18 }, (_, i) => ({
      id: `it-d-${i}`,
      itemKey: `item_${i + 1}`,
      rating: i < 6 ? 'smile' : 'struggle',
      updatedAt: '2026-10-01T10:00:00Z',
    }));
    const anna = pupil(1, 'Anna Mixed', [evaluation('D', dItems as any)]);

    const { unmount } = renderSchulalltag([anna]);
    const annaRow = (await screen.findByText('Anna Mixed')).closest<HTMLElement>('div.cursor-pointer')!;
    expect(within(annaRow).getByText('Lehrling')).toBeInTheDocument();
    unmount();

    // Without a configured rubric nothing can be scored: the tile stays pending.
    renderSchulalltag([pupil(2, 'Bella NoRubric', [evaluation('D', dItems as any)])], [GERMAN, MATHS], []);
    const bella = await screen.findByText('Bella NoRubric');
    const bellaRow = bella.closest<HTMLElement>('div.cursor-pointer')!;
    expect(within(bellaRow).getByText('Ausstehend')).toBeInTheDocument();
    expect(within(bellaRow).queryByText(/D 0\/0/)).toBeNull();
  });
});

describe('Schulalltag retroactive Time-Out', () => {
  it('sends date and period when the teacher records a past lesson', async () => {
    const api = await import('../services/api');
    const anna = pupil(1, 'Anna Retro');
    renderSchulalltag([anna]);

    const row = (await screen.findByText('Anna Retro')).closest<HTMLElement>('div.cursor-pointer')!;
    await userEvent.click(
      within(row).getByTitle(/Ins Time-Out \(Lernwerkstatt\) schicken/),
    );

    await userEvent.click(
      screen.getByLabelText(/Time-Out nachträglich erfassen/),
    );
    await userEvent.type(
      screen.getByPlaceholderText(/Aufgaben oder Arbeitsblätter/),
      'Arbeitsblatt nachholen',
    );
    await userEvent.selectOptions(screen.getByLabelText('Schulstunde'), '3');
    await userEvent.click(
      screen.getByRole('button', { name: /Time-Out nachtragen/i }),
    );

    await waitFor(() => {
      expect(api.sendToTimeout).toHaveBeenCalledWith(
        1,
        CLASS_ID,
        'Arbeitsblatt nachholen',
        expect.objectContaining({ period: 3, date: expect.any(String) }),
      );
    });
  });
});

