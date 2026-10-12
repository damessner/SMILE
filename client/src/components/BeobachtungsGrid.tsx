import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Crown,
  ClipboardList,
  Award,
  AlertTriangle,
  FileText,
  Sparkles,
  Info,
  Check,
  AlertCircle,
  HelpCircle,
  RotateCcw,
  CheckCircle2,
  Folder,
  FolderCheck,
  Printer,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  X,
  BookOpen,
  Clock,
} from 'lucide-react';
import { PupilWithData, RubricCriterion, User } from '../types';
import {
  findItemForSubjects,
  isPupilFullySubmitted,
  isSubjectMatch,
  itemVersionForSubject,
  scoreSubject,
} from '../lib/pupilItems';
import { getRankVisuals } from '../lib/conferenceEvidence';
import { quickGradeFills } from '../lib/rubricConfig';
import { saveEvaluationComment } from '../services/api';
import { SoftLock, ConflictEvent } from '../hooks/useLiveSync';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';

/** Debounce window for the conference comment autosave. */
const COMMENT_SAVE_DEBOUNCE_MS = 800;

async function settleAllWrites(writes: Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(writes);
  const failedWrite = results.find(
    (result): result is PromiseRejectedResult => result.status === 'rejected',
  );
  if (failedWrite) throw failedWrite.reason;
}

interface BeobachtungsGridProps {
  pupils: PupilWithData[];
  criteria: RubricCriterion[];
  softLocks: Map<string, SoftLock>;
  conflict: ConflictEvent | null;
  onClearConflict: () => void;
  onSendFocus: (pupilId: number, itemKey: string, subjectCode: string) => void;
  onSendBlur: (pupilId: number, itemKey: string, subjectCode: string) => void;
  onRate: (
    pupilId: number,
    criterionId: string,
    itemKey: string,
    rating: string,
    expectedVersion: number,
    subjectCode: string
  ) => void | Promise<void>;
  onOpenCardDrawer: (pupilId: number, name: string) => void;
  onOpenKelReport: (pupil: PupilWithData) => void;
  isLockedByConference: boolean;
  canRate?: boolean;
  canAccessRaster?: boolean;
  submissionDeadline?: string | null;
  mySubjects?: Array<{ code: string; name: string; isCoreSmile: boolean; hours?: number }>;
  selectedPupilIdProp?: number | null;
  onSubmitPupil?: (pupilId: number, proposedStatus?: string, comment?: string, subjectCode?: string) => Promise<void>;
  onReopenPupil?: (pupilId: number, subjectCode?: string) => Promise<void>;
  onBatchUpdate?: (pupilId: number, items: Array<{ criterionId: string; itemKey: string; rating: string; version: number }>, subjectCode?: string) => Promise<void>;
  onOpenReportModal?: () => void;
}

/**
 * A conference comment waiting to be persisted, captured against the pupil and
 * subjects it was typed for - not against the pupil currently on screen.
 */
interface PendingComment {
  pupilId: number;
  classId: number;
  subjectCodes: string[];
  /**
   * The `commentScopeKey` this pending was typed under. The write outlives the
   * render that issued it, so this is what says whose ref a successful write may
   * update - see the `commentScopeKeyRef` guard in `flushComment`.
   */
  scopeKey: string;
  /** What the box holds right now. Empty only when `clearRequested` is set. */
  comment: string;
  /**
   * The teacher emptied the box. At a flush boundary this deletes the stored
   * justification; on a keystroke it does nothing, so a half-finished
   * Ctrl+A cannot wipe data the server still holds.
   */
  clearRequested: boolean;
}

