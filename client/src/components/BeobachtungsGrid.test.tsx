import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BeobachtungsGrid } from './BeobachtungsGrid';
import { ToastProvider } from './Toast';
import { ConfirmProvider } from './ConfirmDialog';
import { saveEvaluationComment } from '../services/api';
import type { Evaluation, PupilWithData, RubricCriterion } from '../types';

vi.mock('../services/api', () => ({
  saveEvaluationComment: vi.fn(),
}));

const CLASS_ID = 3;
const GERMAN = { code: 'D', name: 'Deutsch', isCoreSmile: true } as const;
const MATHS = { code: 'M', name: 'Mathematik', isCoreSmile: true } as const;

/** One criterion with one item: the grid only needs the shape, not 18 cells. */
const CRITERIA: RubricCriterion[] = [
  { id: 'org', name: 'Organisation', position: 1, items: [{ key: 'org_1' }] },
];

function evaluation(subjectCode: string, overrides: Partial<Evaluation> = {}): Evaluation {
  return {
    id: `eval-${subjectCode}`,
    roundId: 'round-1',
    pupilId: 1,
    classId: CLASS_ID,
    subjectCode,
    teacherId: 1,
    isSubmitted: false,
    items: [],
    ...overrides,
  };
}

/** One rated item, with the version a write for that subject must expect. */
function item(itemKey: string, rating: string, version: number): Evaluation['items'][number] {
  return {
    id: `item-${itemKey}-${version}`,
    evaluationId: 'eval-1',
    criterionId: 'org',
    itemKey,
    rating,
    version,
    updatedByTeacherId: 1,
    updatedAt: '2026-10-07T06:00:00.000Z',
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

interface GridOptions {
  pupils?: PupilWithData[];
  mySubjects?: Array<{ code: string; name: string; isCoreSmile: boolean }>;
  canRate?: boolean;
  canAccessRaster?: boolean;
  onSubmitPupil?: any;
  onReopenPupil?: any;
  onBatchUpdate?: any;
  softLocks?: Map<string, any>;
  criteria?: RubricCriterion[];
  submissionDeadline?: string | null;
  selectedPupilIdProp?: number | null;
  onRate?: ReturnType<typeof vi.fn>;
  isLockedByConference?: boolean;
}

/**
 * The grid calls `useToast()` and `useConfirm()`, and each hook throws outside
 * its provider (`Toast.tsx:107`, `ConfirmDialog.tsx:63`), so every render here
 * goes through both.
 */
function renderGrid({
  pupils = [pupil(1, 'Anna Muster')],
  mySubjects = [GERMAN],
  canRate = true,
  canAccessRaster = true,
  selectedPupilIdProp = null,
  onRate = vi.fn(),
  onSubmitPupil,
  onReopenPupil,
  onBatchUpdate,
  softLocks = new Map(),
  criteria = CRITERIA,
  submissionDeadline = '2099-01-01T00:00:00.000Z',
  isLockedByConference = false,
}: GridOptions = {}) {
  const props: any = {
    pupils,
    criteria,
    submissionDeadline,
    softLocks,
    conflict: null,
    onClearConflict: vi.fn(),
    onSendFocus: vi.fn(),
    onSendBlur: vi.fn(),
    onRate,
    onOpenCardDrawer: vi.fn(),
    onOpenKelReport: vi.fn(),
    isLockedByConference,
    canRate,
    canAccessRaster,
    mySubjects,
    selectedPupilIdProp,
    onSubmitPupil,
    onReopenPupil,
    onBatchUpdate,
  };

  const view = render(
    <ToastProvider>
      <ConfirmProvider>
        <BeobachtungsGrid {...props} />
      </ConfirmProvider>
    </ToastProvider>,
  );

  return {
    ...view,
    /** The rating callback, so a test can assert on what a click would write. */
    onRate,
    rerenderWith(next: GridOptions) {
      view.rerender(
        <ToastProvider>
          <ConfirmProvider>
            <BeobachtungsGrid
              {...props}
              pupils={next.pupils ?? pupils}
              mySubjects={next.mySubjects ?? mySubjects}
              canRate={next.canRate ?? canRate}
              canAccessRaster={next.canAccessRaster ?? canAccessRaster}
              softLocks={next.softLocks ?? softLocks}
              onBatchUpdate={next.onBatchUpdate ?? onBatchUpdate}
              criteria={next.criteria ?? criteria}
              submissionDeadline={next.submissionDeadline ?? submissionDeadline}
              isLockedByConference={next.isLockedByConference ?? isLockedByConference}
              selectedPupilIdProp={
                next.selectedPupilIdProp === undefined ? selectedPupilIdProp : next.selectedPupilIdProp
              }
            />
          </ConfirmProvider>
        </ToastProvider>,
      );
    },
  };
}

/** The conference comment textarea, distinguished from the non-core voting one. */
function commentBox(): HTMLTextAreaElement {
  return screen.getByPlaceholderText(/Zeigt im Unterricht hohe Motivation, arbeitet verlässlich/);
}

/** The roster row button for one pupil. */
function rosterRow(name: string): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(name) });
}

/** The five rating buttons' titles, in render order. */
const RATING_TITLES = [
  'Hervorragend (Krone)',
  'Gut (😊)',
  'Mit Mühe (😖)',
  'Traurig (😢)',
  'Neustart (🔄)',
];

/**
 * Which rating the single grid cell shows as selected, or `null` when it is empty.
 *
 * Every selected rating button carries `border-2` from its active styling
 * (`BeobachtungsGrid.tsx:1578-1603`); an unselected one carries
 * `border border-slate-700/60` and no `border-2`, so its absence is the assertion.
 */
function selectedRating(): string | null {
  for (const title of RATING_TITLES) {
    if (screen.getByTitle(title).className.includes('border-2')) return title;
  }
  return null;
}

/**
 * A clock reading safely before the submission deadline.
 *
 * The rating buttons are disabled once `new Date(2026, 9, 30, 23, 59, 59)` has
 * passed (`BeobachtungsGrid.tsx:281`), so a test that clicks one after that date
 * stops testing anything and stays green. Pinning the clock keeps these tests
 * honest on both sides of the deadline.
 */
const BEFORE_DEADLINE = new Date(2026, 9, 1, 9, 0, 0);

/**
 * The roster's "Eingereicht" tick is a bare lucide icon with no accessible name -
 * it is the only child of the row that can be an `<svg>`, so its presence is the
 * assertion. The word "Eingereicht" itself is asserted separately, from the header
 * badge.
 */
function rosterTick(row: HTMLElement): SVGSVGElement | null {
  return row.querySelector('svg');
}

/**
 * Mutes the `console.error` that `flushComment` emits when it recovers from a
 * failed write. That log is correct in production and only noise here, and the
 * plan requires pristine output - but it must be silenced *here*, not by
 * deleting it from the component.
 *
 * Only `Error` arguments are swallowed, so anything else a test triggers (a
 * React act warning, in particular) still reaches the reporter. The spy is
 * taken back in `beforeEach` rather than `afterEach` on purpose: the restored
 * pending is flushed again by the unmount cleanup, which runs after the test
 * body has finished and would otherwise print past the end of the spy.
 */
