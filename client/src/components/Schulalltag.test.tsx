import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Schulalltag } from './Schulalltag';
import { ToastProvider } from './Toast';
import { ConfirmProvider } from './ConfirmDialog';
import type { Evaluation, PupilWithData, SchoolClass, User } from '../types';
import type { RubricCriterion } from '../types';

vi.mock('../services/api', () => ({
  getClassCards: vi.fn().mockResolvedValue([]),
  getClassTimeouts: vi.fn().mockResolvedValue([]),
  getCurrentTimetable: vi.fn().mockResolvedValue({ lessons: [], currentPeriod: null }),
  getActiveTimeouts: vi.fn().mockResolvedValue([]),
  getTimeoutHistory: vi.fn().mockResolvedValue([]),
  issueCard: vi.fn().mockResolvedValue({ success: true, card: { id: 'c1' } }),
  revokeCard: vi.fn().mockResolvedValue({ success: true }),
  sendToTimeout: vi.fn().mockResolvedValue({ success: true }),
  resolveTimeout: vi.fn().mockResolvedValue({ success: true }),
  getBehaviorOverview: vi.fn().mockResolvedValue({ schoolWide: true, classes: [], pupils: [] }),
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
  userOverrides: Partial<User> = {},
) {
  const currentClass: SchoolClass = { id: CLASS_ID, name: '3a', grade: 3, mySubjects };
  const currentUser: User = { id: 'u1', username: 'teacher1', role: 'teacher', teacherId: 1, ...userOverrides };

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

  it('uses the confirmed final rank when the class already has a conference decision', async () => {
    const anna = { ...pupil(1, 'Anna Final'), finalRank: 'Meister' as const };
    renderSchulalltag([anna]);

    const row = (await screen.findByText('Anna Final')).closest<HTMLElement>('div.cursor-pointer')!;
    await waitFor(() => expect(within(row).getByText('Meister')).toBeInTheDocument());
    expect(within(row).queryByText('Ausstehend')).toBeNull();
  });

  it('demotes one step after three active yellow cards', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getClassCards).mockResolvedValueOnce(
      Array.from({ length: 3 }, (_, i) => ({
        id: `yellow-${i}`,
        pupil_id: 1,
        class_id: CLASS_ID,
        teacher_id: 1,
        teacher_short: 'TST',
        teacher_name: 'Test',
        card_type: 'yellow' as const,
        created_at: '2026-11-01T10:00:00Z',
      })),
    );
    const anna = pupil(1, 'Anna Yellow', [submittedEvaluation('D', 'Meister')]);
    renderSchulalltag([anna]);

    const row = (await screen.findByText('Anna Yellow')).closest<HTMLElement>('div.cursor-pointer')!;
    await waitFor(() => expect(within(row).getByText('Geselle')).toBeInTheDocument());
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

describe('Schulalltag pupil sorting', () => {
  function behaviourCard(
    id: string,
    pupilId: number,
    cardType: 'green' | 'yellow' | 'red',
  ) {
    return {
      id,
      pupil_id: pupilId,
      class_id: CLASS_ID,
      teacher_id: 1,
      teacher_short: 'TST',
      teacher_name: 'Test',
      card_type: cardType,
      created_at: '2026-11-01T10:00:00Z',
    };
  }

  function timeoutItem(id: string, pupilId: number) {
    return {
      id,
      pupil_id: pupilId,
      class_id: CLASS_ID,
      sent_by_teacher_id: 1,
      sent_at: '2026-11-01T10:00:00Z',
      task_assignment: 'Arbeitsblatt',
      kind: 'timeout' as const,
      status: 'resolved' as const,
      pupil_name: 'Pupil',
      class_name: '3a',
      sent_by_short: 'TST',
      sent_by_name: 'Test',
    };
  }

  function pupilNames(): string[] {
    return screen.getAllByTestId('pupil-name').map((el) => el.textContent ?? '');
  }

  const threePupils = () => [
    pupil(1, 'Anna'),
    pupil(2, 'Bella'),
    pupil(3, 'Carl'),
  ];

  it('sorts alphabetically by name', async () => {
    renderSchulalltag([pupil(3, 'Carl'), pupil(1, 'Anna'), pupil(2, 'Bella')]);

    await screen.findByText('Carl');
    await userEvent.selectOptions(screen.getByLabelText('Sortieren:'), 'name');

    expect(pupilNames()).toEqual(['Anna', 'Bella', 'Carl']);
  });

  it('sorts by rank from Meister to Lehrling, with pending last', async () => {
    renderSchulalltag([
      { ...pupil(1, 'Anna'), finalRank: 'Lehrling' as const },
      { ...pupil(2, 'Bella'), finalRank: 'Meister' as const },
      pupil(3, 'Carl'),
      { ...pupil(4, 'Dora'), finalRank: 'Geselle' as const },
    ]);

    await screen.findByText('Anna');
    await userEvent.selectOptions(screen.getByLabelText('Sortieren:'), 'rank');

    expect(pupilNames()).toEqual(['Bella', 'Dora', 'Anna', 'Carl']);
  });

  it('sorts by green cards with the most first', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getClassCards).mockResolvedValueOnce([
      behaviourCard('g1', 1, 'green'),
      behaviourCard('g2', 2, 'green'),
      behaviourCard('g3', 2, 'green'),
      behaviourCard('g4', 2, 'green'),
      behaviourCard('g5', 3, 'green'),
      behaviourCard('g6', 3, 'green'),
    ] as any);

    renderSchulalltag(threePupils());
    await screen.findByText('Anna');
    await userEvent.selectOptions(screen.getByLabelText('Sortieren:'), 'green');

    await waitFor(() => expect(pupilNames()).toEqual(['Bella', 'Carl', 'Anna']));
  });

  it('sorts by yellow cards with the most first', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getClassCards).mockResolvedValueOnce([
      behaviourCard('y1', 1, 'yellow'),
      behaviourCard('y2', 1, 'yellow'),
      behaviourCard('y3', 2, 'yellow'),
    ] as any);

    renderSchulalltag(threePupils());
    await screen.findByText('Anna');
    await userEvent.selectOptions(screen.getByLabelText('Sortieren:'), 'yellow');

    await waitFor(() => expect(pupilNames()).toEqual(['Anna', 'Bella', 'Carl']));
  });

  it('sorts by red cards with the most first', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getClassCards).mockResolvedValueOnce([
      behaviourCard('r1', 2, 'red'),
      behaviourCard('r2', 1, 'red'),
      behaviourCard('r3', 1, 'red'),
    ] as any);

    renderSchulalltag(threePupils());
    await screen.findByText('Anna');
    await userEvent.selectOptions(screen.getByLabelText('Sortieren:'), 'red');

    await waitFor(() => expect(pupilNames()).toEqual(['Anna', 'Bella', 'Carl']));
  });

  it('sorts by time-outs with the most first', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getClassTimeouts).mockResolvedValueOnce([
      timeoutItem('t1', 3),
      timeoutItem('t2', 3),
      timeoutItem('t3', 1),
    ] as any);

    renderSchulalltag(threePupils());
    await screen.findByText('Anna');
    await userEvent.selectOptions(screen.getByLabelText('Sortieren:'), 'timeout');

    await waitFor(() => expect(pupilNames()).toEqual(['Carl', 'Anna', 'Bella']));
  });

  it('sorts by combined yellow/red/time-out incidents with the most first', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getClassCards).mockResolvedValueOnce([
      behaviourCard('y1', 1, 'yellow'),
      behaviourCard('y2', 1, 'yellow'),
      behaviourCard('r1', 2, 'red'),
    ] as any);
    vi.mocked(api.getClassTimeouts).mockResolvedValueOnce([
      timeoutItem('t1', 3),
      timeoutItem('t2', 3),
      timeoutItem('t3', 3),
    ] as any);

    renderSchulalltag(threePupils());
    await screen.findByText('Anna');
    await userEvent.selectOptions(screen.getByLabelText('Sortieren:'), 'incidents');

    await waitFor(() => expect(pupilNames()).toEqual(['Carl', 'Anna', 'Bella']));
  });
});

