import { useCallback, useEffect, useRef } from 'react';
import { saveEvaluationComment } from '../../services/api';
import type { PupilWithData } from '../../types';
import type { useToast } from '../Toast';
import type { SaveFeedback } from './useSaveFeedback';

/** Debounce window for the conference comment autosave. */
const COMMENT_SAVE_DEBOUNCE_MS = 800;

interface CommentAutosaveOptions {
  selectedPupil: PupilWithData | undefined;
  targetSubjectCodes: string[];
  canWrite: boolean;
  isLockedByConference: boolean;
  setVotedComment: (value: string) => void;
  setSaveSuccessMsg: (value: string | null) => void;
  saveFeedback: SaveFeedback;
  toast: ReturnType<typeof useToast>;
}

export function useCommentAutosave({
  selectedPupil,
  targetSubjectCodes,
  canWrite,
  isLockedByConference,
  setVotedComment,
  setSaveSuccessMsg,
  saveFeedback,
  toast,
}: CommentAutosaveOptions) {
  const {
    pendingCommentRef,
    beginSave,
    markPendingComment,
    clearPendingCommentFeedback,
    finishSave,
  } = saveFeedback;

  // What the server holds for the scope on screen, as far as this tab knows.
  //
  // A deletion is only ever written over a justification that is actually
  // stored: emptying a box that has nothing stored must not turn into a write,
  // and the teacher's own keystrokes must never delete what they have not yet
  // managed to save. Seeded by the re-sync effect below, updated after every
  // successful write.
  const lastStoredCommentRef = useRef('');

  // --- Conference comment autosave ---
  //
  // The comment is the justification attached to the Notenkonferenz decision,
  // so it must reach the server, not just animate a badge. `onBlur` used to call
  // `markSaved()` alone: the teacher saw "Gesichert 14:22:07" and the text was
  // gone as soon as they selected the next pupil.
  //
  // The pending text lives in a ref, not state, because `handleCommentChange`
  // runs on every keystroke while the flush is a single deferred write - state
  // would race with it, and only one comment can be in flight at a time.
  const commentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * The scope currently on screen, readable from inside `flushComment`'s async
   * tail. `flushComment` is a `useCallback` that deliberately does not depend on
   * the scope, so it cannot close over the current one; the ref is the only way it
   * can tell "the write I just made still belongs to what is on screen" from "the
   * teacher has already moved on".
   */
  const commentScopeKeyRef = useRef('');

  /**
   * The conference lock state, readable at flush time. `flushComment` is a
   * `useCallback` that cannot list `isLockedByConference` as a dependency
   * without rebuilding on every lock flip - which would cancel the debounce a
   * keystroke just scheduled. The lock arrives over the socket *after* the
   * callback was created, so reading the prop inside the closure would keep
   * whatever value it had when the callback was memoized. The ref is written
   * on every render and therefore always current.
   */
  const isLockedByConferenceRef = useRef(isLockedByConference);
  isLockedByConferenceRef.current = isLockedByConference;

  /** Subjects a comment write may touch; Gesamt mode writes to each of them. */
  const commentSubjectCodes = targetSubjectCodes.filter((c) => c !== '__ALL__');

  /**
   * Identifies the pupil and subject set a pending comment belongs to. A
   * string, not `commentSubjectCodes`: that array is rebuilt on every render,
   * and the effect keyed on it would flush on every keystroke.
   */
  const commentScopeKey = selectedPupil
    ? `${selectedPupil.id}:${selectedPupil.classId}:${commentSubjectCodes.join(',')}`
    : '';

  const clearCommentTimer = useCallback(() => {
    if (commentTimerRef.current !== null) {
      clearTimeout(commentTimerRef.current);
      commentTimerRef.current = null;
    }
  }, []);

  /**
   * Persist whatever is pending, then let the badge follow the server's answer:
   * `markSaved()` only on success, an error toast otherwise. Safe to call when
   * nothing is pending - every caller (blur, debounce, scope change, unmount)
   * may fire after another already flushed.
   */
  const flushComment = useCallback(async () => {
    clearCommentTimer();
    if (!canWrite || isLockedByConferenceRef.current) {
      pendingCommentRef.current = null;
      clearPendingCommentFeedback();
      return;
    }
    const pending = pendingCommentRef.current;
    if (!pending) return;
    // Claim it before the first `await`: a keystroke or a second caller can
    // then start a fresh pending while this write is in flight, and the failure
    // path below only restores this one if nobody else took the slot.
    pendingCommentRef.current = null;

    if (pending.comment.trim() === '') {
      // Whitespace is not a justification: overwriting a stored comment with it
      // loses data, and writing '' for it deletes a justification nobody asked
      // to delete. A genuinely empty box is the one exception, and only over a
      // justification the server actually holds - an empty box with nothing
      // stored issues no write at all.
      //
      // The ref still describes the pending's own scope here: React runs every
      // cleanup before any effect body, and a scope-change flush is itself a
      // cleanup, so the re-sync above has not re-seeded it yet.
      if (pending.comment !== '' || !pending.clearRequested) {
        clearPendingCommentFeedback();
        return;
      }
      if (lastStoredCommentRef.current.trim() === '') {
        clearPendingCommentFeedback();
        return;
      }
    }

    beginSave();
    try {
      for (const subjectCode of pending.subjectCodes) {
        await saveEvaluationComment(pending.pupilId, pending.classId, subjectCode, pending.comment);
      }
      // The pending is only settled once every subject write resolved. In Gesamt
      // mode a rejected subject leaves the comment half-written, and the retry
      // has to re-send all of them - re-sending a subject that already took is
      // an idempotent overwrite of the same text.
      //
      // Only update the stored-comment ref while this write's own scope is still on
      // screen. The write outlives the render that issued it: a blur on one pupil
      // followed by a click on the next resolves the write *after* the next pupil's
      // box has been re-seeded, and assigning unconditionally then left the new pupil
      // looking like he had a stored justification he never had - so emptying his box
      // became a deletion aimed at the previous pupil's text.
      if (pending.scopeKey === commentScopeKeyRef.current) {
        lastStoredCommentRef.current = pending.comment;
      }
      finishSave();
    } catch (err) {
      // "Bitte erneut versuchen" has to be followable: the teacher only has to
      // leave the box again. Skip the restore if a newer keystroke already
      // claimed the slot - that text is newer and must not be overwritten.
      // Nothing is rescheduled here on purpose: the restored pending is not a
      // pending *debounce*, it is waiting for a deliberate boundary, so it must
      // not start a retry timer of its own.
      if (pendingCommentRef.current === null) pendingCommentRef.current = pending;
      finishSave(err);
      console.error(err);
      // A structured server rejection (ApiError: carries a status and code)
      // is the honest message - a 423 CLASS_CONFERENCE_LOCKED tells the
      // teacher the class is locked. The retry hint can never succeed in that
      // state, so it only fits failures with no server-side answer.
      const rejection = err as { message?: string; status?: number } | null;
      const serverMessage =
        err instanceof Error && typeof rejection?.status === 'number' ? err.message : '';
      toast.error(serverMessage || 'Kommentar konnte nicht gespeichert werden. Bitte erneut versuchen.');
    }
  }, [beginSave, canWrite, clearCommentTimer, clearPendingCommentFeedback, finishSave, toast]);

  const scheduleCommentFlush = useCallback(() => {
    clearCommentTimer();
    commentTimerRef.current = setTimeout(() => {
      commentTimerRef.current = null;
      void flushComment();
    }, COMMENT_SAVE_DEBOUNCE_MS);
  }, [clearCommentTimer, flushComment]);

  // A teacher who types the justification and immediately clicks the next pupil
  // never gets a blur - the textarea is replaced. This cleanup runs before any
  // effect body, so it beats the re-sync in the grid that loads the next scope's
  // `votedComment`, and it reads the ref because state would already be mid-swap.
  // Keyed on the whole scope, not just the pupil: switching subject re-syncs the
  // box just as destructively, and it is this key alone that keeps the next
  // keystroke from overwriting a pending comment for the scope on its way out.
  // Also the only flush on unmount.
  //
  // `flushComment` is deliberately not a dependency: it is rebuilt whenever the
  // toast object changes, and a cleanup that runs mid-keystroke would cancel the
  // debounce the keystroke just scheduled.
  useEffect(() => {
    // React runs every cleanup before any effect body, so this records the *new*
    // scope only after the outgoing one has been flushed. An in-flight write from
    // the outgoing scope therefore sees a mismatch by the time it resolves.
    commentScopeKeyRef.current = commentScopeKey;
    return () => {
      void flushComment();
    };
  }, [commentScopeKey]);

  const handleCommentChange = (value: string) => {
    if (!canWrite || isLockedByConference) return;
    setVotedComment(value);
    setSaveSuccessMsg(null);

    if (!selectedPupil) {
      pendingCommentRef.current = null;
      clearCommentTimer();
      clearPendingCommentFeedback();
      return;
    }

    const scope = {
      pupilId: selectedPupil.id,
      classId: selectedPupil.classId,
      // Gesamt mode writes to each subject in scope; `__ALL__` is not a
      // subject the server could store the comment under.
      subjectCodes: commentSubjectCodes,
      // Captured, not looked up later: `flushComment` resolves long after this
      // render, and the ref it consults then describes a different pupil.
      scopeKey: commentScopeKey,
    };
    // The pending mirrors what the box holds, and the box decides what that
    // means: a justification to write, a deletion to write, or nothing at all.
    // Only the first case becomes new text - a clear never overwrites what has
    // not reached the server yet, it is carried as an explicit intent that a
    // later retyping simply drops. What the deletion is *written over* is
    // decided in `flushComment`, which is where the server's copy is known.
    // The guard here only avoids scheduling a flush that provably cannot write.
    //
    // Keyed on the stored copy alone, never on the outgoing pending: a pending
    // restored by a failed write is still in this ref when the next scope's box
    // is touched, and letting it stand in for "something is stored" would
    // overwrite that unsaved text with a deletion aimed at the wrong pupil.
    const deletesStored = value === '' && lastStoredCommentRef.current.trim() !== '';
    pendingCommentRef.current =
      value.trim() !== ''
        ? { ...scope, comment: value, clearRequested: false }
        : deletesStored
          ? { ...scope, comment: '', clearRequested: true }
          : null;

    if (pendingCommentRef.current) {
      markPendingComment();
      scheduleCommentFlush();
    } else {
      clearCommentTimer();
      clearPendingCommentFeedback();
    }
  };

  return { lastStoredCommentRef, flushComment, handleCommentChange };
}