function silenceSaveError(): void {
  const original = console.error;
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    if (args[0] instanceof Error) return;
    original(...args);
  });
}

beforeEach(() => {
  // Undo a `silenceSaveError()` from the previous test; see its doc comment for
  // why this cannot live in `afterEach`.
  if (vi.isMockFunction(console.error)) vi.mocked(console.error).mockRestore();
  vi.mocked(saveEvaluationComment).mockReset();
  vi.mocked(saveEvaluationComment).mockResolvedValue(undefined);
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Call-site coverage for the subject-scoped isSubmitted checks ------------
//
// These cases pin `isPupilFullySubmitted` in the roster row and the folder split
// above it. Reverting either to the unscoped `evaluations.some(e => e.isSubmitted)`
// makes them fail.

describe('isSubmitted is scoped to the subjects in view', () => {
  it('does not tick a pupil who submitted Deutsch when Mathematik is still open', () => {
    // Submitted in D, no M evaluation at all. Viewed in single-subject M mode.
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { isSubmitted: true })]);
    renderGrid({ pupils: [anna], mySubjects: [MATHS] });

    // No "Eingereicht" tick anywhere for this pupil.
    expect(screen.queryByText('Eingereicht')).toBeNull();

    expect(rosterTick(rosterRow('Anna Muster'))).toBeNull();

    // She sits in the *offen* folder, and that folder is the one rendered.
    const offen = screen.getByRole('button', { name: /Offen/ });
    const bewertet = screen.getByRole('button', { name: /Bewertet/ });
    expect(offen).toHaveTextContent('1');
    expect(bewertet).toHaveTextContent('0');
    expect(rosterRow('Anna Muster')).toHaveTextContent(/^Anna MusterAusstehend$/);
  });

  it('does not tick a pupil with D submitted and M open in Gesamt (all-subject) mode', () => {
    // Every subject in scope must be submitted: D is, M is not.
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { isSubmitted: true }),
      evaluation('M', { isSubmitted: false }),
    ]);
    renderGrid({ pupils: [anna], mySubjects: [GERMAN, MATHS] });

    expect(screen.queryByText('Eingereicht')).toBeNull();
    expect(rosterTick(rosterRow('Anna Muster'))).toBeNull();
    expect(screen.getByRole('button', { name: /Offen/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /Bewertet/ })).toHaveTextContent('0');
  });

  it('does tick a pupil submitted in the only subject in view', () => {
    // The control: the same assertion must be able to see a tick, or the two
    // cases above would pass for the wrong reason.
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { isSubmitted: true })]);
    renderGrid({ pupils: [anna], mySubjects: [GERMAN] });

    expect(screen.getByText('Eingereicht')).toBeInTheDocument();
    expect(rosterTick(rosterRow('Anna Muster'))).not.toBeNull();
    expect(screen.getByRole('button', { name: /Offen/ })).toHaveTextContent('0');
    expect(screen.getByRole('button', { name: /Bewertet/ })).toHaveTextContent('1');
  });
});

// --- The item lookup is subject-scoped, all the way to the rendered cell ----
//
// The helper is unit-tested in `client/src/lib/pupilItems.test.ts` ("does not fall
// back to another subject when the subject has no evaluation", "does not borrow a
// key that only a subject outside the scope holds"). These two cases assert what
// the grid *draws*, which is the claim that was wrong: pasting the deleted widening
// branch back into `getItemData` used to leave this suite green, because nothing
// here had ever looked at a rendered rating cell.

describe('the rendered cells hold no rating from another subject', () => {
  it('renders an empty cell when only a subject outside the view holds the item', () => {
    // Anna is rated in Deutsch; Mathematik is what is on screen, so Deutsch's
    // `org_1` is another teacher's business in this view.
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: [item('org_1', 'smile', 3)] }),
      evaluation('M'),
    ]);
    renderGrid({ pupils: [anna], mySubjects: [MATHS] });

    expect(selectedRating()).toBeNull();
    // The reset control renders only over a stored rating - a second, independent
    // read on the same fact.
    expect(screen.queryByTitle('Bewertung löschen (Leer)')).toBeNull();
    // The out-of-scope rating cannot influence the compact roster, which only shows the rank.
    expect(rosterRow('Anna Muster')).toHaveTextContent(/^Anna MusterAusstehend$/);
  });

  it('fills the cell when the subject in view holds the item', () => {
    // The control: the assertions above must be able to see a filled cell, or they
    // would pass for the wrong reason.
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { items: [item('org_1', 'smile', 3)] })]);
    renderGrid({ pupils: [anna], mySubjects: [GERMAN] });

    expect(selectedRating()).toBe('Gut (😊)');
    expect(screen.getByTitle('Bewertung löschen (Leer)')).toBeInTheDocument();
    expect(rosterRow('Anna Muster')).toHaveTextContent(/^Anna MusterLehrling$/);
  });
});

// --- Every subject's write carries its own item version --------------------