export const BeobachtungsGrid: React.FC<BeobachtungsGridProps> = ({
  pupils,
  criteria,
  softLocks,
  conflict,
  onClearConflict,
  onSendFocus,
  onSendBlur,
  onRate,
  onOpenCardDrawer,
  onOpenKelReport,
  isLockedByConference,
  canRate = true,
  canAccessRaster = true,
  submissionDeadline = null,
  mySubjects = [],
  selectedPupilIdProp,
  onSubmitPupil,
  onReopenPupil,
  onBatchUpdate,
  onOpenReportModal,
}) => {
  const confirm = useConfirm();
  const toast = useToast();
  // Folder tabs: "offen" (unsubmitted) vs "bewertet" (submitted)
  const [folderTab, setFolderTab] = useState<'offen' | 'bewertet'>('offen');
  const [selectedPupilId, setSelectedPupilId] = useState<number | null>(
    selectedPupilIdProp || pupils[0]?.id || null
  );

  // Active subject for current teacher (with support for switching if teacher has multiple subjects, or '__ALL__' for unified batch rating)
  const [selectedSubjectCode, setSelectedSubjectCode] = useState<string>(
    mySubjects.length > 1 ? '__ALL__' : (mySubjects[0]?.code || 'D')
  );

  // Only a multi-subject class owns an explicit subject selection. A class where
  // the teacher has a single subject must not overwrite the stored choice —
  // otherwise a detour through such a class loses a Gesamtbewertung selection
  // made in a multi-subject class (reported 2026-10-12).
  useEffect(() => {
    if (mySubjects.length > 1) {
      if (selectedSubjectCode !== '__ALL__' && !mySubjects.some((s) => s.code === selectedSubjectCode)) {
        setSelectedSubjectCode('__ALL__');
      }
    }
  }, [mySubjects]);

  // Effective selection: with a single subject there is no choice to store, so the
  // subject is derived while the stored selection stays intact.
  const activeSubjectCode =
    mySubjects.length > 1 ? selectedSubjectCode : (mySubjects[0]?.code || 'D');

  const isAllSubjectsMode = mySubjects.length > 1 && activeSubjectCode === '__ALL__';
  const primarySubject = mySubjects[0] || { code: 'D', name: 'Fach', isCoreSmile: true };
  const mySubject = isAllSubjectsMode
    ? {
        code: '__ALL__',
        name: `Gesamt (${mySubjects.map((s) => s.code).join(' + ')})`,
        isCoreSmile: mySubjects.some((s) => s.isCoreSmile),
      }
    : (mySubjects.find((s) => s.code === activeSubjectCode) || primarySubject);

  const mySubjectCode = mySubject.code;
  const isSubjectCore = mySubjects.length > 0 ? mySubject.isCoreSmile : canAccessRaster;
  const effectiveCanAccessRaster = isSubjectCore;
  // A class may be visible to a KV who has no teaching assignment. Class-level
  // visibility alone does not grant a subject write; administrators/headteachers
  // receive `canAccessRaster` from the server and retain their explicit exception.
  const canWrite = canRate && (mySubjects.length > 0 || canAccessRaster);

  const [showDetailedRaster, setShowDetailedRaster] = useState<boolean>(() => {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test') {
      return true;
    }
    return false;
  });
  const [votedRank, setVotedRank] = useState<'Lehrling' | 'Geselle' | 'Meister' | null>(null);
  const [votedComment, setVotedComment] = useState<string>('');
  const [isSavingVote, setIsSavingVote] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);
  const pendingCommentRef = useRef<PendingComment | null>(null);

  // Autosave and feedback state
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  const [ratingSaveError, setRatingSaveError] = useState<string | null>(null);
  const pendingSaveCountRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const saveFailedRef = useRef(false);
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submitToast, setSubmitToast] = useState<{
    pupilName: string;
    nextPupilName: string | null;
    allDone: boolean;
    pendingSubjects?: string[];
    submittedAny?: boolean;
  } | null>(null);

  // Weekly timetable lesson hours & conference voting weight
  const currentHoursInfo = React.useMemo(() => {
    if (!mySubjects || mySubjects.length === 0) return null;
    if (isAllSubjectsMode) {
      const totalHours = mySubjects.reduce((sum, s) => sum + (s.hours || 0), 0);
      const totalWeight = mySubjects.reduce(
        (sum, s) => sum + (s.hours || 0) * (s.isCoreSmile ? 2 : 1),
        0
      );
      if (totalHours === 0) return null;
      return {
        hours: totalHours,
        weight: totalWeight,
        isTeamTeaching: mySubjects.some((s) => s.isCoreSmile),
        label: 'Gesamt (alle deine Fächer)',
      };
    }
    const currentSub = mySubjects.find((s) => s.code === activeSubjectCode) || mySubjects[0];
    if (!currentSub || !currentSub.hours) return null;
    return {
      hours: currentSub.hours,
      weight: currentSub.hours * (currentSub.isCoreSmile ? 2 : 1),
      isTeamTeaching: currentSub.isCoreSmile,
      label: currentSub.name,
    };
  }, [mySubjects, isAllSubjectsMode, activeSubjectCode]);

  // Target subjects for write operations (all subjects in Gesamt mode, or the selected individual subject)
  const targetSubjectCodes = isAllSubjectsMode
    ? mySubjects.map((s) => s.code)
    : [mySubjectCode];

  // Divide pupils into open and submitted for the currently active subject
  const isPupilSubmittedForSubject = (p: PupilWithData) => {
    if (isAllSubjectsMode) {
      return mySubjects.length > 0 && mySubjects.every((s) =>
        p.evaluations.some((e) => isSubjectMatch(e.subjectCode, s.code) && e.isSubmitted)
      );
    }
    return p.evaluations.some((e) => isSubjectMatch(e.subjectCode, mySubjectCode) && e.isSubmitted);
  };

  const openPupils = pupils.filter((p) => !isPupilSubmittedForSubject(p));
  const submittedPupils = pupils.filter((p) => isPupilSubmittedForSubject(p));

  useEffect(() => {
    if (selectedPupilIdProp) {
      setSelectedPupilId(selectedPupilIdProp);
      const isSub = pupils
        .find((p) => p.id === selectedPupilIdProp)
        ?.evaluations.some((e) => isSubjectMatch(e.subjectCode, mySubjectCode) && e.isSubmitted);
      if (isSub) {
        setFolderTab('bewertet');
      } else {
        setFolderTab('offen');
      }
    }
  }, [selectedPupilIdProp, mySubjectCode]);

  // Ensure selectedPupilId is valid in the current tab if possible
  const currentList = folderTab === 'offen' ? openPupils : submittedPupils;
  const selectedPupil =
    pupils.find((p) => p.id === selectedPupilId) ||
    currentList[0] ||
    pupils[0];

  // Auto-switch to submitted tab if no open pupils remain
  useEffect(() => {
    if (openPupils.length === 0 && submittedPupils.length > 0 && folderTab === 'offen') {
      setFolderTab('bewertet');
      if (!selectedPupilId) {
        setSelectedPupilId(submittedPupils[0].id);
      }
    }
  }, [openPupils.length, submittedPupils.length]);

  // What the server holds for the scope on screen, as far as this tab knows.
  //
  // A deletion is only ever written over a justification that is actually
  // stored: emptying a box that has nothing stored must not turn into a write,
  // and the teacher's own keystrokes must never delete what they have not yet
  // managed to save. Seeded by the re-sync effect below, updated after every
  // successful write.
  const lastStoredCommentRef = useRef('');

  // Sync votedRank and comment whenever selected pupil changes
  useEffect(() => {
    if (selectedPupil) {
      const lookupCode = isAllSubjectsMode ? primarySubject.code : mySubjectCode;
      const existing = selectedPupil.evaluations.find((e) => isSubjectMatch(e.subjectCode, lookupCode));
      setVotedRank((existing?.proposedStatus as any) || null);
      setVotedComment(existing?.comment || '');
      // A write lands on every subject in scope, so the box can be backed by any
      // of them - not only by the one it happens to display. Reading `existing`
      // alone made the scope look empty whenever the displayed subject held
      // nothing, and emptying the box then silently dropped the justification
      // that a sibling subject still had.
      //
      // `targetSubjectCodes` is deliberately not a dependency: it is a fresh
      // array every render, and the effect would re-seed on every keystroke.
      lastStoredCommentRef.current =
        existing?.comment ||
        selectedPupil.evaluations.find(
          (e) => targetSubjectCodes.includes(e.subjectCode) && !!e.comment,
        )?.comment ||
        '';
      setSaveSuccessMsg(null);
    }
  }, [selectedPupil?.id, mySubjectCode, isAllSubjectsMode, primarySubject.code]);

  // Deadline: 30.10.2026 23:59:59
  const deadlineAt = submissionDeadline === null ? Number.NaN : new Date(submissionDeadline).getTime();
  const isPastDeadline = !Number.isFinite(deadlineAt) || Date.now() > deadlineAt;

  // Helper to extract rating and version for a specific item.
  // Scoped to the subjects in view: a pupil with no evaluation for the active
  // subject renders empty, and never another subject's ratings - which would
  // also be submitted as this subject's rank and sent with a foreign version.
  const getItemData = (pupil: PupilWithData, itemKey: string) =>
    findItemForSubjects(
      pupil.evaluations,
      isAllSubjectsMode ? mySubjects.map((s) => s.code) : [mySubjectCode],
      itemKey
    );

  const rubricItemKeys = React.useMemo(
    () => Array.from(new Set(criteria.flatMap((c) => c.items.map((i) => i.key)))),
    [criteria]
  );

  // Compute live rank strictly from the configured rubric items for the active/specified subject.
  // Rank colours come from the shared helper so the grid, the conference modal and the
  // export can never drift into three different triples for one rank.
  const calculateRank = (pupil: PupilWithData, subjectCode?: string) => {
    const targetCode = subjectCode || (isAllSubjectsMode ? primarySubject.code : mySubjectCode);
    const scored = scoreSubject(pupil.evaluations, targetCode, rubricItemKeys);
    const { badgeBg, barColor } = getRankVisuals(scored.rank);
    return { rank: scored.rank, color: badgeBg, barColor, pos: scored.positiveCount };
  };

  // A comment write can outlive the grid: the flush it belongs to is issued
  // moments before the tree goes away and resolves afterwards.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const cancelSavedFeedback = useCallback(() => {
    if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current);
    saveFeedbackTimerRef.current = null;
    saveGenerationRef.current++;
  }, []);

  const beginSave = useCallback(() => {
    cancelSavedFeedback();
    if (pendingSaveCountRef.current === 0 && pendingCommentRef.current === null) {
      saveFailedRef.current = false;
      if (isMountedRef.current) setRatingSaveError(null);
    }
    pendingSaveCountRef.current++;
    if (isMountedRef.current) {
      setIsSaving(true);
      setLastSavedTime(null);
    }
  }, [cancelSavedFeedback]);

  const markPendingComment = useCallback(() => {
    cancelSavedFeedback();
    if (pendingSaveCountRef.current === 0) {
      saveFailedRef.current = false;
      setRatingSaveError(null);
    }
    setIsSaving(true);
    setLastSavedTime(null);
  }, [cancelSavedFeedback]);

  const clearPendingCommentFeedback = useCallback(() => {
    cancelSavedFeedback();
    if (pendingSaveCountRef.current === 0) setIsSaving(false);
  }, [cancelSavedFeedback]);

  const markSaved = useCallback(() => {
    if (!isMountedRef.current) return;
    if (pendingSaveCountRef.current > 0 || pendingCommentRef.current !== null) {
      setIsSaving(true);
      return;
    }
    if (saveFailedRef.current) {
      setIsSaving(false);
      return;
    }

    cancelSavedFeedback();
    const generation = saveGenerationRef.current;
    setIsSaving(true);
    saveFeedbackTimerRef.current = setTimeout(() => {
      if (
        !isMountedRef.current ||
        generation !== saveGenerationRef.current ||
        pendingSaveCountRef.current > 0 ||
        pendingCommentRef.current !== null
      ) return;
      saveFeedbackTimerRef.current = null;
      setIsSaving(false);
      setLastSavedTime(new Date());
      setRatingSaveError(null);
    }, 350);
  }, []);

  const finishSave = useCallback((error?: unknown) => {
    pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
    if (error) {
      saveFailedRef.current = true;
      if (isMountedRef.current) {
        setRatingSaveError(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
      }
    }
    if (!isMountedRef.current) return;
    if (pendingSaveCountRef.current > 0) {
      setIsSaving(true);
      return;
    }
    if (saveFailedRef.current) {
      setIsSaving(false);
      setLastSavedTime(null);
      return;
    }
    markSaved();
  }, [markSaved]);

  const saveCellRating = async (
    pupil: PupilWithData,
    criterionId: string,
    itemKey: string,
    rating: string,
  ) => {
    if (!canWrite || isLockedByConference) return;
    beginSave();

    try {
      const writes = targetSubjectCodes.map((subjectCode) =>
        Promise.resolve(onRate(
          pupil.id,
          criterionId,
          itemKey,
          rating,
          itemVersionForSubject(pupil.evaluations, subjectCode, itemKey),
          subjectCode,
        )),
      );
      await settleAllWrites(writes);
      finishSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bewertung konnte nicht gespeichert werden.';
      finishSave(error);
      toast.error(message);
    }
  };

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
  // effect body, so it beats the re-sync above that loads the next scope's
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

  // Auto-dismiss submit toast after 4.5 seconds
  useEffect(() => {
    if (submitToast) {
      const timer = setTimeout(() => {
        setSubmitToast(null);
      }, 4500);
      return () => clearTimeout(timer);
    }
  }, [submitToast]);

  // Instant Rank Handlers
  const handleInstantRank = async (targetRank: 'Lehrling' | 'Geselle' | 'Meister') => {
    if (!canWrite || isLockedByConference || !selectedPupil) return;
    beginSave();

    const totalCells = criteria.reduce((n, crit) => n + crit.items.length, 0);
    // The fill pattern comes from the active thresholds, not fixed numbers, so
    // a one-click grade keeps producing the rank it was asked for after a
    // reconfiguration (see quickGradeFills).
    const fills = quickGradeFills(targetRank, totalCells);
    let fillIndex = 0;

    const allCritItems: Array<{ criterionId: string; itemKey: string; rating: string }> = [];
    for (const crit of criteria) {
      for (const it of crit.items) {
        allCritItems.push({ criterionId: crit.id, itemKey: it.key, rating: fills[fillIndex++] });
      }
    }

    try {
      for (const subCode of targetSubjectCodes) {
        if (onBatchUpdate) {
          const versionedItems = allCritItems.map((item) => ({
            ...item,
            version: itemVersionForSubject(selectedPupil.evaluations, subCode, item.itemKey),
          }));
          await onBatchUpdate(selectedPupil.id, versionedItems, subCode);
        } else {
          await settleAllWrites(allCritItems.map((it) =>
            Promise.resolve(onRate(
              selectedPupil.id,
              it.criterionId,
              it.itemKey,
              it.rating,
              itemVersionForSubject(selectedPupil.evaluations, subCode, it.itemKey),
              subCode,
            )),
          ));
        }
      }
      // Only after the server has taken the write: a rejected quick-grade must
      // not leave "Gewählt" showing a rank the server never stored.
      setVotedRank(targetRank);
      finishSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bewertung konnte nicht gespeichert werden.';
      finishSave(error);
      toast.error(message);
    }
  };

  // Unified 1-Click Quick Grade Handler (Core & Non-Core)
  const handleQuickGrade = async (targetRank: 'Lehrling' | 'Geselle' | 'Meister') => {
    if (!canWrite || !selectedPupil || isLockedByConference || isPastDeadline) return;
    if (effectiveCanAccessRaster) {
      // handleInstantRank sets the selection once its writes have resolved.
      await handleInstantRank(targetRank);
    } else {
      beginSave();
      try {
        for (const subCode of targetSubjectCodes) {
          if (onSubmitPupil) {
            await onSubmitPupil(
              selectedPupil.id,
              targetRank,
              votedComment.trim() || undefined,
              subCode
            );
          }
        }
        setVotedRank(targetRank);
        finishSave();
        setSaveSuccessMsg(`Rang „${targetRank}“ gespeichert`);
      } catch (err) {
        finishSave(err);
        toast.error('Rang konnte nicht gespeichert werden');
      }
    }
  };

  // Reset all 18 criteria for pupil
  const handleResetAll = async () => {
    if (!canWrite || isLockedByConference || !selectedPupil) return;
    const ok = await confirm({
      title: 'Alle Bewertungen leeren?',
      message: isAllSubjectsMode
        ? `Alle 18 Merkmale für ${selectedPupil.fullName} werden in ALLEN deinen Fächern (${mySubjects.map((s) => s.code).join(', ')}) zurückgesetzt.`
        : `Alle 18 Merkmale für ${selectedPupil.fullName} in ${mySubject.name} werden zurückgesetzt.`,
      confirmLabel: 'Zurücksetzen',
      tone: 'danger',
    });
    if (!ok) return;

    setVotedRank(null);
    beginSave();
    const allCritItems: Array<{ criterionId: string; itemKey: string; rating: string }> = [];
    for (const crit of criteria) {
      for (const it of crit.items) {
        allCritItems.push({ criterionId: crit.id, itemKey: it.key, rating: '' });
      }
    }

    try {
      for (const subCode of targetSubjectCodes) {
        if (onBatchUpdate) {
          const versionedItems = allCritItems.map((item) => ({
            ...item,
            version: itemVersionForSubject(selectedPupil.evaluations, subCode, item.itemKey),
          }));
          await onBatchUpdate(selectedPupil.id, versionedItems, subCode);
        } else {
          await settleAllWrites(allCritItems.map((it) =>
            Promise.resolve(onRate(
              selectedPupil.id,
              it.criterionId,
              it.itemKey,
              '',
              itemVersionForSubject(selectedPupil.evaluations, subCode, it.itemKey),
              subCode,
            )),
          ));
        }
      }
      finishSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bewertungen konnten nicht geleert werden.';
      finishSave(error);
      toast.error(message);
    }
  };

  // Quick fill entire category (3 items)
  const handleQuickFillCategory = async (crit: RubricCriterion, rating: string) => {
    if (!canWrite || isLockedByConference || !selectedPupil) return;
    beginSave();
    const catItems = crit.items.map((it) => ({
      criterionId: crit.id,
      itemKey: it.key,
      rating,
    }));

    try {
      for (const subCode of targetSubjectCodes) {
        if (onBatchUpdate) {
          const versionedItems = catItems.map((item) => ({
            ...item,
            version: itemVersionForSubject(selectedPupil.evaluations, subCode, item.itemKey),
          }));
          await onBatchUpdate(selectedPupil.id, versionedItems, subCode);
        } else {
          await settleAllWrites(catItems.map((it) =>
            Promise.resolve(onRate(
              selectedPupil.id,
              it.criterionId,
              it.itemKey,
              it.rating,
              itemVersionForSubject(selectedPupil.evaluations, subCode, it.itemKey),
              subCode,
            )),
          ));
        }
      }
      finishSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bewertung konnte nicht gespeichert werden.';
      finishSave(error);
      toast.error(message);
    }
  };

  // Submit Ranking & Advance sequentially to next pupil on list
  const handleSubmitPupil = async () => {
    if (!canWrite || isLockedByConference || !selectedPupil) return;

    // Find position in openPupils
    const currIdx = openPupils.findIndex((p) => p.id === selectedPupil.id);
    const pupilName = selectedPupil.fullName;

    beginSave();
    const pendingSubjects: string[] = [];
    let submittedAny = false;
    try {
      if (onSubmitPupil) {
        for (const subCode of targetSubjectCodes) {
          const scored = scoreSubject(selectedPupil.evaluations, subCode, rubricItemKeys);
          // A subject with no rated rubric items has no calculated rank, so it
          // must inherit the teacher's manual proposal. With neither there is
          // nothing to submit: writing 'Geselle' would store a proposedStatus
          // nobody cast for that subject, and the pupil would read as decided
          // in Mathe on the strength of a Deutsch raster. The subject is left
          // for the teacher, and it keeps the pupil out of the submitted list
          // (see `isSubmitted`, which requires every subject).
          const subRank = effectiveCanAccessRaster
            ? (scored.rank ?? votedRank)
            : (votedRank || scored.rank);
          if (!subRank) {
            pendingSubjects.push(subCode);
            continue;
          }
          await onSubmitPupil(selectedPupil.id, subRank, votedComment, subCode);
          submittedAny = true;
        }
      }
      finishSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Einreichung konnte nicht gespeichert werden.';
      finishSave(error);
      toast.error(message);
      return;
    }

    if (pendingSubjects.length > 0) {
      const subjectLabels = pendingSubjects.map((code) => {
        const subject = mySubjects.find((candidate) => candidate.code === code);
        return subject ? `${subject.name} (${code})` : code;
      });
      setSubmitToast({
        pupilName,
        nextPupilName: null,
        allDone: false,
        pendingSubjects: subjectLabels,
        submittedAny,
      });
      return;
    }

    // Advance to next sequential pupil in the open list
    const remainingOpen = openPupils.filter((p) => p.id !== selectedPupil.id);
    if (remainingOpen.length > 0) {
      const nextPupil = openPupils[currIdx + 1] || remainingOpen[0];
      setSelectedPupilId(nextPupil.id);
      setSubmitToast({
        pupilName,
        nextPupilName: nextPupil.fullName,
        allDone: false,
      });
    } else {
      setFolderTab('bewertet');
      setSelectedPupilId(selectedPupil.id);
      setSubmitToast({
        pupilName,
        nextPupilName: null,
        allDone: true,
      });
    }
  };

  const handleReopenPupil = async () => {
    if (!canWrite || isLockedByConference || !onReopenPupil || !selectedPupil) return;
    beginSave();
    try {
      for (const subCode of targetSubjectCodes) {
        await onReopenPupil(selectedPupil.id, subCode);
      }
      finishSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bewertung konnte nicht wieder geöffnet werden.';
      finishSave(error);
      toast.error(message);
    }
  };

  if (!selectedPupil) {
    return (
      <div className="p-8 text-center text-slate-500">
        Keine Schüler in dieser Klasse vorhanden.
      </div>
    );
  }

  const { rank, color: rankColor, pos: positiveTicks } = calculateRank(selectedPupil);
  const myEval = selectedPupil.evaluations.find((e) => isSubjectMatch(e.subjectCode, mySubjectCode));
  const isSubmitted = isAllSubjectsMode
    ? mySubjects.length > 0 && mySubjects.every((s) => selectedPupil.evaluations.some((e) => isSubjectMatch(e.subjectCode, s.code) && e.isSubmitted))
    : Boolean(myEval?.isSubmitted);
  const submittedAt = isAllSubjectsMode
    ? selectedPupil.evaluations.find((e) => mySubjects.some((s) => isSubjectMatch(s.code, e.subjectCode)) && e.isSubmitted)?.submittedAt
    : myEval?.submittedAt;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Floating Auto-Advance Toast Feedback */}
      {submitToast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl bg-slate-900/95 border border-emerald-500/50 shadow-2xl backdrop-blur-md text-slate-100 text-sm animate-in fade-in slide-in-from-top-4 duration-300"
        >
          <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
            <CheckCircle2 className="w-5 h-5" />
          </div>
          <div>
            <p className="font-bold text-slate-100 leading-tight">
              {submitToast.pendingSubjects ? (
                <>
                  <span className="text-amber-300">{submitToast.pupilName}</span>{' '}
                  {submitToast.submittedAny ? 'teilweise eingereicht' : 'noch offen'}
                </>
              ) : (
                <>
                  <span className="text-emerald-300">{submitToast.pupilName}</span> erfolgreich eingereicht!
                </>
              )}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {submitToast.pendingSubjects ? (
                <span>Offen: {submitToast.pendingSubjects.join(', ')}. Bitte ergänzen und erneut einreichen.</span>
              ) : submitToast.allDone ? (
                <span className="text-amber-300 font-bold">🎉 Alle Schüler dieser Klasse sind jetzt bewertet!</span>
              ) : (
                <span>
                  ➔ Automatisch weiter zu: <strong className="text-amber-300">{submitToast.nextPupilName}</strong>
                </span>
              )}
            </p>
          </div>
          <button
            onClick={() => setSubmitToast(null)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800 transition ml-2"
            title="Schließen"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Co-Teacher Conflict Banner */}
      {conflict && (
        <div className="fixed top-20 right-6 z-50 max-w-md p-4 rounded-2xl bg-amber-500 text-slate-950 font-bold shadow-lg flex items-center justify-between gap-3 animate-bounce">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span className="text-xs">{conflict.message}</span>
          </div>
          <button
            onClick={onClearConflict}
            className="px-2.5 py-1 rounded-lg bg-slate-950 text-slate-50 text-xs hover:bg-slate-800"
          >
            OK
          </button>
        </div>
      )}

      {/* Left Column: Pupil Selector Bar with "Offen" & "Bewertet" Folder Tabs */}
      <div className="w-full lg:w-80 bg-slate-900 border border-slate-800 rounded-3xl p-3 sm:p-4 flex flex-col max-h-[44vh] lg:max-h-[86vh] overflow-hidden shadow-lg shrink-0">
        {/* Folder Tabs (Offen vs Bewertet) */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-950/80 rounded-2xl border border-slate-800 mb-3">
          <button
            onClick={() => {
              setFolderTab('offen');
              if (openPupils.length > 0 && !openPupils.some((p) => p.id === selectedPupilId)) {
                setSelectedPupilId(openPupils[0].id);
              }
            }}
            className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
              folderTab === 'offen'
                ? 'bg-amber-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-50'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>Offen</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                folderTab === 'offen' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {openPupils.length}
            </span>
          </button>

          <button
            onClick={() => {
              setFolderTab('bewertet');
              if (submittedPupils.length > 0 && !submittedPupils.some((p) => p.id === selectedPupilId)) {
                setSelectedPupilId(submittedPupils[0].id);
              }
            }}
            className={`py-2 px-3 rounded-xl font-bold text-xs flex items-center justify-center gap-1.5 transition ${
              folderTab === 'bewertet'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-slate-50'
            }`}
          >
            <FolderCheck className="w-3.5 h-3.5" />
            <span>Bewertet</span>
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                folderTab === 'bewertet' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {submittedPupils.length}
            </span>
          </button>
        </div>

        {/* Pupil List according to active folder */}
        <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
          {currentList.length === 0 ? (
            <div className="py-12 text-center text-slate-500 text-xs px-2">
              {folderTab === 'offen' ? (
                <div>
                  <span className="text-2xl block mb-2">🎉</span>
                  <strong className="text-slate-50 block mb-1">Alle Schüler bewertet!</strong>
                  <span>Alle Schüler dieser Klasse wurden bereits eingereicht. Sie finden diese im Ordner &bdquo;Bewertet&ldquo;.</span>
                </div>
              ) : (
                <div>
                  <ClipboardList className="w-8 h-8 block mb-2 mx-auto opacity-60" aria-hidden="true" />
                  <strong className="text-slate-50 block mb-1">Noch keine Einreichungen</strong>
                  <span>Bewerten Sie einen Schüler und klicken Sie auf &bdquo;Ranking einreichen&ldquo;.</span>
                </div>
              )}
            </div>
          ) : (
            currentList.map((p) => {
              const isSelected = p.id === selectedPupil.id;
              const pRank = calculateRank(p);
              const pDone = isPupilFullySubmitted(p.evaluations, isAllSubjectsMode ? mySubjects.map((s) => s.code) : [mySubjectCode]);

              return (
                <button
                  key={p.id}
                  onClick={() => setSelectedPupilId(p.id)}
                  className={`w-full p-3 rounded-2xl flex items-center justify-between text-left transition min-h-[48px] ${
                    isSelected
                      ? folderTab === 'offen'
                        ? 'bg-amber-500/15 border border-amber-500/40 text-slate-50'
                        : 'bg-emerald-500/15 border border-emerald-500/40 text-slate-50'
                      : 'bg-slate-800/40 hover:bg-slate-800/80 border border-slate-800 text-slate-300'
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold text-sm truncate block leading-tight">{p.fullName}</span>
                      {pDone && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />}
                    </div>
                    {(p.greenCardCount > 0 || p.yellowCardCount > 0) && (
                      <div className="flex items-center gap-2 mt-1">
                        {p.greenCardCount > 0 && (
                          <span className="text-[10px] text-emerald-400 font-bold">
                            ★ {p.greenCardCount}
                          </span>
                        )}
                        {p.yellowCardCount > 0 && (
                          <span className="text-[10px] text-amber-400 font-bold">
                            ▲ {p.yellowCardCount}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {!isAllSubjectsMode && (
                    <span
                      className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border flex-shrink-0 ${pRank.color}`}
                    >
                      {pRank.rank ?? 'Ausstehend'}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Observation Grid for Selected Pupil */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col max-h-[86vh] overflow-hidden shadow-lg">
        {/* Multi-Subject Segmented Switcher Bar (Direct Quick-Switch) */}
        {mySubjects.length > 1 && (
          <div className="flex items-center gap-1.5 p-1.5 bg-slate-950/80 rounded-2xl border border-slate-800 shrink-0 mb-3 shadow-sm overflow-x-auto no-scrollbar">
            <span className="text-[11px] font-bold text-slate-400 px-2 flex items-center gap-1.5 shrink-0">
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>Fachauswahl:</span>
            </span>
            <button
              type="button"
              onClick={() => setSelectedSubjectCode('__ALL__')}
              className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition active:scale-95 shrink-0 ${
                isAllSubjectsMode
                  ? 'bg-amber-500 text-slate-950 shadow-md font-extrabold ring-1 ring-amber-400'
                  : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>🌟 Gesamt (alle {mySubjects.length} Fächer)</span>
            </button>
            {mySubjects.map((s) => {
              const isActive = activeSubjectCode === s.code;
              return (
                <button
                  key={s.code}
                  type="button"
                  onClick={() => setSelectedSubjectCode(s.code)}
                  className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition active:scale-95 shrink-0 ${
                    isActive
                      ? s.isCoreSmile
                        ? 'bg-amber-400 text-slate-950 shadow-md font-extrabold ring-1 ring-amber-300'
                        : 'bg-sky-400 text-slate-950 shadow-md font-extrabold ring-1 ring-sky-300'
                      : 'bg-slate-900 hover:bg-slate-800 text-slate-300 hover:text-white border border-slate-800'
                  }`}
                >
                  <span>{s.code}</span>
                  <span className="text-[10px] opacity-80 font-normal">({s.name})</span>
                  {typeof s.hours === 'number' && s.hours > 0 && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                        isActive ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      {s.hours}h
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Pupil Header */}
        <div className="pb-3 border-b border-slate-800 mb-3 shrink-0 space-y-2.5">
          {/* Row 1: Identity & Primary Actions */}
          <div className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-2.5">
            <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
              <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-slate-50 truncate" title={selectedPupil.fullName}>
                {selectedPupil.fullName}
              </h2>
              {isAllSubjectsMode ? (
                <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                  {mySubjects.map((s) => {
                    const scored = scoreSubject(selectedPupil.evaluations, s.code, rubricItemKeys);
                    const sRank = scored.rank ?? 'Ausstehend';
                    const color = getRankVisuals(scored.rank).badgeBg;
                    return (
                      <span
                        key={s.code}
                        className={`px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider border shrink-0 ${color}`}
                      >
                        {s.code}: {sRank}
                      </span>
                    );
                  })}
                </div>
              ) : (
                <span className={`px-2.5 py-0.5 rounded-lg text-xs font-bold uppercase tracking-wider border shrink-0 ${rankColor}`}>
                  {rank ?? 'Ausstehend'}
                </span>
              )}

              {isSubmitted && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[10px] font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                    <span>Eingereicht</span>
                  </span>
                  {onReopenPupil && !isLockedByConference && (
                    <button
                      onClick={handleReopenPupil}
                      className="px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-50 border border-slate-700 text-[10px] font-bold transition flex items-center gap-1"
                      title="Einreichung zurücknehmen und Bewertung weiter bearbeiten"
                    >
                      <RotateCcw className="w-3 h-3 text-amber-400" />
                      <span>Wieder öffnen</span>
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 shrink-0">
              {/* Submit Ranking Button */}
              <button
                onClick={handleSubmitPupil}
                disabled={!canWrite || isLockedByConference || isPastDeadline}
                title="Ranking einreichen und zum nächsten Schüler wechseln"
                className={`px-3.5 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-md transition active:scale-95 disabled:opacity-40 shrink-0 ${
                  isSubmitted
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                    : 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 shadow-sm'
                }`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{isSubmitted ? 'Erneut einreichen' : 'Ranking einreichen'}</span>
              </button>
            </div>
          </div>

          {/* Row 2: Metadata Chips & Instant-Rank Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            {/* Metadata Chips */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Prominent Subject Badge */}
              <div
                className={`px-2.5 py-0.5 rounded-lg text-xs font-bold flex items-center gap-1.5 border shadow-sm ${
                  isAllSubjectsMode
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                    : mySubject.isCoreSmile
                    ? 'bg-amber-400/15 text-amber-300 border-amber-400/30'
                    : 'bg-sky-400/15 text-sky-300 border-sky-400/30'
                }`}
                title={
                  isAllSubjectsMode
                    ? `Gesamtbewertung für alle deine Fächer: ${mySubjects.map((s) => s.code).join(', ')}`
                    : `Aktuelles Bewertungsfach: ${mySubject.name} (${mySubject.code})`
                }
              >
                {isAllSubjectsMode ? <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" /> : <BookOpen className="w-3.5 h-3.5 opacity-80 shrink-0" />}
                <span>{isAllSubjectsMode ? '🌟 Gesamtbewertung' : mySubject.name}</span>
                <span className="font-mono text-[10px] opacity-75">
                  [{isAllSubjectsMode ? mySubjects.map((s) => s.code).join(' + ') : mySubject.code}]
                </span>
              </div>

              {/* Autosave Status Badge */}
              <div
                className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-slate-950/70 border border-slate-800 text-xs shadow-sm transition-all"
                title="Automatisches Speichern: Alle Bewertungen und Eingaben werden sofort gesichert."
              >
                {ratingSaveError ? (
                  <span role="alert" className="text-rose-300 font-medium text-[11px]">
                    Speichern fehlgeschlagen: {ratingSaveError}
                  </span>
                ) : isSaving ? (
                  <>
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
                    </span>
                    <span className="text-amber-300 font-medium text-[11px]">Wird gesichert...</span>
                  </>
                ) : lastSavedTime ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span className="text-emerald-300 font-medium text-[11px]">
                      Gesichert ({lastSavedTime.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })})
                    </span>
                  </>
                ) : (
                  <>
                    <span className="w-2 h-2 rounded-full bg-emerald-400/80 shrink-0" />
                    <span className="text-slate-400 text-[11px]">Auto-Save aktiv</span>
                  </>
                )}
              </div>

              {/* Weekly Lessons & Voting Weight Infochip */}
              {currentHoursInfo && (
                <div
                  className="px-2.5 py-0.5 rounded-lg text-xs font-semibold bg-slate-950/70 border border-slate-800 text-slate-300 flex items-center gap-1.5 shadow-sm"
                  title={`Wochenstunden: ${currentHoursInfo.hours}h · Stimmgewicht in Konferenz: ${currentHoursInfo.weight}${currentHoursInfo.isTeamTeaching ? ' (Team-Teaching Kernfach x2)' : ''}`}
                >
                  <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>{currentHoursInfo.hours}h/Woche</span>
                  <span className="text-slate-600">·</span>
                  <span className="text-amber-300 font-bold">Gewicht: {currentHoursInfo.weight}</span>
                  {currentHoursInfo.isTeamTeaching && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-mono font-bold">
                      Team-Teaching (x2)
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Reset Button */}
            <button
              type="button"
              onClick={handleResetAll}
              disabled={!canWrite || isLockedByConference || isPastDeadline}
              title="Alle 18 Bewertungen leeren / zurücksetzen"
              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-50 border border-slate-700 text-xs font-bold transition active:scale-95 flex items-center gap-1 disabled:opacity-40"
            >
              <RotateCcw className="w-3 h-3 text-amber-400" />
              <span>Reset</span>
            </button>
          </div>
        </div>

        {/* Single, unified scroll container for the Right Column Body */}
        <div className="flex-1 overflow-y-auto pr-1.5 space-y-3.5">
          {/* Quick-Grading Cards: 1-Click Grading */}
          <div className="bg-slate-950/70 border border-slate-800 rounded-2xl p-3.5 sm:p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>Schnellbewertung (1-Klick)</span>
              </span>
              {saveSuccessMsg && (
                <span className="text-emerald-400 text-[11px] font-bold flex items-center gap-1 animate-fadeIn">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>{saveSuccessMsg}</span>
                </span>
              )}
            </div>
            {isAllSubjectsMode && (
              <p className="text-[11px] text-amber-400/80">
                Gilt für alle Fächer: {mySubjects.map((subject) => subject.name).join(' · ')}
              </p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {[
                {
                  rank: 'Lehrling' as const,
                  label: 'Lehrling',
                  dot: 'bg-rose-500',
                  border: 'border-rose-500/30 hover:border-rose-500/60',
                  active: 'bg-rose-500/20 border-rose-500 text-rose-200 ring-2 ring-rose-500/50 shadow-md',
                  desc: 'Starke Unterstützung nötig / Basis',
                },
                {
                  rank: 'Geselle' as const,
                  label: 'Geselle',
                  dot: 'bg-blue-500',
                  border: 'border-blue-500/30 hover:border-blue-500/60',
                  active: 'bg-blue-500/20 border-blue-500 text-blue-200 ring-2 ring-blue-500/50 shadow-md',
                  desc: 'Solide Leistungen / Regelstandard',
                },
                {
                  rank: 'Meister' as const,
                  label: 'Meister',
                  dot: 'bg-amber-400',
                  border: 'border-amber-400/30 hover:border-amber-400/60',
                  active: 'bg-amber-400/20 border-amber-400 text-amber-200 ring-2 ring-amber-400/50 shadow-md',
                  desc: 'Eigenständig / Spitzenleistung',
                },
              ].map((opt) => {
                // The quick-grade cards represent an explicit teacher proposal.
                // A card is only selected when the teacher explicitly clicked it,
                // or when a manual proposal already exists on the record.
                // An unrated pupil starts clean with no prior selection.
                const isSelected = votedRank === opt.rank;
                return (
                  <button
                    key={opt.rank}
                    type="button"
                    disabled={!canWrite || isLockedByConference || isPastDeadline}
                    onClick={() => void handleQuickGrade(opt.rank)}
                    className={`p-3 rounded-2xl border text-left transition flex flex-col justify-between min-h-[82px] active:scale-98 ${
                      isSelected
                        ? opt.active
                        : `bg-slate-900/60 ${opt.border} text-slate-300 hover:bg-slate-900`
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${opt.dot}`} />
                        <span className="font-bold text-sm text-slate-50">{opt.label}</span>
                      </div>
                      {isSelected && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1">
                          <Check className="w-3.5 h-3.5" /> Gewählt
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400 mt-2 block">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Teacher Observation Comment Box (for conference & KEL) */}
          <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3 flex flex-col gap-1.5 shadow-sm">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5 text-amber-400" />
                <span>Anmerkung / Begründung für die Konferenz (optional):</span>
              </label>
              {isAllSubjectsMode && (
                <span className="text-[10px] text-amber-400/80 font-medium">
                  Gilt für alle deine Fächer ({mySubjects.map((s) => s.code).join(', ')})
                </span>
              )}
            </div>
            <textarea
              value={votedComment}
              onChange={(e) => handleCommentChange(e.target.value)}
              onBlur={() => {
                void flushComment();
              }}
              disabled={!canWrite || isLockedByConference || isPastDeadline}
              rows={2}
              placeholder="z.B. Zeigt im Unterricht hohe Motivation, arbeitet verlässlich in Gruppen..."
              className="w-full p-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 resize-none transition"
            />
          </div>
          {/* Beobachtungsbogen Accordion Button (On Click Only) */}
          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setShowDetailedRaster((prev) => !prev)}
              className="w-full py-2.5 px-4 rounded-2xl bg-slate-950/80 hover:bg-slate-900 border border-slate-800 text-slate-300 hover:text-slate-100 text-xs font-bold flex items-center justify-between transition shadow-xs group"
            >
              <div className="flex items-center gap-2">
                <ClipboardList className="w-4 h-4 text-amber-400 group-hover:scale-110 transition" />
                <span>Beobachtungsbogen (18 Kriterien & Merkmale)</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  · {showDetailedRaster ? 'Einklappen' : 'Auf Klick öffnen für Feinanpassung'}
                </span>
              </div>
              {showDetailedRaster ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>
          </div>

          {/* Detailed 18-Criteria Grid: Accordion body */}
          {showDetailedRaster && (
            <div className="space-y-3">
              {criteria.map((crit) => (
                <div
                  key={crit.id}
                  className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3 sm:p-3.5 shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-800/60">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100 flex items-center gap-1.5">
                        <span>{crit.name}</span>
                      </h3>
                    </div>

                    {/* Category Quick Fill Buttons */}
                    <div className="flex items-center gap-1 bg-slate-900 border border-slate-800/90 p-0.5 rounded-lg">
                      <span className="text-[9px] text-slate-500 uppercase font-bold px-1 hidden sm:inline">Alle:</span>
                      <button
                        type="button"
                        disabled={!canWrite || isLockedByConference || isPastDeadline}
                        onClick={() => handleQuickFillCategory(crit, 'crown')}
                        title="Alle Merkmale dieser Kategorie mit Krone (👑) füllen" aria-label="Alle Merkmale dieser Kategorie mit Krone füllen"
                        className="pressable focus-ring w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-amber-400/15 hover:bg-amber-400/30 text-amber-300 flex items-center justify-center transition disabled:opacity-30"
                      >
                        <Crown className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite || isLockedByConference || isPastDeadline}
                        onClick={() => handleQuickFillCategory(crit, 'smile')}
                        title="Alle Merkmale dieser Kategorie mit Gut (😊) füllen" aria-label="Alle Merkmale dieser Kategorie mit Gut füllen"
                        className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                      >
                        😊
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite || isLockedByConference || isPastDeadline}
                        onClick={() => handleQuickFillCategory(crit, 'struggle')}
                        title="Alle Merkmale dieser Kategorie mit Mühe (😖) füllen" aria-label="Alle Merkmale dieser Kategorie mit Mühe füllen"
                        className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                      >
                        😖
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite || isLockedByConference || isPastDeadline}
                        onClick={() => handleQuickFillCategory(crit, 'sad')}
                        title="Alle Merkmale dieser Kategorie mit Traurig (😢) füllen" aria-label="Alle Merkmale dieser Kategorie mit Traurig füllen"
                        className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                      >
                        😢
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite || isLockedByConference || isPastDeadline}
                        onClick={() => handleQuickFillCategory(crit, 'newstart')}
                        title="Alle Merkmale dieser Kategorie mit Neustart (🔄) füllen" aria-label="Alle Merkmale dieser Kategorie mit Neustart füllen"
                        className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                      >
                        🔄
                      </button>
                      <button
                        type="button"
                        disabled={!canWrite || isLockedByConference || isPastDeadline}
                        onClick={() => handleQuickFillCategory(crit, '')}
                        title="Kategorie leeren" aria-label="Kategorie leeren"
                        className="w-6 h-6 pointer-coarse:w-10 pointer-coarse:h-10 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs flex items-center justify-center transition disabled:opacity-30"
                      >
                        ✕
                      </button>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2 sm:gap-2.5">
                    {crit.items.map((it) => {
                      // The rating shown here comes from the merged view of the subjects in scope, but
                      // a write must carry the version of the subject it targets. In Gesamt mode each
                      // subject's row has its own version, so sending one subject's version for all
                      // of them makes the server's `UPDATE ... WHERE version = $4` match zero rows -
                      // a conflict on cells nobody touched. Hence itemVersionForSubject below.
                      const itemData = getItemData(selectedPupil, it.key);
                      const currentRating = itemData?.rating;

                      // Soft lock check
                       const softLock = targetSubjectCodes
                         .map((subjectCode) => softLocks.get(`${subjectCode}|${selectedPupil.id}|${it.key}`))
                         .find((lock) => lock !== undefined);

                      // 5 Smileys buttons
                      const ratingButtons = [
                        {
                          val: 'crown',
                          label: (
                            <div className="flex flex-col items-center justify-center leading-none gap-0.5">
                              <span className="text-[8px] sm:text-[9px] leading-none">👑</span>
                              <span className="text-xs sm:text-sm leading-none">😊</span>
                            </div>
                          ),
                          activeBg: 'bg-amber-400 text-slate-950 font-bold shadow-md scale-105 border-2 border-amber-300 ring-2 ring-amber-400/40',
                          title: 'Hervorragend (Krone)',
                        },
                        {
                          val: 'smile',
                          label: <span className="text-lg leading-none">😊</span>,
                          activeBg: 'bg-emerald-500 text-slate-950 font-bold shadow-md scale-105 border-2 border-emerald-300 ring-2 ring-emerald-500/40',
                          title: 'Gut (😊)',
                        },
                        {
                          val: 'struggle',
                          label: <span className="text-lg leading-none">😖</span>,
                          activeBg: 'bg-amber-500 text-slate-950 font-bold shadow-md scale-105 border-2 border-amber-300 ring-2 ring-amber-500/40',
                          title: 'Mit Mühe (😖)',
                        },
                        {
                          val: 'sad',
                          label: <span className="text-lg leading-none">😢</span>,
                          activeBg: 'bg-rose-500 text-slate-50 font-bold shadow-md scale-105 border-2 border-rose-300 ring-2 ring-rose-500/40',
                          title: 'Traurig (😢)',
                        },
                        {
                          val: 'newstart',
                          label: <span className="text-lg leading-none">🔄</span>,
                          activeBg: 'bg-sky-500 text-slate-950 font-bold shadow-md scale-105 border-2 border-sky-300 ring-2 ring-sky-500/40',
                          title: 'Neustart (🔄)',
                        },
                      ];

                      return (
                        <div
                          key={it.key}
                          className={`bg-slate-900 border rounded-xl p-2.5 sm:p-3 flex flex-col justify-between transition ${
                            softLock
                              ? 'border-amber-400/50 bg-amber-500/5'
                              : 'border-slate-800/80 hover:border-slate-700'
                          }`}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                {it.key}
                              </span>
                              {softLock && (
                                <span className="text-[10px] text-amber-400 animate-pulse font-bold flex items-center gap-1">
                                  <span>✏️</span>
                                  <span>{softLock.teacherShort || softLock.teacherName} tippt...</span>
                                </span>
                              )}
                            </div>
                            <p
                              className="text-[11px] sm:text-xs text-slate-300 font-medium leading-snug mb-2 line-clamp-2 hover:line-clamp-none transition-all cursor-default"
                              title={it.desc || it.label}
                            >
                              {it.desc || it.label}
                            </p>
                          </div>

                          {/* Smileys Row */}
                          <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-slate-800/60">
                            {ratingButtons.map((btn) => {
                              const isActive =
                                currentRating === btn.val ||
                                (btn.val === 'crown' && currentRating === '++') ||
                                (btn.val === 'smile' && currentRating === '+') ||
                                (btn.val === 'struggle' && (currentRating === 'strain' || currentRating === 'o')) ||
                                (btn.val === 'sad' && currentRating === '-') ||
                                (btn.val === 'newstart' && currentRating === 'restart');

                              return (
                                <button
                                  key={btn.val}
                                  type="button"
                                  disabled={!canWrite || isLockedByConference || !!softLock || isPastDeadline}
                                  title={btn.title} aria-label={btn.title} aria-pressed={isActive}
                                   onFocus={() => targetSubjectCodes.forEach((subjectCode) => onSendFocus(selectedPupil.id, it.key, subjectCode))}
                                   onBlur={() => targetSubjectCodes.forEach((subjectCode) => onSendBlur(selectedPupil.id, it.key, subjectCode))}
                                  onClick={() => {
                                    // Tapping the active button deselects it to blank!
                                    const nextVal = isActive ? '' : btn.val;
                                    void saveCellRating(selectedPupil, crit.id, it.key, nextVal);
                                  }}
                                  className={`flex-1 min-w-0 max-w-[40px] pointer-coarse:max-w-[44px] h-8 sm:h-8.5 pointer-coarse:h-11 rounded-lg flex items-center justify-center transition active:scale-90 disabled:opacity-40 ${
                                    isActive
                                      ? btn.activeBg
                                      : 'bg-slate-800/80 hover:bg-slate-700/80 hover:scale-105 border border-slate-700/60 text-slate-300'
                                  }`}
                                >
                                  {btn.label}
                                </button>
                              );
                            })}

                            {/* Reset / Deselect Button (Explicit Blank) */}
                            {currentRating && currentRating !== 'n.b.' && currentRating !== '' && (
                              <button
                                type="button"
                                disabled={!canWrite || isLockedByConference || !!softLock || isPastDeadline}
                                title="Bewertung löschen (Leer)" aria-label="Bewertung löschen"
                                onClick={() => void saveCellRating(selectedPupil, crit.id, it.key, '')}
                                className="w-6 h-6 pointer-coarse:w-9 pointer-coarse:h-9 rounded-md bg-slate-800/40 hover:bg-rose-500/20 text-slate-500 hover:text-rose-300 border border-slate-700/40 flex items-center justify-center text-[10px] font-bold transition ml-0.5"
                              >
                                ✕
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

    </div>
  );
};