describe('live timeout refresh after a class switch', () => {
  it('reloads the class that is open now, not the one open when the listener was registered', async () => {
    const api = await import('../services/api');
    const classA: SchoolClass = { id: 3, name: '3a', grade: 3, mySubjects: [GERMAN] };
    const classB: SchoolClass = { id: 4, name: '4b', grade: 4, mySubjects: [GERMAN] };
    const currentUser: User = { id: 'u1', username: 'teacher1', role: 'teacher', teacherId: 1 };
    const tree = (cls: SchoolClass) => (
      <ToastProvider>
        <ConfirmProvider>
          <Schulalltag
            currentClass={cls}
            classes={[classA, classB]}
            pupils={[]}
            currentUser={currentUser}
            criteria={CRITERIA}
            onSelectClass={vi.fn()}
            onRefreshClassData={vi.fn()}
          />
        </ConfirmProvider>
      </ToastProvider>
    );

    vi.mocked(api.getClassCards).mockClear();
    const { rerender } = render(tree(classA));
    await waitFor(() => expect(api.getClassCards).toHaveBeenCalledWith(3));

    rerender(tree(classB));
    await waitFor(() => expect(api.getClassCards).toHaveBeenCalledWith(4));

    // A colleague sends a pupil to the Lernwerkstatt while 4b is open. The event is
    // delivered through the one listener registered at mount; it must refresh 4b.
    vi.mocked(api.getClassCards).mockClear();
    fireEvent(window, new Event('smile:timeouts-updated'));

    await waitFor(() => expect(api.getClassCards).toHaveBeenCalledWith(4));
    expect(api.getClassCards).not.toHaveBeenCalledWith(3);
  });
});
describe('school-wide Alle Klassen view', () => {
  function overviewPupil(overrides: Record<string, unknown> = {}) {
    return {
      id: 11,
      fullName: 'Anna Muster',
      classId: CLASS_ID,
      className: '3a',
      grade: 3,
      rank: null,
      stage: { level: 0, title: 'Regulärer Schulalltag (Neutrale Basis)', type: 'neutral', behaviorGrade: 'Gut' },
      counts: { green: 0, yellow: 0, red: 0, timeout: 0, cooldown: 0 },
      activeIncident: null,
      canRecord: true,
      ...overrides,
    };
  }

  it('shows every class and records a card in the pupil\'s own class', async () => {
    const api = await import('../services/api');
    vi.mocked(api.getBehaviorOverview).mockResolvedValue({
      schoolWide: true,
      classes: [
        { id: CLASS_ID, name: '3a', grade: 3 },
        { id: 4, name: '4b', grade: 4 },
      ],
      pupils: [
        overviewPupil({ id: 11, fullName: 'Anna Muster' }),
        overviewPupil({ id: 22, fullName: 'Bert Beispiel', classId: 4, className: '4b', grade: 4 }),
      ],
    } as never);
    vi.mocked(api.issueCard).mockResolvedValue({ card: { id: 'card-1' } } as never);

    renderSchulalltag([], [GERMAN], CRITERIA, { schoolWideBehaviour: true });
    await userEvent.click(screen.getByRole('button', { name: /Alle Klassen/ }));

    expect(await screen.findByText('Bert Beispiel')).toBeInTheDocument();
    expect(screen.getAllByText(/Klasse 4b/).length).toBeGreaterThan(0);

    // The second row's green-card button belongs to Bert in class 4b. The card must
    // be written to *his* class, not to the class the teacher happened to have open.
    const greenButtons = screen.getAllByTitle('Grüne Karte vergeben (Lob)');
    expect(greenButtons).toHaveLength(2);
    await userEvent.click(greenButtons[1]!);

    expect(await screen.findByText(/Klasse 4b\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Karte jetzt vergeben' }));

    await waitFor(() =>
      expect(api.issueCard).toHaveBeenCalledWith(22, 4, 'green', undefined),
    );
  });

  it('does not offer the Alle Klassen entry without the capability', async () => {
    renderSchulalltag([]);
    expect(screen.queryByRole('button', { name: /Alle Klassen/ })).toBeNull();
  });
});