describe('a rating write carries the version of the subject it targets', () => {
  it('carries each subject version through the HTTP batch fallback', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: [item('org_1', 'smile', 7)] }),
      evaluation('M', { items: [item('org_1', 'sad', 3)] }),
    ]);
    const onBatchUpdate = vi.fn().mockResolvedValue(undefined);
    renderGrid({ pupils: [anna], mySubjects: [GERMAN, MATHS], onBatchUpdate });

    fireEvent.click(screen.getByTitle(/Alle Merkmale dieser Kategorie mit Krone/));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onBatchUpdate).toHaveBeenCalledTimes(2);
    expect(onBatchUpdate).toHaveBeenNthCalledWith(1, 1, [
      { criterionId: 'org', itemKey: 'org_1', rating: 'crown', version: 7 },
    ], 'D');
    expect(onBatchUpdate).toHaveBeenNthCalledWith(2, 1, [
      { criterionId: 'org', itemKey: 'org_1', rating: 'crown', version: 3 },
    ], 'M');
  });

  it('does not report a rating saved while its write request is still pending', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    let resolveWrite!: () => void;
    const onRate = vi.fn(() => new Promise<void>((resolve) => { resolveWrite = resolve; }));
    renderGrid({ onRate });

    fireEvent.click(screen.getByTitle('Gut (😊)'));
    expect(screen.getByText('Wird gesichert...')).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByText(/Gesichert \(/)).not.toBeInTheDocument();

    await act(async () => resolveWrite());
  });

  it('does not let an earlier rating save timer clear a later pending write', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    const resolveWrites: Array<() => void> = [];
    const onRate = vi.fn(() => new Promise<void>((resolve) => resolveWrites.push(resolve)));
    renderGrid({ mySubjects: [GERMAN, MATHS], onRate });

    fireEvent.click(screen.getByTitle('Gut (😊)'));
    fireEvent.click(screen.getByTitle('Traurig (😢)'));
    expect(resolveWrites).toHaveLength(4);

    await act(async () => {
      resolveWrites[2]();
      resolveWrites[3]();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(screen.queryByText(/Gesichert \(/)).not.toBeInTheDocument();

    await act(async () => {
      resolveWrites[0]();
      resolveWrites[1]();
      await Promise.resolve();
    });
    await act(async () => vi.advanceTimersByTimeAsync(400));
    expect(screen.getByText(/Gesichert \(/)).toBeInTheDocument();
  });

  it('waits for every subject write to settle before showing a batch failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    let rejectDeutsch!: (error: Error) => void;
    let resolveMathematik!: () => void;
    const onRate = vi.fn((_pupil, _criterion, _item, _rating, _version, subjectCode) =>
      subjectCode === 'D'
        ? new Promise<void>((_resolve, reject) => { rejectDeutsch = reject; })
        : new Promise<void>((resolve) => { resolveMathematik = resolve; }),
    );
    renderGrid({ mySubjects: [GERMAN, MATHS], onRate });

    fireEvent.click(screen.getByTitle('Gut (😊)'));
    await act(async () => {
      rejectDeutsch(new Error('Deutsch offline'));
      await Promise.resolve();
    });
    expect(screen.getByText('Wird gesichert...')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(screen.queryByText(/Gesichert \(/)).not.toBeInTheDocument();

    await act(async () => resolveMathematik());
    expect(screen.getByRole('alert')).toHaveTextContent('Deutsch offline');
    expect(screen.queryByText(/Gesichert \(/)).not.toBeInTheDocument();
  });

  it('waits for every item in a quick-fill action before reporting partial failure', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: () => void;
    const onRate = vi.fn((_pupil, _criterion, itemKey) => itemKey === 'org_1'
      ? new Promise<void>((_resolve, reject) => { rejectFirst = reject; })
      : new Promise<void>((resolve) => { resolveSecond = resolve; }));
    const criteria: RubricCriterion[] = [{
      id: 'org',
      name: 'Organisation',
      position: 1,
      items: [{ key: 'org_1' }, { key: 'org_2' }],
    }];
    renderGrid({ criteria, onRate });

    fireEvent.click(screen.getByTitle(/Alle Merkmale dieser Kategorie mit Krone/));
    expect(onRate).toHaveBeenCalledTimes(2);
    await act(async () => {
      rejectFirst(new Error('first item failed'));
      await Promise.resolve();
    });

    expect(screen.getByText('Wird gesichert...')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await act(async () => resolveSecond());
    expect(screen.getByRole('alert')).toHaveTextContent('first item failed');
    expect(screen.queryByText(/Gesichert \(/)).not.toBeInTheDocument();
  });

  it('sends 7 for Deutsch and 3 for Mathematik on the same item key', async () => {
    // The optimistic-concurrency contract at the point it is actually applied.
    // Resolving one version for the whole grid makes the server's
    // `UPDATE ... WHERE version = $expected` match zero rows for every subject but
    // the first, and the teacher is shown a conflict on a cell nobody touched.
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: [item('org_1', 'struggle', 7)] }),
      evaluation('M', { items: [item('org_1', 'struggle', 3)] }),
    ]);
    const { onRate } = renderGrid({ pupils: [anna], mySubjects: [GERMAN, MATHS] });

    fireEvent.click(screen.getByTitle('Gut (😊)'));

    expect(onRate).toHaveBeenCalledTimes(2);
    expect(onRate).toHaveBeenNthCalledWith(1, 1, 'org', 'org_1', 'smile', 7, 'D');
    expect(onRate).toHaveBeenNthCalledWith(2, 1, 'org', 'org_1', 'smile', 3, 'M');

    // Drain the "Gesichert" badge timer the click scheduled, inside act so it cannot
    // land after the test body has finished.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
  });

  it('sends the version each subject holds even when the displayed rating came from another', () => {
    // Gesamt mode draws one cell from the merged view - here Deutsch's 'struggle' -
    // so the button is not "already selected" for Mathematik. The version must still
    // be the one that subject's own row is at.
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: [item('org_1', 'struggle', 7)] }),
      evaluation('M', { items: [item('org_1', 'struggle', 3)] }),
    ]);
    const { onRate } = renderGrid({ pupils: [anna], mySubjects: [GERMAN, MATHS] });

    fireEvent.click(screen.getByTitle('Traurig (😢)'));

    expect(onRate).toHaveBeenNthCalledWith(1, 1, 'org', 'org_1', 'sad', 7, 'D');
    expect(onRate).toHaveBeenNthCalledWith(2, 1, 'org', 'org_1', 'sad', 3, 'M');
  });
});

// --- Conference comment autosave --------------------------------------------

