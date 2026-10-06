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
  selectedPupilIdProp?: number | null;
}

/**
 * The grid calls `useToast()` and `useConfirm()`, and each hook throws outside
 * its provider (`Toast.tsx:107`, `ConfirmDialog.tsx:63`), so every render here
 * goes through both.
 */
function renderGrid({
  pupils = [pupil(1, 'Anna Muster')],
  mySubjects = [GERMAN],
  selectedPupilIdProp = null,
}: GridOptions = {}) {
  const props = {
    pupils,
    criteria: CRITERIA,
    softLocks: new Map(),
    conflict: null,
    onClearConflict: vi.fn(),
    onSendFocus: vi.fn(),
    onSendBlur: vi.fn(),
    onRate: vi.fn(),
    onOpenCardDrawer: vi.fn(),
    onOpenKelReport: vi.fn(),
    isLockedByConference: false,
    mySubjects,
    selectedPupilIdProp,
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
    rerenderWith(next: GridOptions) {
      view.rerender(
        <ToastProvider>
          <ConfirmProvider>
            <BeobachtungsGrid
              {...props}
              pupils={next.pupils ?? pupils}
              mySubjects={next.mySubjects ?? mySubjects}
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

/**
 * The roster's "Eingereicht" tick is a bare lucide icon with no accessible name
 * (`BeobachtungsGrid.tsx:693`) - it is the only child of the row that can be an
 * `<svg>`, so its presence is the assertion. The word "Eingereicht" itself is
 * asserted separately, from the header badge.
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
// These two cases pin `BeobachtungsGrid.tsx:676` (`isPupilFullySubmitted` in the
// roster) and the folder split above it. Reverting either to the unscoped
// `evaluations.some(e => e.isSubmitted)` makes them fail.

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
    expect(within(rosterRow('Anna Muster')).getByText('0/18 Punkte')).toBeInTheDocument();
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