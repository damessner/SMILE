import React, { useState, useEffect } from 'react';
import { FileText, ClipboardList, ChevronUp, ChevronDown } from 'lucide-react';
import { PupilWithData, RubricCriterion } from '../types';
import { hasSubmittedForSubject, isSubjectMatch, itemVersionForSubject, scoreSubject } from '../lib/pupilItems';
import { useConfirm } from './ConfirmDialog';
import { useToast } from './Toast';
import { BeobachtungsGridProps, FolderTab, SubmitNotice } from './beobachtungsGrid/types';
import {
  ItemWrite,
  calculateRankFor,
  getCurrentHoursInfo,
  settleAllWrites,
  writeItemsForSubjects,
} from './beobachtungsGrid/helpers';
import { useSaveFeedback } from './beobachtungsGrid/useSaveFeedback';
import { useCommentAutosave } from './beobachtungsGrid/useCommentAutosave';
import { PupilSelector } from './beobachtungsGrid/PupilSelector';
import { SubjectSwitcher } from './beobachtungsGrid/SubjectSwitcher';
import { PupilHeader } from './beobachtungsGrid/PupilHeader';
import { QuickGradeCard } from './beobachtungsGrid/QuickGradeCard';
import { CriterionRaster } from './beobachtungsGrid/CriterionRaster';
import { SubmitToastBanner, ConflictBanner } from './beobachtungsGrid/GridBanners';

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
  currentTeacherId,
}) => {
  const confirm = useConfirm();
  const toast = useToast();
  // Folder tabs: "offen" (unsubmitted) vs "bewertet" (submitted)
  const [folderTab, setFolderTab] = useState<FolderTab>('offen');
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

  // Autosave and feedback state
  const saveFeedback = useSaveFeedback();
  const { isSaving, lastSavedTime, ratingSaveError, beginSave, finishSave } = saveFeedback;

  const [submitToast, setSubmitToast] = useState<SubmitNotice | null>(null);

  // Weekly timetable lesson hours & conference voting weight
  const currentHoursInfo = React.useMemo(
    () => getCurrentHoursInfo(mySubjects, isAllSubjectsMode, activeSubjectCode),
    [mySubjects, isAllSubjectsMode, activeSubjectCode]
  );

  // Target subjects for write operations (all subjects in Gesamt mode, or the selected individual subject)
  const targetSubjectCodes = isAllSubjectsMode
    ? mySubjects.map((s) => s.code)
    : [mySubjectCode];

  // Check if active subject has specific group assignments in this class
  const isSubjectGrouped = React.useMemo(() => {
    if (isAllSubjectsMode) return false;
    return pupils.some(
      (p) => p.assignedTeachers?.[activeSubjectCode] && p.assignedTeachers[activeSubjectCode].length > 0
    );
  }, [pupils, activeSubjectCode, isAllSubjectsMode]);

  // Pupils assigned to current teacher for the active subject
  const myPupilsForSubject = React.useMemo(() => {
    if (!currentTeacherId || !isSubjectGrouped) return pupils;
    return pupils.filter((p) => {
      const assigned = p.assignedTeachers?.[activeSubjectCode];
      return Array.isArray(assigned) && assigned.includes(currentTeacherId);
    });
  }, [pupils, currentTeacherId, isSubjectGrouped, activeSubjectCode]);

  const [groupFilterMode, setGroupFilterMode] = useState<'my_pupils' | 'all'>('my_pupils');

  const effectivePupils = React.useMemo(() => {
    if (!currentTeacherId || !isSubjectGrouped || groupFilterMode === 'all') {
      return pupils;
    }
    return myPupilsForSubject;
  }, [pupils, currentTeacherId, isSubjectGrouped, groupFilterMode, myPupilsForSubject]);

  // Divide pupils into open and submitted for the currently active subject
  const isPupilSubmittedForSubject = (p: PupilWithData) => {
    if (isAllSubjectsMode) {
      return mySubjects.length > 0 && mySubjects.every((s) => hasSubmittedForSubject(p.evaluations, s.code));
    }
    return hasSubmittedForSubject(p.evaluations, mySubjectCode);
  };

  const openPupils = effectivePupils.filter((p) => !isPupilSubmittedForSubject(p));
  const submittedPupils = effectivePupils.filter((p) => isPupilSubmittedForSubject(p));

  useEffect(() => {
    if (selectedPupilIdProp) {
      setSelectedPupilId(selectedPupilIdProp);
      const selectedForProp = effectivePupils.find((p) => p.id === selectedPupilIdProp) || pupils.find((p) => p.id === selectedPupilIdProp);
      const isSub = selectedForProp ? hasSubmittedForSubject(selectedForProp.evaluations, mySubjectCode) : false;
      if (isSub) {
        setFolderTab('bewertet');
      } else {
        setFolderTab('offen');
      }
    }
  }, [selectedPupilIdProp, mySubjectCode, effectivePupils, pupils]);

  // Ensure selectedPupilId stays valid when filtered group or tab changes
  const currentList = folderTab === 'offen' ? openPupils : submittedPupils;
  const selectedPupil =
    effectivePupils.find((p) => p.id === selectedPupilId) ||
    currentList[0] ||
    effectivePupils[0] ||
    pupils[0];

  useEffect(() => {
    if (selectedPupilId && !effectivePupils.some((p) => p.id === selectedPupilId)) {
      const nextList = folderTab === 'offen' ? openPupils : submittedPupils;
      const fallback = nextList[0] || effectivePupils[0];
      if (fallback) {
        setSelectedPupilId(fallback.id);
      }
    }
  }, [effectivePupils, selectedPupilId, folderTab, openPupils, submittedPupils]);

  // Auto-switch to submitted tab if no open pupils remain
  useEffect(() => {
    if (openPupils.length === 0 && submittedPupils.length > 0 && folderTab === 'offen') {
      setFolderTab('bewertet');
      if (!selectedPupilId) {
        setSelectedPupilId(submittedPupils[0].id);
      }
    }
  }, [openPupils.length, submittedPupils.length]);

  const selectFolder = (tab: FolderTab) => {
    const list = tab === 'offen' ? openPupils : submittedPupils;
    setFolderTab(tab);
    if (list.length > 0 && !list.some((p) => p.id === selectedPupilId)) {
      setSelectedPupilId(list[0].id);
    }
  };

  const {
    lastStoredCommentRef,
    flushComment,
    handleCommentChange,
  } = useCommentAutosave({
    selectedPupil,
    targetSubjectCodes,
    canWrite,
    isLockedByConference,
    setVotedComment,
    setSaveSuccessMsg,
    saveFeedback,
    toast,
  });

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

  const rubricItemKeys = React.useMemo(
    () => Array.from(new Set(criteria.flatMap((c) => c.items.map((i) => i.key)))),
    [criteria]
  );

  const calculateRank = (pupil: PupilWithData, subjectCode?: string) => {
    const targetCode = subjectCode || (isAllSubjectsMode ? primarySubject.code : mySubjectCode);
    return calculateRankFor(pupil.evaluations, targetCode, rubricItemKeys);
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

  const saveCellRating = async (
    pupil: PupilWithData,
    criterionId: string,
    itemKey: string,
    rating: string,
  ) => {
    if (!canWrite || isLockedByConference || isSubmitted) return;
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

  // Unified 1-Click Quick Grade Handler (Core & Non-Core).
  // Rank-only by design (2026-10-12 decision): the one-click grade never writes
  // criterion cells — points count only when a teacher really taps them. The
  // rank is submitted as the proposal for every subject in scope.
  const handleQuickGrade = async (targetRank: 'Lehrling' | 'Geselle' | 'Meister') => {
    if (!canWrite || !selectedPupil || isLockedByConference || isPastDeadline) return;
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
      setSaveSuccessMsg(`Rang „${targetRank}“ übermittelt`);
    } catch (err) {
      finishSave(err);
      toast.error('Rang konnte nicht gespeichert werden');
    }
  };

  // Reset all 18 criteria for pupil
  const handleResetAll = async () => {
    if (!canWrite || isLockedByConference || isSubmitted || !selectedPupil) return;
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
    const allCritItems: ItemWrite[] = [];
    for (const crit of criteria) {
      for (const it of crit.items) {
        allCritItems.push({ criterionId: crit.id, itemKey: it.key, rating: '' });
      }
    }

    try {
      await writeItemsForSubjects(selectedPupil, allCritItems, targetSubjectCodes, onRate, onBatchUpdate);
      finishSave();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Bewertungen konnten nicht geleert werden.';
      finishSave(error);
      toast.error(message);
    }
  };

  // Quick fill entire category (3 items)
  const handleQuickFillCategory = async (crit: RubricCriterion, rating: string) => {
    if (!canWrite || isLockedByConference || isSubmitted || !selectedPupil) return;
    beginSave();
    const catItems: ItemWrite[] = crit.items.map((it) => ({
      criterionId: crit.id,
      itemKey: it.key,
      rating,
    }));

    try {
      await writeItemsForSubjects(selectedPupil, catItems, targetSubjectCodes, onRate, onBatchUpdate);
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
    ? mySubjects.length > 0 && mySubjects.every((s) => hasSubmittedForSubject(selectedPupil.evaluations, s.code))
    : Boolean(myEval?.isSubmitted);
  const submittedAt = isAllSubjectsMode
    ? selectedPupil.evaluations.find((e) => mySubjects.some((s) => isSubjectMatch(s.code, e.subjectCode)) && e.isSubmitted)?.submittedAt
    : myEval?.submittedAt;

  const writeBlocked = !canWrite || isLockedByConference || isPastDeadline || isSubmitted;
  const sendItemFocus = (itemKey: string) =>
    targetSubjectCodes.forEach((subjectCode) => onSendFocus(selectedPupil.id, itemKey, subjectCode));
  const sendItemBlur = (itemKey: string) =>
    targetSubjectCodes.forEach((subjectCode) => onSendBlur(selectedPupil.id, itemKey, subjectCode));
  const handleRateItem = (criterionId: string, itemKey: string, rating: string) => {
    void saveCellRating(selectedPupil, criterionId, itemKey, rating);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Floating Auto-Advance Toast Feedback */}
      {submitToast && (
        <SubmitToastBanner notice={submitToast} onDismiss={() => setSubmitToast(null)} />
      )}

      {/* Co-Teacher Conflict Banner */}
      {conflict && <ConflictBanner conflict={conflict} onClear={onClearConflict} />}

      {/* Left Column: Pupil Selector Bar with "Offen" & "Bewertet" Folder Tabs */}
      <PupilSelector
        folderTab={folderTab}
        openCount={openPupils.length}
        submittedCount={submittedPupils.length}
        currentList={currentList}
        selectedPupilId={selectedPupil.id}
        isAllSubjectsMode={isAllSubjectsMode}
        subjectCodes={targetSubjectCodes}
        onSelectFolder={selectFolder}
        onSelectPupil={setSelectedPupilId}
        calculateRank={calculateRank}
        activeSubjectCode={activeSubjectCode}
        isSubjectGrouped={isSubjectGrouped && Boolean(currentTeacherId)}
        groupFilterMode={groupFilterMode}
        onToggleGroupFilter={setGroupFilterMode}
        myPupilCount={myPupilsForSubject.length}
        totalPupilCount={pupils.length}
      />

      {/* Right Column: Observation Grid for Selected Pupil */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl p-4 sm:p-5 flex flex-col max-h-[86vh] overflow-hidden shadow-lg">
        {mySubjects.length > 1 && (
          <SubjectSwitcher
            mySubjects={mySubjects}
            isAllSubjectsMode={isAllSubjectsMode}
            activeSubjectCode={activeSubjectCode}
            onSelectSubject={setSelectedSubjectCode}
          />
        )}

        <PupilHeader
          pupil={selectedPupil}
          mySubjects={mySubjects}
          mySubject={mySubject}
          isAllSubjectsMode={isAllSubjectsMode}
          rubricItemKeys={rubricItemKeys}
          rank={rank}
          rankColor={rankColor}
          isSubmitted={isSubmitted}
          showReopen={Boolean(onReopenPupil) && !isLockedByConference}
          canWrite={canWrite}
          isLockedByConference={isLockedByConference}
          isPastDeadline={isPastDeadline}
          currentHoursInfo={currentHoursInfo}
          isSaving={isSaving}
          lastSavedTime={lastSavedTime}
          ratingSaveError={ratingSaveError}
          onSubmit={handleSubmitPupil}
          onReopen={handleReopenPupil}
          onReset={handleResetAll}
        />

        {/* Single, unified scroll container for the Right Column Body */}
        <div className="flex-1 overflow-y-auto pr-1.5 space-y-3.5">
          <QuickGradeCard
            votedRank={votedRank}
            saveSuccessMsg={saveSuccessMsg}
            isAllSubjectsMode={isAllSubjectsMode}
            mySubjects={mySubjects}
            disabled={!canWrite || isLockedByConference || isPastDeadline}
            onQuickGrade={handleQuickGrade}
          />

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
            <CriterionRaster
              criteria={criteria}
              pupil={selectedPupil}
              subjectCodes={targetSubjectCodes}
              softLocks={softLocks}
              writeBlocked={writeBlocked}
              onQuickFill={handleQuickFillCategory}
              onRateItem={handleRateItem}
              onItemFocus={sendItemFocus}
              onItemBlur={sendItemBlur}
            />
          )}
        </div>
      </div>

    </div>
  );
};