describe('conference comment autosave', () => {
  it('persists the typed comment on blur', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.type(commentBox(), 'Sehr motiviert');
    await user.tab();

    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
  });

  it('shows the badge only after the server confirms, and toasts on rejection', async () => {
    // The assertion that would have caught the original bug: the old onBlur
    // called markSaved() unconditionally, so a failed save still reported
    // "Gesichert" and the text was gone.
    silenceSaveError();
    vi.mocked(saveEvaluationComment).mockRejectedValue(new Error('500'));
    const user = userEvent.setup();
    renderGrid();

    await user.type(commentBox(), 'Sehr motiviert');
    await user.tab();

    expect(await screen.findByText(/Kommentar konnte nicht gespeichert werden/)).toBeInTheDocument();
    expect(screen.queryByText(/^Gesichert \(/)).toBeNull();
    expect(screen.queryByText(/Wird gesichert/)).toBeNull();
  });

  it('shows the badge once the save resolves', async () => {
    const user = userEvent.setup();
    renderGrid();

    await user.type(commentBox(), 'Sehr motiviert');
    await user.tab();

    expect(await screen.findByText(/^Gesichert \(/)).toBeInTheDocument();
  });

  it('does not autosave a comment when the class lock arrives after typing', async () => {
    // The conference lead presses "Abstimmung GESPERRT" while the teacher is
    // mid-sentence. The debounced flush must read the *current* lock state,
    // not the state its memoized closure captured when it was created.
    const user = userEvent.setup();
    const anna = pupil(1, 'Anna Muster', [evaluation('D')]);
    const { rerenderWith } = renderGrid({ pupils: [anna], mySubjects: [GERMAN] });

    await user.type(commentBox(), 'Beschlussbegründung für Anna');
    rerenderWith({ isLockedByConference: true });
    await user.tab();

    expect(saveEvaluationComment).not.toHaveBeenCalled();
  });

  it("shows the server's lock message instead of an unsatisfiable retry hint", async () => {
    // A 423 CLASS_CONFERENCE_LOCKED rejection must reach the teacher as the
    // server's own message: "Bitte erneut versuchen" can never succeed while
    // the class is locked.
    silenceSaveError();
    vi.mocked(saveEvaluationComment).mockRejectedValue(
      Object.assign(
        new Error('Die Klassenkonferenz ist gesperrt. Bewertungen können nicht geändert werden.'),
        { name: 'ApiError', status: 423, code: 'CLASS_CONFERENCE_LOCKED' },
      ),
    );
    const user = userEvent.setup();
    renderGrid();

    await user.type(commentBox(), 'Beschlussbegründung');
    await user.tab();

    expect((await screen.findAllByText(/Klassenkonferenz ist gesperrt/)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Bitte erneut versuchen/)).toBeNull();
  });

  it('flushes the pending comment when the selected pupil changes inside the debounce window', async () => {
    // The plan's Review Focus #2: a teacher who types the justification and
    // immediately clicks the next pupil gets no blur, so only the switch can
    // save the text.
    vi.useFakeTimers();
    const anna = pupil(1, 'Anna Muster');
    const bernd = pupil(2, 'Bernd Berger');
    const { rerenderWith } = renderGrid({ pupils: [anna, bernd], selectedPupilIdProp: 1 });

    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    expect(saveEvaluationComment).not.toHaveBeenCalled();

    // Switch well inside the 800ms window.
    rerenderWith({ selectedPupilIdProp: 2 });
    await vi.advanceTimersByTimeAsync(0);

    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
    // Bernd's own comment box is empty: nothing was saved against him.
    expect(commentBox()).toHaveValue('');

    // A timer left over from Anna must not fire against Bernd's box later.
    await vi.advanceTimersByTimeAsync(800);
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
  });

  it('cancels the debounce timer of a write it already performed', async () => {
    // A blur performs the write; the timer scheduled by the same keystrokes is
    // still due 700ms later. It must not fire and flush again. This is only
    // observable when there is something pending at that moment - which happens
    // exactly when the blur failed and handed the pending back for a retry: the
    // retry is the teacher's deliberate next blur, not a timer that survived
    // the flush it belonged to.
    vi.useFakeTimers();
    silenceSaveError();
    vi.mocked(saveEvaluationComment)
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue(undefined);
    renderGrid();

    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    await act(async () => {
      // Blur well before t=800: writes once, fails, restores the pending.
      fireEvent.blur(commentBox());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(800);

    // A surviving timer would have fired here and turned the failure into an
    // unrequested, unannounced retry.
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
  });

  it('retries a restored pending against its own pupil on the way to the next one', async () => {
    // A pending handed back by a failed write stays in the ref across the scope
    // change. The next flush boundary is the cleanup on the way out, and it has
    // to carry the *old* pupil - the one whose box is no longer on screen - not
    // whatever the new box holds.
    vi.useFakeTimers();
    silenceSaveError();
    vi.mocked(saveEvaluationComment)
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue(undefined);
    const anna = pupil(1, 'Anna Muster');
    const bernd = pupil(2, 'Bernd Berger');
    const { rerenderWith } = renderGrid({ pupils: [anna, bernd], selectedPupilIdProp: 1 });

    // Anna's text fails and is handed back for a retry.
    fireEvent.change(commentBox(), { target: { value: 'Annas neue Begründung' } });
    await act(async () => {
      fireEvent.blur(commentBox());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);

    // Moving on is a flush boundary, so the restored pending is retried on the
    // way out - against Anna, before anything about Bernd is known.
    rerenderWith({ selectedPupilIdProp: 2 });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(saveEvaluationComment).toHaveBeenCalledTimes(2);
    expect(saveEvaluationComment).toHaveBeenLastCalledWith(1, CLASS_ID, 'D', 'Annas neue Begründung');
  });

  it('does not let the previous scope\'s debounce timer flush the next scope early', async () => {
    // The stronger form of the case above. Asserting "still one call" only
    // catches a stale timer if something is pending when it fires: `flushComment`
    // nulls the ref, so with an empty ref a surviving timer is invisible.
    vi.useFakeTimers();
    const anna = pupil(1, 'Anna Muster');
    const bernd = pupil(2, 'Bernd Berger');
    const { rerenderWith } = renderGrid({ pupils: [anna, bernd], selectedPupilIdProp: 1 });

    fireEvent.change(commentBox(), { target: { value: 'Für Anna' } });
    rerenderWith({ selectedPupilIdProp: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);

    // Anna's timer was due at t=800. Bernd's is not due until t=1000.
    await vi.advanceTimersByTimeAsync(200);
    fireEvent.change(commentBox(), { target: { value: 'Für Bernd' } });
    await vi.advanceTimersByTimeAsync(600);

    // Still only Anna: a surviving timer would have flushed Bernd at t=800.
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(400);
    expect(saveEvaluationComment).toHaveBeenCalledTimes(2);
    expect(saveEvaluationComment).toHaveBeenLastCalledWith(2, CLASS_ID, 'D', 'Für Bernd');
  });

  it('keeps a comment typed for the previous pupil when the next one is typed into', async () => {
    // A scope switch without a blur must not let the new keystroke overwrite the
    // pending comment for the pupil that just went off screen.
    vi.useFakeTimers();
    const anna = pupil(1, 'Anna Muster');
    const bernd = pupil(2, 'Bernd Berger');
    const { rerenderWith } = renderGrid({ pupils: [anna, bernd], selectedPupilIdProp: 1 });

    fireEvent.change(commentBox(), { target: { value: 'Für Anna' } });
    rerenderWith({ selectedPupilIdProp: 2 });
    await vi.advanceTimersByTimeAsync(0);

    fireEvent.change(commentBox(), { target: { value: 'Für Bernd' } });
    await vi.advanceTimersByTimeAsync(800);

    expect(saveEvaluationComment).toHaveBeenCalledTimes(2);
    expect(saveEvaluationComment).toHaveBeenNthCalledWith(1, 1, CLASS_ID, 'D', 'Für Anna');
    expect(saveEvaluationComment).toHaveBeenNthCalledWith(2, 2, CLASS_ID, 'D', 'Für Bernd');
  });

  it('does not let the previous pupil\'s write claim the next one\'s stored comment', async () => {
    // The write is still in flight when the teacher moves on, so it resolves *after*
    // the next pupil's box has been re-seeded. Assigning `lastStoredCommentRef` from
    // that write left the new pupil looking like he had a stored justification, and
    // emptying his box then wrote a deletion aimed at the previous pupil's text.
    vi.useFakeTimers();
    let resolveSave: () => void = () => {};
    vi.mocked(saveEvaluationComment).mockImplementation(
      () => new Promise<void>((resolve) => { resolveSave = resolve; }),
    );
    const anna = pupil(1, 'Anna Muster');
    const bernd = pupil(2, 'Bernd Berger');
    const { rerenderWith } = renderGrid({ pupils: [anna, bernd], selectedPupilIdProp: 1 });

    await act(async () => {
      fireEvent.change(commentBox(), { target: { value: 'Für Anna' } });
      fireEvent.blur(commentBox());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);

    // Move on while that write is still open.
    rerenderWith({ selectedPupilIdProp: 2 });
    expect(commentBox()).toHaveValue('');
    await act(async () => { resolveSave(); });

    // Bernd has nothing stored. Typing and clearing his box is not a deletion - and
    // the keystrokes make this a real flush boundary rather than a change event that
    // carries a value the textarea already had.
    fireEvent.change(commentBox(), { target: { value: 'x' } });
    fireEvent.change(commentBox(), { target: { value: '' } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    // Still only Anna: Bernd's box was never backed by a stored justification.
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenLastCalledWith(1, CLASS_ID, 'D', 'Für Anna');
  });

  it('debounces keystrokes into a single write after 800ms', async () => {
    // fireEvent rather than userEvent: `user.type` awaits a real delay between
    // keystrokes, which hangs under fake timers for reasons unrelated to what
    // this test is about.
    vi.useFakeTimers();
    renderGrid();

    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    expect(saveEvaluationComment).not.toHaveBeenCalled();

    // Not yet - one millisecond short of the debounce window.
    await vi.advanceTimersByTimeAsync(799);
    expect(saveEvaluationComment).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
  });

  it('restarts the debounce window on every keystroke', async () => {
    // The assertion the single-change case above cannot make: with one
    // `fireEvent.change` the timer-reset in `scheduleCommentFlush` is never
    // exercised, so deleting `clearCommentTimer()` there leaves the file green.
    vi.useFakeTimers();
    renderGrid();

    fireEvent.change(commentBox(), { target: { value: 'Sehr' } });
    await vi.advanceTimersByTimeAsync(400);
    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });

    // t=800: the first keystroke's timer was due now. A window that was not
    // restarted writes here, 400ms after the text stopped changing.
    await vi.advanceTimersByTimeAsync(450);
    expect(saveEvaluationComment).not.toHaveBeenCalled();

    // One millisecond short of the restarted window, which ends at t=1200.
    await vi.advanceTimersByTimeAsync(349);
    expect(saveEvaluationComment).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
  });

  it('issues no write for a blur that has nothing pending', async () => {
    const user = userEvent.setup();
    renderGrid();

    // Focus the box without typing it, then leave it again: a flush boundary
    // with nothing to write must stay silent. (`user.tab()` with nothing
    // focused moves focus to the first tabbable element and fires no blur at
    // all, which is why the box has to be focused here.)
    await user.click(commentBox());
    await user.tab();

    expect(saveEvaluationComment).not.toHaveBeenCalled();
  });

  it('does not write an empty or whitespace-only comment', async () => {
    const user = userEvent.setup();
    renderGrid();

    // Whitespace only.
    await user.type(commentBox(), '   ');
    await user.tab();
    expect(saveEvaluationComment).not.toHaveBeenCalled();
  });

  it('does not replace a stored justification with whitespace', async () => {
    // Whitespace is not a justification, so it is neither a write nor a deletion.
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { comment: 'Sehr motiviert' })]);
    const user = userEvent.setup();
    renderGrid({ pupils: [anna] });

    await user.clear(commentBox());
    await user.type(commentBox(), '   ');
    await user.tab();

    expect(saveEvaluationComment).not.toHaveBeenCalled();
    expect(commentBox()).toHaveValue('   ');
  });

  it('deletes a stored justification when the teacher empties the box', async () => {
    // Deletion is the one write an empty box may cause, and it needs a stored
    // justification to delete: the screen and the KEL/PDF report must not be
    // allowed to diverge silently.
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { comment: 'Sehr motiviert' })]);
    const user = userEvent.setup();
    renderGrid({ pupils: [anna] });

    expect(commentBox()).toHaveValue('Sehr motiviert');

    await user.clear(commentBox());
    await user.tab();

    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', '');
  });

  it('never deletes on a keystroke, only at a flush boundary', async () => {
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { comment: 'Sehr motiviert' })]);
    vi.useFakeTimers();
    renderGrid({ pupils: [anna] });

    fireEvent.change(commentBox(), { target: { value: '' } });
    await vi.advanceTimersByTimeAsync(799);
    expect(saveEvaluationComment).not.toHaveBeenCalled();

    // Debounce expiry is a flush boundary: the deletion lands here.
    await vi.advanceTimersByTimeAsync(1);
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', '');
  });

  it('writes no deletion when the teacher empties a box with nothing stored', async () => {
    // The other half of the rule: an empty box is a deletion only over something
    // stored. Ctrl+A + Delete on an already empty justification must be a no-op.
    const user = userEvent.setup();
    renderGrid();

    await user.click(commentBox());
    await user.clear(commentBox());
    await user.tab();

    expect(saveEvaluationComment).not.toHaveBeenCalled();
  });

  it('deletes a justification a sibling subject holds in Gesamt mode', async () => {
    // The box displays one subject, the write lands on every subject in scope.
    // Seeding the stored-comment knowledge from the displayed evaluation alone
    // made the whole scope look empty whenever the displayed subject held
    // nothing - and the deletion was then silently dropped for the subject that
    // did hold the justification.
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { comment: null }),
      evaluation('M', { comment: 'Nur in Mathematik hinterlegt' }),
    ]);
    const user = userEvent.setup();
    renderGrid({ pupils: [anna], mySubjects: [GERMAN, MATHS] });

    expect(commentBox()).toHaveValue('');

    // Type and clear: the emptied box is the intent, the blur is the boundary.
    await user.type(commentBox(), 'x');
    await user.clear(commentBox());
    await user.tab();

    expect(saveEvaluationComment).toHaveBeenCalledTimes(2);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', '');
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'M', '');
  });

  it('writes the retyped text when a clear is undone inside the debounce window', async () => {
    // Clear-then-retype is unambiguous: the pending always carries what the box
    // holds at the flush boundary, and a non-empty value drops the clear.
    vi.useFakeTimers();
    renderGrid();

    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    fireEvent.change(commentBox(), { target: { value: '' } });
    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    await vi.advanceTimersByTimeAsync(800);

    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
  });

  it('issues no write when a typed comment is cleared inside the debounce window', async () => {
    // Finding: "type, select all, delete, tab away" used to leave the server on
    // whatever it had while the box showed nothing. With nothing stored there is
    // nothing to delete, so the correct outcome is silence - and screen and
    // server agree, because both hold no comment.
    vi.useFakeTimers();
    renderGrid();

    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    fireEvent.change(commentBox(), { target: { value: '' } });
    await vi.advanceTimersByTimeAsync(800);

    expect(saveEvaluationComment).not.toHaveBeenCalled();
    expect(commentBox()).toHaveValue('');
  });

  it('retries a failed comment write the next time the box is left', async () => {
    // "Bitte erneut versuchen" is only followable if the pending survives the
    // failure: the teacher's next blur is the retry.
    silenceSaveError();
    vi.mocked(saveEvaluationComment)
      .mockRejectedValueOnce(new Error('500'))
      .mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderGrid();

    await user.type(commentBox(), 'Sehr motiviert');
    await user.tab();
    expect(await screen.findByText(/Kommentar konnte nicht gespeichert werden/)).toBeInTheDocument();
    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);

    // Focus the box again and leave it: the pending is still there.
    await user.click(commentBox());
    await user.tab();

    expect(saveEvaluationComment).toHaveBeenCalledTimes(2);
    expect(saveEvaluationComment).toHaveBeenLastCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
    expect(await screen.findByText(/^Gesichert \(/)).toBeInTheDocument();
  });

  it('retries every subject when one Gesamt write fails', async () => {
    // A half-written comment is not a saved comment: D taking and M failing must
    // leave the whole pending intact, not just the part that did not land.
    silenceSaveError();
    vi.mocked(saveEvaluationComment).mockImplementation(async (_p, _c, subject) => {
      if (subject === 'M' && vi.mocked(saveEvaluationComment).mock.calls.length === 2) {
        throw new Error('500');
      }
    });
    const user = userEvent.setup();
    renderGrid({ mySubjects: [GERMAN, MATHS] });

    await user.type(commentBox(), 'Sehr motiviert');
    await user.tab();

    expect(await screen.findByText(/Kommentar konnte nicht gespeichert werden/)).toBeInTheDocument();
    expect(saveEvaluationComment).toHaveBeenCalledTimes(2);
    // No badge: the comment is only half on the server.
    expect(screen.queryByText(/^Gesichert \(/)).toBeNull();

    await user.click(commentBox());
    await user.tab();

    // Both subjects again - the one that succeeded is re-sent, not skipped.
    expect(saveEvaluationComment).toHaveBeenCalledTimes(4);
    expect(saveEvaluationComment).toHaveBeenNthCalledWith(3, 1, CLASS_ID, 'D', 'Sehr motiviert');
    expect(saveEvaluationComment).toHaveBeenNthCalledWith(4, 1, CLASS_ID, 'M', 'Sehr motiviert');
    expect(await screen.findByText(/^Gesichert \(/)).toBeInTheDocument();
  });

  it('schedules no badge timer for a write that resolves after unmount', async () => {
    // The unmount flush issues the write and the tree is gone before it
    // resolves, so `markSaved` runs against a component that no longer exists.
    // React 19 swallows the resulting `setState` silently, so the observable
    // half of the `isMountedRef` guard is the 350ms badge timer it would
    // otherwise schedule: a timer that outlives the component and fires into
    // nothing. Asserted on the timer count, because a console-warning
    // assertion here passes with the guard removed as well.
    vi.useFakeTimers();
    let resolveSave: () => void = () => {};
    vi.mocked(saveEvaluationComment).mockImplementation(
      () => new Promise<void>((resolve) => { resolveSave = resolve; }),
    );
    const { unmount } = renderGrid();

    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    unmount();

    // The write resolves with nothing left to render into.
    await act(async () => {
      resolveSave();
    });

    // Debounce timer cancelled by the flush, badge timer never scheduled.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes a pending comment when the grid unmounts', async () => {
    // There is no blur and no debounce expiry when the page goes away. This is
    // the only thing that saves the text on unmount - deleting the flush effect
    // as "redundant" would drop it.
    //
    // The assertion is made *before* any timer advance, and that is the whole
    // point: nothing cancels the debounce timer on unmount, so advancing the
    // clock here would let the timer fire the very write this test claims only
    // the cleanup performs. Advancing 800ms and asserting "one write" passes
    // with the effect deleted.
    vi.useFakeTimers();
    const { unmount } = renderGrid();

    fireEvent.change(commentBox(), { target: { value: 'Sehr motiviert' } });
    expect(saveEvaluationComment).not.toHaveBeenCalled();

    // No timer advance: the write has to be issued by the unmount cleanup.
    await act(async () => {
      unmount();
    });

    expect(saveEvaluationComment).toHaveBeenCalledTimes(1);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
  });

  it('writes one comment per subject in scope in Gesamt mode', async () => {
    const user = userEvent.setup();
    renderGrid({ mySubjects: [GERMAN, MATHS] });

    await user.type(commentBox(), 'Sehr motiviert');
    await user.tab();

    // `__ALL__` is not a subject the server can store this under.
    expect(saveEvaluationComment).toHaveBeenCalledTimes(2);
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'D', 'Sehr motiviert');
    expect(saveEvaluationComment).toHaveBeenCalledWith(1, CLASS_ID, 'M', 'Sehr motiviert');
  });
});

describe('write permission from the server class response', () => {
  it('disables rating and submission controls for a read-only class', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    const onRate = vi.fn();
    renderGrid({ canRate: false, onRate });

    const ratingButton = screen.getByTitle('Gut (😊)');
    expect(ratingButton).toBeDisabled();
    fireEvent.click(ratingButton);
    expect(onRate).not.toHaveBeenCalled();

    expect(screen.getByRole('button', { name: /Ranking einreichen/ })).toBeDisabled();
  });

  it('does not grant an assignment-free KV subject rating controls from class visibility', () => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
    const onSubmitPupil = vi.fn().mockResolvedValue(undefined);
    renderGrid({ canRate: true, canAccessRaster: false, mySubjects: [], onSubmitPupil });

    expect(screen.getByRole('button', { name: /Meister/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ranking einreichen/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Ranking einreichen/ }));
    expect(onSubmitPupil).not.toHaveBeenCalled();
  });
});

describe('server-provided submission deadline', () => {
  it('disables ratings after the exact UTC cutoff supplied by the server', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:01.000Z'));
    renderGrid({ submissionDeadline: '2026-01-01T00:00:00.000Z' });

    expect(screen.getByTitle('Gut (😊)')).toBeDisabled();
  });
});

describe('subject-scoped soft locks', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(BEFORE_DEADLINE);
  });

  it('does not block Mathematik when the matching cell is locked only in Deutsch', () => {
    const softLocks = new Map([
      ['D|1|org_1', { pupilId: 1, itemKey: 'org_1', subjectCode: 'D', teacherName: 'Deutsch-Lehrkraft' }],
    ]);
    renderGrid({ mySubjects: [MATHS], softLocks });

    expect(screen.getByTitle('Gut (😊)')).not.toBeDisabled();
  });

  it('blocks the matching subject cell while its own lock is held', () => {
    const softLocks = new Map([
      ['M|1|org_1', { pupilId: 1, itemKey: 'org_1', subjectCode: 'M', teacherName: 'Mathematik-Lehrkraft' }],
    ]);
    renderGrid({ mySubjects: [MATHS], softLocks });

    expect(screen.getByTitle('Gut (😊)')).toBeDisabled();
  });
});

describe('Gesamt mode subject-scoped scoring and submission', () => {
  const EIGHTEEN_CRITERIA: RubricCriterion[] = Array.from({ length: 18 }, (_, i) => ({
    id: `crit_${i + 1}`,
    name: `Merkmal ${i + 1}`,
    position: i + 1,
    items: [{ key: `item_${i + 1}` }],
  }));

  it('shows independent D and M scores and submits independent ranks in Gesamt mode', async () => {
    const dItems = Array.from({ length: 18 }, (_, i) =>
      item(`item_${i + 1}`, i < 6 ? 'smile' : 'struggle', 1)
    );
    const mItems = Array.from({ length: 18 }, (_, i) =>
      item(`item_${i + 1}`, i < 16 ? 'smile' : 'struggle', 1)
    );

    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: dItems }),
      evaluation('M', { items: mItems }),
    ]);

    const onSubmitPupil = vi.fn().mockResolvedValue(undefined);

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN, MATHS],
      criteria: EIGHTEEN_CRITERIA,
      onSubmitPupil,
    });

    // In Gesamt mode, both D (Lehrling) and M (Meister) chips must be visible
    expect(screen.getByText(/D:.*Lehrling/i)).toBeInTheDocument();
    expect(screen.getByText(/M:.*Meister/i)).toBeInTheDocument();
    // No merged 18/18 chip should exist
    expect(screen.queryByText(/Gesamt.*18\/18/i)).toBeNull();

    // Click submit
    const submitBtn = screen.getByRole('button', { name: /Ranking einreichen/i });
    fireEvent.click(submitBtn);

    await vi.waitFor(() => {
      expect(onSubmitPupil).toHaveBeenCalledWith(1, 'Lehrling', expect.any(String), 'D');
      expect(onSubmitPupil).toHaveBeenCalledWith(1, 'Meister', expect.any(String), 'M');
    });
  });

  it('shows each subject only once in the Offen/Bewertet list and omits rubric totals from rank labels', () => {
    const meisterItems = Array.from({ length: 18 }, (_, i) =>
      item(`item_${i + 1}`, i < 16 ? 'smile' : 'struggle', 1)
    );
    const lehrlingItems = Array.from({ length: 18 }, (_, i) =>
      item(`item_${i + 1}`, i < 6 ? 'smile' : 'struggle', 1)
    );
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: meisterItems }),
      evaluation('M', { items: lehrlingItems }),
    ]);

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN, MATHS],
      criteria: EIGHTEEN_CRITERIA,
    });

    const roster = within(rosterRow('Anna Muster'));
    expect(roster.getByText('Anna Muster')).toBeInTheDocument();
    expect(rosterRow('Anna Muster')).toHaveTextContent(/^Anna Muster$/);
    expect(roster.queryByText(/(?:D|M)\s+(?:Meister|Lehrling|Ausstehend)/)).toBeNull();
    expect(roster.queryByText(/\d+\/18 Punkte/)).toBeNull();

    expect(screen.getByText('D: Meister')).toBeInTheDocument();
    expect(screen.getByText('M: Lehrling')).toBeInTheDocument();
    expect(screen.getByText('Gilt für alle Fächer: Deutsch · Mathematik')).toBeInTheDocument();
    expect(screen.queryByText('D: Meister (16/18)')).toBeNull();
    expect(screen.queryByText('M: Lehrling (6/18)')).toBeNull();
  });

  it('shows Ausstehend instead of Lehrling for an unrated subject', () => {
    // scoreSubject returns rank: null for an evaluation with no rated items.
    // The grid must render that as pending, not as the lowest rank: "M:
    // Lehrling (0/18)" states a grade the system explicitly refuses to
    // calculate, on the surface teachers stare at all day.
    const dItems = Array.from({ length: 18 }, (_, i) =>
      item(`item_${i + 1}`, i < 6 ? 'smile' : 'struggle', 1)
    );
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { items: dItems })]);

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN, MATHS],
      criteria: EIGHTEEN_CRITERIA,
    });

    // The detail header still identifies the pending subject; the compact
    // Offen/Bewertet roster deliberately contains no subject/status chips.
    expect(screen.getByText(/M: Ausstehend/i)).toBeInTheDocument();
    expect(within(rosterRow('Anna Muster')).queryByText(/M\s+Ausstehend/i)).toBeNull();
    expect(screen.queryByText(/M:.*Lehrling/i)).toBeNull();
  });

  it('never submits a fabricated rank for an unrated subject', async () => {
    // Decision 0.1 (E13): an unrated subject must inherit the teacher's manual
    // proposal if one exists. Without a proposal there is nothing to write -
    // submitting 'Geselle' would store a proposedStatus nobody cast for that
    // subject, and the pupil would look decided in Mathe on the strength of a
    // Deutsch raster. So the unrated subject is simply not submitted and stays
    // open until a teacher rates it or proposes something for it.
    const dItems = Array.from({ length: 18 }, (_, i) =>
      item(`item_${i + 1}`, i < 6 ? 'smile' : 'struggle', 1)
    );
    const anna = pupil(1, 'Anna Muster', [evaluation('D', { items: dItems })]);
    const onSubmitPupil = vi.fn().mockResolvedValue(undefined);

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN, MATHS],
      criteria: EIGHTEEN_CRITERIA,
      onSubmitPupil,
    });

    fireEvent.click(screen.getByRole('button', { name: /Ranking einreichen/i }));

    await vi.waitFor(() => {
      expect(onSubmitPupil).toHaveBeenCalledWith(1, 'Lehrling', expect.any(String), 'D');
    });
    // Mathe is unrated and unproposed: no write at all, for any rank.
    expect(onSubmitPupil).toHaveBeenCalledTimes(1);
    expect(onSubmitPupil).not.toHaveBeenCalledWith(1, expect.any(String), expect.any(String), 'M');

    // D was submitted, but M was skipped. The UI must not claim the pupil (or
    // class) is complete or silently move on while a subject is still pending.
    await vi.waitFor(() => {
      const submitStatus = screen.getAllByRole('status')[0];
      expect(submitStatus).toHaveTextContent(/Teilweise eingereicht/i);
      expect(submitStatus).toHaveTextContent(/Mathematik \(M\)/i);
      expect(screen.queryByText(/Alle Schüler dieser Klasse sind jetzt bewertet/i)).toBeNull();
    });
  });

  it('shows which subjects a Gesamt quick-grade applies to', () => {
    const anna = pupil(1, 'Anna Muster', [evaluation('D'), evaluation('M')]);
    renderGrid({ pupils: [anna], mySubjects: [GERMAN, MATHS], criteria: EIGHTEEN_CRITERIA });

    expect(screen.getByText('Gilt für alle Fächer: Deutsch · Mathematik')).toBeInTheDocument();
  });

  it('writes a quick grade to every subject in Gesamt mode, then only to the open tab', async () => {
    // Gesamt mode writes one raster across every subject the teacher owns.
    // Leaving it by clicking a subject tab narrows the target silently: the
    // same click must touch that one subject and nothing else, or a
    // correction in Mathe quietly overwrites Deutsch too.
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: [] }),
      evaluation('M', { items: [] }),
    ]);
    const writtenSubjects: string[] = [];
    const onBatchUpdate = vi.fn(async (_id: number, _items: unknown, subCode: string) => {
      writtenSubjects.push(subCode);
    });

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN, MATHS],
      criteria: EIGHTEEN_CRITERIA,
      selectedPupilIdProp: 1,
      onBatchUpdate,
    });

    fireEvent.click(screen.getByRole('button', { name: /Lehrling.*Basis/i }));

    // Gesamt: one write per subject.
    await vi.waitFor(() => {
      expect(writtenSubjects).toEqual(['D', 'M']);
    });

    // Narrow to Mathe: the same click is Mathe-only from here on. The
    // "Gewählt" badge is set after the write loop settles, so waiting for it
    // keeps the assertion below from reading a half-finished loop.
    fireEvent.click(screen.getByRole('button', { name: /M \(Mathematik\)/ }));
    fireEvent.click(screen.getByRole('button', { name: /Meister.*Spitzenleistung/i }));

    await vi.waitFor(() => {
      expect(screen.getByRole('button', { name: /Meister.*Spitzenleistung/i }).className)
        .toContain('ring-amber-400/50');
    });
    expect(writtenSubjects).toEqual(['D', 'M', 'M']);
  });

  it('lets an unrated subject inherit an explicit manual proposal', async () => {    // The other half of Decision 0.1: when the teacher HAS proposed a rank,
    // the unrated subject carries it. That is a decision a human made, as
    // opposed to a value the fallback invented. Note the raster still wins for
    // the subject it actually rated - the proposal only fills the gap.
    const dItems = Array.from({ length: 18 }, (_, i) =>
      item(`item_${i + 1}`, i < 6 ? 'smile' : 'struggle', 1)
    );
    const anna = pupil(1, 'Anna Muster', [
      evaluation('D', { items: dItems, proposedStatus: 'Meister' }),
    ]);
    const onSubmitPupil = vi.fn().mockResolvedValue(undefined);

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN, MATHS],
      criteria: EIGHTEEN_CRITERIA,
      onSubmitPupil,
    });

    fireEvent.click(screen.getByRole('button', { name: /Ranking einreichen/i }));

    await vi.waitFor(() => {
      // D keeps its own calculated rank; the proposal does not override a
      // subject that was actually rated.
      expect(onSubmitPupil).toHaveBeenCalledWith(1, 'Lehrling', expect.any(String), 'D');
      // Unrated M inherits the explicit proposal instead of a fabrication.
      expect(onSubmitPupil).toHaveBeenCalledWith(1, 'Meister', expect.any(String), 'M');
    });
  });

  describe('Class conference lock UI enforcement (Task 9)', () => {
    it('disables rating buttons, comment textarea, and submit button when locked', () => {
      const anna = pupil(1, 'Anna Muster', [evaluation('D')]);
      renderGrid({
        pupils: [anna],
        mySubjects: [GERMAN],
        isLockedByConference: true,
      });

      // Comment textarea is disabled
      const textarea = screen.getByPlaceholderText(/Zeigt im Unterricht hohe Motivation/i);
      expect(textarea).toBeDisabled();

      // Rating buttons are disabled
      const smileBtn = screen.getByTitle('Gut (😊)');
      expect(smileBtn).toBeDisabled();

      // Submit button is disabled
      const submitBtn = screen.getByRole('button', { name: /Ranking einreichen/i });
      expect(submitBtn).toBeDisabled();
    });

    it('hides reopen button when locked', () => {
      const onReopenPupil = vi.fn();
      const annaSubmitted = pupil(1, 'Anna Muster', [
        evaluation('D', { isSubmitted: true, submittedAt: '2026-10-08T10:00:00.000Z' }),
      ]);

      renderGrid({
        pupils: [annaSubmitted],
        mySubjects: [GERMAN],
        isLockedByConference: true,
        onReopenPupil,
      });

      // Reopen button should not be present when locked
      const reopenBtn = screen.queryByTitle(/Einreichung zurücknehmen/i);
      expect(reopenBtn).toBeNull();
    });

    it('prevents submit or comment save from executing when locked', async () => {
      const onSubmitPupil = vi.fn();
      const anna = pupil(1, 'Anna Muster', [evaluation('D')]);

      renderGrid({
        pupils: [anna],
        mySubjects: [GERMAN],
        isLockedByConference: true,
        onSubmitPupil,
      });

      const submitBtn = screen.getByRole('button', { name: /Ranking einreichen/i });
      fireEvent.click(submitBtn);

      expect(onSubmitPupil).not.toHaveBeenCalled();
      expect(saveEvaluationComment).not.toHaveBeenCalled();
    });

    it('leaves no "Gewählt" behind when a quick-grade write is rejected', async () => {
      // The rank badge used to be set optimistically before the write; a
      // rejection then left a selection the server never stored.
      const anna = pupil(1, 'Anna Muster', [evaluation('D')]);
      const onRate = vi.fn().mockRejectedValue(
        Object.assign(new Error('Bewertung wurde zwischenzeitlich geändert.'), {
          name: 'ApiError',
          status: 409,
          code: 'CONFLICT',
        }),
      );

      renderGrid({ pupils: [anna], mySubjects: [GERMAN], onRate });

      fireEvent.click(screen.getByRole('button', { name: /Meister/ }));

      await vi.waitFor(() => {
        expect(onRate).toHaveBeenCalled();
      });
      expect(screen.queryByText('Gewählt')).toBeNull();
    });
  });
});

describe('Quick-grade selection reflects the rank that will be submitted', () => {
  const EIGHTEEN_CRITERIA_QUICK: RubricCriterion[] = Array.from({ length: 18 }, (_, i) => ({
    id: `qcrit_${i + 1}`,
    name: `Quick-Merkmal ${i + 1}`,
    position: i + 1,
    items: [{ key: `qitem_${i + 1}` }],
  }));

  /** 16 of 18 rated positive: the raster itself computes Meister. */
  function meisterEval(proposedStatus: Evaluation['proposedStatus']): Evaluation {
    return evaluation('D', {
      proposedStatus,
      items: Array.from({ length: 18 }, (_, i) =>
        item(`qitem_${i + 1}`, i < 16 ? 'smile' : 'struggle', 1)
      ),
    });
  }

  function quickGradeButton(rank: 'Lehrling' | 'Geselle' | 'Meister'): HTMLElement {
    // The card carries the rank label and its description text, so the
    // accessible name is unique per rank.
    return screen.getByRole('button', {
      name: new RegExp(`${rank}.*(Basis|Regelstandard|Spitzenleistung)`, 'i'),
    });
  }

  it('selects only the manual proposal when the raster and the proposal disagree', () => {
    // The teacher hand-edited the raster to Meister (16 positives) but had
    // already proposed Lehrling. Two buttons lighting up tells the room two
    // things at once, and the one that actually gets submitted is the proposal.
    const anna = pupil(1, 'Anna Muster', [meisterEval('Lehrling')]);

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN],
      criteria: EIGHTEEN_CRITERIA_QUICK,
      selectedPupilIdProp: 1,
    });

    // Exactly one "Gewählt" badge, and it belongs to the manual proposal.
    expect(screen.getAllByText('Gewählt')).toHaveLength(1);
    expect(quickGradeButton('Lehrling').className).toContain('ring-rose-500/50');
    expect(quickGradeButton('Meister').className).not.toContain('ring-amber-400/50');
  });

  it('does not pre-select any quick-grade card when there is no manual proposal', () => {
    // When a teacher opens the view, no rank card should be pre-selected as "Gewählt"
    // before the teacher explicitly makes a proposal.
    const anna = pupil(1, 'Anna Muster', [meisterEval(null)]);

    renderGrid({
      pupils: [anna],
      mySubjects: [GERMAN],
      criteria: EIGHTEEN_CRITERIA_QUICK,
      selectedPupilIdProp: 1,
    });

    // Zero "Gewählt" badges, and none of the quick-grade cards have active ring styles.
    expect(screen.queryByText('Gewählt')).toBeNull();
    expect(quickGradeButton('Meister').className).not.toContain('ring-amber-400/50');
    expect(quickGradeButton('Geselle').className).not.toContain('ring-blue-500/50');
    expect(quickGradeButton('Lehrling').className).not.toContain('ring-rose-500/50');
  });

  it('keeps Gesamtbewertung when a detour through a single-subject class happens', async () => {
    const anna = pupil(1, 'Anna Muster');
    const { rerenderWith } = renderGrid({ pupils: [anna], mySubjects: [GERMAN, MATHS] });

    // Gesamt is the default for a multi-subject class.
    expect(screen.getByText('🌟 Gesamtbewertung')).toBeInTheDocument();

    // Detour through a class where the teacher has only one subject.
    rerenderWith({ mySubjects: [GERMAN] });
    expect(screen.queryByText('🌟 Gesamtbewertung')).toBeNull();

    // Back in the multi-subject class the Gesamtbewertung must be restored.
    rerenderWith({ mySubjects: [GERMAN, MATHS] });
    expect(screen.getByText('🌟 Gesamtbewertung')).toBeInTheDocument();
  });
});

