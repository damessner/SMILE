import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { PupilWithData, RubricCriterion, User } from '../types';
import { SoftLock, ConflictEvent } from '../hooks/useLiveSync';
import { useConfirm } from './ConfirmDialog';

interface BeobachtungsGridProps {
  pupils: PupilWithData[];
  criteria: RubricCriterion[];
  softLocks: Map<string, SoftLock>;
  conflict: ConflictEvent | null;
  onClearConflict: () => void;
  onSendFocus: (pupilId: number, itemKey: string) => void;
  onSendBlur: (pupilId: number, itemKey: string) => void;
  onRate: (
    pupilId: number,
    criterionId: string,
    itemKey: string,
    rating: string,
    expectedVersion: number,
    subjectCode?: string
  ) => void;
  onOpenCardDrawer: (pupilId: number, name: string) => void;
  onOpenKelReport: (pupil: PupilWithData) => void;
  isLockedByConference: boolean;
  canAccessRaster?: boolean;
  mySubjects?: Array<{ code: string; name: string; isCoreSmile: boolean }>;
  selectedPupilIdProp?: number | null;
  onSubmitPupil?: (pupilId: number, proposedStatus?: string, comment?: string) => Promise<void>;
  onReopenPupil?: (pupilId: number) => Promise<void>;
  onBatchUpdate?: (pupilId: number, items: Array<{ criterionId: string; itemKey: string; rating: string }>) => Promise<void>;
  onOpenReportModal?: () => void;
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
  canAccessRaster = true,
  mySubjects = [],
  selectedPupilIdProp,
  onSubmitPupil,
  onReopenPupil,
  onBatchUpdate,
  onOpenReportModal,
}) => {
  const confirm = useConfirm();
  // Folder tabs: "offen" (unsubmitted) vs "bewertet" (submitted)
  const [folderTab, setFolderTab] = useState<'offen' | 'bewertet'>('offen');
  const [selectedPupilId, setSelectedPupilId] = useState<number | null>(
    selectedPupilIdProp || pupils[0]?.id || null
  );

  // Active subject for current teacher
  const mySubject = mySubjects.length > 0 ? mySubjects[0] : { code: 'SD', name: 'Fach', isCoreSmile: false };
  const mySubjectCode = mySubject.code;

  // Non-core rating & observation state
  const [unlockedRasterPupils, setUnlockedRasterPupils] = useState<Set<number>>(new Set());
  const [showNonCoreModal, setShowNonCoreModal] = useState(false);
  const [votedRank, setVotedRank] = useState<'Lehrling' | 'Geselle' | 'Meister' | null>(null);
  const [votedComment, setVotedComment] = useState<string>('');
  const [isSavingVote, setIsSavingVote] = useState(false);
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Divide pupils into open and submitted
  const openPupils = pupils.filter((p) =>
    canAccessRaster
      ? !p.evaluations.some((e) => e.isSubmitted)
      : !p.evaluations.some((e) => e.subjectCode === mySubjectCode && e.isSubmitted)
  );
  const submittedPupils = pupils.filter((p) =>
    canAccessRaster
      ? p.evaluations.some((e) => e.isSubmitted)
      : p.evaluations.some((e) => e.subjectCode === mySubjectCode && e.isSubmitted)
  );

  useEffect(() => {
    if (selectedPupilIdProp) {
      setSelectedPupilId(selectedPupilIdProp);
      const isSub = pupils
        .find((p) => p.id === selectedPupilIdProp)
        ?.evaluations.some((e) =>
          canAccessRaster ? e.isSubmitted : (e.subjectCode === mySubjectCode && e.isSubmitted)
        );
      if (isSub) {
        setFolderTab('bewertet');
      } else {
        setFolderTab('offen');
      }
    }
  }, [selectedPupilIdProp, canAccessRaster, mySubjectCode]);

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

  // Sync votedRank and comment whenever selected pupil changes
  useEffect(() => {
    if (selectedPupil) {
      const existing = selectedPupil.evaluations.find((e) => e.subjectCode === mySubjectCode);
      setVotedRank((existing?.proposedStatus as any) || null);
      setVotedComment(existing?.comment || '');
      setSaveSuccessMsg(null);
    }
  }, [selectedPupil?.id, mySubjectCode]);

  // Deadline: 30.10.2026 23:59:59
  const deadline = new Date(2026, 9, 30, 23, 59, 59);
  const isPastDeadline = new Date() > deadline;

  // Helper to extract rating and version for a specific item
  const getItemData = (pupil: PupilWithData, itemKey: string) => {
    for (const ev of pupil.evaluations) {
      const match = ev.items?.find((i) => i.itemKey === itemKey);
      if (match) return match;
    }
    return null;
  };

  const isPositiveRating = (r?: string) =>
    r === 'crown' || r === 'smile' || r === '++' || r === '+';

  // Compute live rank
  const calculateRank = (pupil: PupilWithData) => {
    const allItems = pupil.evaluations.flatMap((e) => e.items || []);
    const pos = allItems.filter((i) => isPositiveRating(i.rating)).length;
    if (pos >= 14) return { rank: 'Meister', color: 'bg-amber-400/20 text-amber-300 border-amber-400/40', barColor: 'bg-amber-400', pos };
    if (pos >= 8) return { rank: 'Geselle', color: 'bg-blue-500/20 text-blue-300 border-blue-500/40', barColor: 'bg-blue-500', pos };
    return { rank: 'Lehrling', color: 'bg-rose-500/20 text-rose-300 border-rose-500/40', barColor: 'bg-rose-500', pos };
  };

  // Instant Rank Handlers
  const handleInstantRank = async (targetRank: 'Lehrling' | 'Geselle' | 'Meister') => {
    if (!selectedPupil) return;
    setVotedRank(targetRank);

    const allCritItems: Array<{ criterionId: string; itemKey: string; rating: string }> = [];
    let count = 0;

    for (const crit of criteria) {
      for (const it of crit.items) {
        let r = 'smile';
        if (targetRank === 'Meister') {
          r = count < 14 ? 'crown' : 'smile';
        } else if (targetRank === 'Geselle') {
          r = count < 10 ? 'smile' : 'struggle';
        } else {
          r = count < 4 ? 'smile' : 'struggle';
        }
        allCritItems.push({ criterionId: crit.id, itemKey: it.key, rating: r });
        count++;
      }
    }

    if (onBatchUpdate) {
      await onBatchUpdate(selectedPupil.id, allCritItems);
    } else {
      for (const it of allCritItems) {
        onRate(selectedPupil.id, it.criterionId, it.itemKey, it.rating, 1, mySubjectCode);
      }
    }
  };

  // Reset all 18 criteria for pupil
  const handleResetAll = async () => {
    if (!selectedPupil) return;
    const ok = await confirm({
      title: 'Alle Bewertungen leeren?',
      message: `Alle 18 Merkmale für ${selectedPupil.fullName} werden zurückgesetzt.`,
      confirmLabel: 'Zurücksetzen',
      tone: 'danger',
    });
    if (!ok) return;

    setVotedRank(null);
    const allCritItems: Array<{ criterionId: string; itemKey: string; rating: string }> = [];
    for (const crit of criteria) {
      for (const it of crit.items) {
        allCritItems.push({ criterionId: crit.id, itemKey: it.key, rating: '' });
      }
    }

    if (onBatchUpdate) {
      await onBatchUpdate(selectedPupil.id, allCritItems);
    } else {
      for (const it of allCritItems) {
        onRate(selectedPupil.id, it.criterionId, it.itemKey, '', 1, mySubjectCode);
      }
    }
  };

  // Quick fill entire category (3 items)
  const handleQuickFillCategory = async (crit: RubricCriterion, rating: string) => {
    if (!selectedPupil) return;
    const catItems = crit.items.map((it) => ({
      criterionId: crit.id,
      itemKey: it.key,
      rating,
    }));

    if (onBatchUpdate) {
      await onBatchUpdate(selectedPupil.id, catItems);
    } else {
      for (const it of catItems) {
        onRate(selectedPupil.id, it.criterionId, it.itemKey, it.rating, 1, mySubjectCode);
      }
    }
  };

  // Submit Ranking & Advance sequentially to next pupil on list
  const handleSubmitPupil = async () => {
    if (!selectedPupil) return;

    // Find position in openPupils
    const currIdx = openPupils.findIndex((p) => p.id === selectedPupil.id);

    const { rank } = calculateRank(selectedPupil);
    const finalRankToSubmit = canAccessRaster ? rank : (votedRank || rank || 'Geselle');

    if (onSubmitPupil) {
      await onSubmitPupil(selectedPupil.id, finalRankToSubmit, votedComment);
    }

    // Advance to next sequential pupil in the open list
    const remainingOpen = openPupils.filter((p) => p.id !== selectedPupil.id);
    if (remainingOpen.length > 0) {
      const nextPupil = openPupils[currIdx + 1] || remainingOpen[0];
      setSelectedPupilId(nextPupil.id);
    } else {
      setFolderTab('bewertet');
      setSelectedPupilId(selectedPupil.id);
    }
  };

  // Non-core vote submission
  const handleSaveNonCoreVote = async () => {
    if (!selectedPupil || !votedRank) return;
    setIsSavingVote(true);
    try {
      if (onSubmitPupil) {
        await onSubmitPupil(selectedPupil.id, votedRank, votedComment);
      }
      setSaveSuccessMsg(`Votum „${votedRank}“ für ${selectedPupil.fullName} erfolgreich gespeichert!`);
      const currIdx = openPupils.findIndex((p) => p.id === selectedPupil.id);
      const remainingOpen = openPupils.filter((p) => p.id !== selectedPupil.id);
      if (remainingOpen.length > 0) {
        const nextPupil = openPupils[currIdx + 1] || remainingOpen[0];
        setSelectedPupilId(nextPupil.id);
      } else {
        setFolderTab('bewertet');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSavingVote(false);
    }
  };

  const handleOpenDetailedRasterClick = () => {
    if (!selectedPupil) return;
    setShowNonCoreModal(true);
  };

  const handleConfirmOpenRaster = () => {
    if (selectedPupil) {
      setUnlockedRasterPupils((prev) => new Set(prev).add(selectedPupil.id));
    }
    setShowNonCoreModal(false);
  };

  const handleCloseRaster = (pupilId: number) => {
    setUnlockedRasterPupils((prev) => {
      const next = new Set(prev);
      next.delete(pupilId);
      return next;
    });
  };

  if (!selectedPupil) {
    return (
      <div className="p-8 text-center text-slate-500">
        Keine Schüler in dieser Klasse vorhanden.
      </div>
    );
  }

  const { rank, color: rankColor, pos: positiveTicks } = calculateRank(selectedPupil);
  const isSubmitted = selectedPupil.evaluations.some((e) =>
    canAccessRaster ? e.isSubmitted : (e.subjectCode === mySubjectCode && e.isSubmitted)
  );
  const submittedAt = selectedPupil.evaluations.find((e) =>
    canAccessRaster ? e.submittedAt : (e.subjectCode === mySubjectCode && e.submittedAt)
  )?.submittedAt;

  return (
    <div className="flex flex-col lg:flex-row gap-6">
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
      <div className="w-full lg:w-80 bg-slate-900 border border-slate-800 rounded-3xl p-4 flex flex-col max-h-[84vh] overflow-hidden shadow-lg">
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
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-sm font-bold'
                : 'text-slate-400 hover:text-slate-50'
            }`}
          >
            <Folder className="w-3.5 h-3.5" />
            <span>Offen</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
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
                ? 'bg-emerald-500 text-slate-950 shadow-md shadow-sm font-bold'
                : 'text-slate-400 hover:text-slate-50'
            }`}
          >
            <FolderCheck className="w-3.5 h-3.5" />
            <span>Bewertet</span>
            <span
              className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
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
              const pDone = p.evaluations.some((e) => e.isSubmitted);

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
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400">{pRank.pos}/18 Punkte</span>
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
                  </div>

                  <span
                    className={`px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider border flex-shrink-0 ${pRank.color}`}
                  >
                    {pRank.rank}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Column: Observation Grid for Selected Pupil */}
      <div className="flex-1 bg-slate-900 border border-slate-800 rounded-3xl p-6 flex flex-col max-h-[84vh] overflow-hidden shadow-lg">
        {/* Pupil Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-slate-800 mb-6">
          <div>
            <div className="flex items-center gap-3">
              <h2 className="text-2xl font-bold text-slate-50">{selectedPupil.fullName}</h2>
              <span className={`px-3 py-1 rounded-xl text-xs font-bold uppercase tracking-wider border ${rankColor}`}>
                {rank} ({positiveTicks}/18)
              </span>
              {isSubmitted && (
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Eingereicht</span>
                  </span>
                  {onReopenPupil && !isLockedByConference && (
                    <button
                      onClick={() => onReopenPupil(selectedPupil.id)}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-50 border border-slate-700 text-[11px] font-bold transition flex items-center gap-1"
                      title="Einreichung zurücknehmen und Bewertung weiter bearbeiten"
                    >
                      <RotateCcw className="w-3 h-3 text-amber-400" />
                      <span>Wieder öffnen</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Beobachtungsraster · 6 Dimensionen à 3 Merkmale
              {submittedAt && (
                <span className="ml-2 text-slate-500">
                  (Eingereicht am {new Date(submittedAt).toLocaleDateString('de-AT')} um {new Date(submittedAt).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })})
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Instant Rank Buttons & Reset (For core D/M/E teachers OR when raster is open) */}
            {(canAccessRaster || unlockedRasterPupils.has(selectedPupil.id)) && (
              <div className="flex items-center gap-1.5 bg-slate-950/70 p-1.5 rounded-2xl border border-slate-800">
                <span className="text-[11px] font-bold text-slate-400 px-1 hidden xl:inline">Sofort-Rang:</span>
                <button
                  onClick={() => handleInstantRank('Lehrling')}
                  disabled={isLockedByConference || isPastDeadline || isSubmitted}
                  title="Kriterien für Rang Lehrling ausfüllen (< 8 Punkte)"
                  className="px-2.5 py-1.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-xs font-bold transition active:scale-95 flex items-center gap-1 disabled:opacity-40"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500" />
                  <span>Lehrling</span>
                </button>
                <button
                  onClick={() => handleInstantRank('Geselle')}
                  disabled={isLockedByConference || isPastDeadline || isSubmitted}
                  title="Kriterien für Rang Geselle ausfüllen (8-13 Punkte)"
                  className="px-2.5 py-1.5 rounded-xl bg-blue-500/15 hover:bg-blue-500/30 text-blue-300 border border-blue-500/30 text-xs font-bold transition active:scale-95 flex items-center gap-1 disabled:opacity-40"
                >
                  <span className="w-2 h-2 rounded-full bg-blue-500" />
                  <span>Geselle</span>
                </button>
                <button
                  onClick={() => handleInstantRank('Meister')}
                  disabled={isLockedByConference || isPastDeadline || isSubmitted}
                  title="Kriterien für Rang Meister ausfüllen (14-18 Punkte)"
                  className="px-2.5 py-1.5 rounded-xl bg-amber-400/15 hover:bg-amber-400/30 text-amber-300 border border-amber-400/30 text-xs font-bold transition active:scale-95 flex items-center gap-1 disabled:opacity-40"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span>Meister</span>
                </button>
                <button
                  onClick={handleResetAll}
                  disabled={isLockedByConference || isPastDeadline || isSubmitted}
                  title="Alle 18 Bewertungen leeren / zurücksetzen"
                  className="px-2 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-50 border border-slate-700 text-xs font-bold transition active:scale-95 flex items-center gap-1 ml-1 disabled:opacity-40"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Reset</span>
                </button>
              </div>
            )}

            {/* Submit Ranking Button */}
            {(canAccessRaster || unlockedRasterPupils.has(selectedPupil.id)) && (
              <button
                onClick={handleSubmitPupil}
                disabled={isLockedByConference || isPastDeadline}
                title="Ranking einreichen und zum nächsten Schüler wechseln"
                className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-1.5 shadow-lg transition active:scale-95 disabled:opacity-40 ${
                  isSubmitted
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                    : 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 shadow-sm'
                }`}
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSubmitted ? 'Erneut einreichen' : 'Ranking einreichen'}</span>
              </button>
            )}

            {/* 1-Page Teacher Class Report Button */}
            {onOpenReportModal && (
              <button
                onClick={onOpenReportModal}
                className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition"
                title="1-Seiten Klassenbericht für Lehrpersonen drucken"
              >
                <Printer className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">1-Seiten Export</span>
              </button>
            )}

            {/* Card Drawer Button */}
            <button
              onClick={() => onOpenCardDrawer(selectedPupil.id, selectedPupil.fullName)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition"
            >
              <Award className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Karte</span>
            </button>

            {/* KEL Report Button */}
            <button
              onClick={() => onOpenKelReport(selectedPupil)}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 text-xs font-bold flex items-center gap-1.5 border border-slate-700 transition"
            >
              <FileText className="w-3.5 h-3.5 text-sky-400" />
              <span className="hidden sm:inline">KEL-Bericht</span>
            </button>
          </div>
        </div>

        {/* Optional Rank Voting for Non-Core Teachers */}
        {!canAccessRaster && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 shadow-xl mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-800 mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                  <Award className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-50 flex flex-wrap items-center gap-2">
                    <span>Optionales Rang-Voting</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 font-semibold">
                      {mySubject.name} (Nicht-Hauptfach)
                    </span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Sie unterrichten in dieser Klasse kein Hauptfach (D, M, E). Sie haben hier die Möglichkeit, für {selectedPupil.fullName} optional ein Rang-Voting für die Notenkonferenz abzugeben.
                  </p>
                </div>
              </div>

              {/* Toggle detailed raster button */}
              <button
                type="button"
                onClick={() => {
                  if (unlockedRasterPupils.has(selectedPupil.id)) {
                    handleCloseRaster(selectedPupil.id);
                  } else {
                    handleOpenDetailedRasterClick();
                  }
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-bold transition flex items-center gap-2 border self-start sm:self-auto shrink-0 ${
                  unlockedRasterPupils.has(selectedPupil.id)
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    : 'bg-gradient-to-r from-sky-500/20 to-sky-600/20 hover:from-sky-500/30 hover:to-sky-600/30 text-sky-200 border-sky-500/40 shadow-sm'
                }`}
              >
                <ClipboardList className="w-4 h-4 text-sky-400" />
                <span>
                  {unlockedRasterPupils.has(selectedPupil.id)
                    ? 'Bogen einklappen'
                    : 'Detaillierten Bewertungsbogen öffnen'}
                </span>
                {unlockedRasterPupils.has(selectedPupil.id) ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
            </div>

            {/* 3 Interactive Rank Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
              {[
                {
                  rank: 'Lehrling' as const,
                  label: 'Lehrling',
                  dot: 'bg-rose-500',
                  border: 'border-rose-500/30 hover:border-rose-500/60',
                  active: 'bg-rose-500/20 border-rose-500 text-rose-200 ring-2 ring-rose-500/50',
                  desc: 'Starke Unterstützung nötig / Basisstufe',
                },
                {
                  rank: 'Geselle' as const,
                  label: 'Geselle',
                  dot: 'bg-blue-500',
                  border: 'border-blue-500/30 hover:border-blue-500/60',
                  active: 'bg-blue-500/20 border-blue-500 text-blue-200 ring-2 ring-blue-500/50',
                  desc: 'Solide Leistungen / Regelanforderungen erfüllt',
                },
                {
                  rank: 'Meister' as const,
                  label: 'Meister',
                  dot: 'bg-amber-400',
                  border: 'border-amber-400/30 hover:border-amber-400/60',
                  active: 'bg-amber-400/20 border-amber-400 text-amber-200 ring-2 ring-amber-400/50',
                  desc: 'Eigenständig, vorbildlich & Spitzenleistung',
                },
              ].map((opt) => {
                const isSelected = votedRank === opt.rank;
                return (
                  <button
                    key={opt.rank}
                    type="button"
                    onClick={() => {
                      setVotedRank(opt.rank);
                      setSaveSuccessMsg(null);
                    }}
                    disabled={isLockedByConference || isPastDeadline}
                    className={`p-4 rounded-2xl border text-left transition flex flex-col justify-between min-h-[96px] ${
                      isSelected
                        ? opt.active
                        : `bg-slate-950/60 ${opt.border} text-slate-300`
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <div className="flex items-center gap-2">
                        <span className={`w-3 h-3 rounded-full ${opt.dot}`} />
                        <span className="font-bold text-sm text-slate-50">{opt.label}</span>
                      </div>
                      {isSelected && (
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Gewählt
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

            {/* Optional Comment Input */}
            <div className="mb-5">
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                Begründung / Anmerkung für die Konferenz (optional):
              </label>
              <textarea
                value={votedComment}
                onChange={(e) => {
                  setVotedComment(e.target.value);
                  setSaveSuccessMsg(null);
                }}
                disabled={isLockedByConference || isPastDeadline}
                rows={2}
                placeholder="z.B. Zeigt im Unterricht hohe Motivation, arbeitet zuverlässig in Gruppen..."
                className="w-full p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-amber-400 resize-none"
              />
            </div>

            {/* Save & Feedback Bar */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
              <div className="text-xs">
                {saveSuccessMsg ? (
                  <span className="text-emerald-400 font-bold flex items-center gap-1.5 animate-fadeIn">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>{saveSuccessMsg}</span>
                  </span>
                ) : (
                  <span className="text-slate-400 text-[11px]">
                    {votedRank ? (
                      <>Ausgewählter Rang: <strong className="text-amber-400">{votedRank}</strong></>
                    ) : (
                      'Wählen Sie einen Rang aus, um Ihr Votum einzureichen.'
                    )}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={handleSaveNonCoreVote}
                disabled={isLockedByConference || isPastDeadline || !votedRank || isSavingVote}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-emerald-500/20 transition active:scale-95 disabled:opacity-40"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>{isSavingVote ? 'Speichere...' : 'Rang-Voting speichern & einreichen'}</span>
              </button>
            </div>
          </div>
        )}

        {/* Detailed 18-Criteria Grid: Visible for Core Teachers OR if Unlocked by Non-Core Teacher */}
        {(canAccessRaster || unlockedRasterPupils.has(selectedPupil.id)) && (
          <div className="flex-1 overflow-y-auto space-y-6 pr-2">
            {/* Non-Core Info Banner inside the opened raster */}
            {!canAccessRaster && (
              <div className="bg-sky-500/10 border border-sky-500/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-sky-200">
                <div className="flex items-center gap-2.5">
                  <ClipboardList className="w-5 h-5 text-sky-400 shrink-0" />
                  <div>
                    <span className="font-bold block text-sky-100">
                      Detaillierter Beobachtungsbogen geöffnet (Für eigene Aufzeichnungen)
                    </span>
                    <span className="text-sky-300/80 text-[11px]">
                      Sie können alle 18 Merkmale mit Smileys bewerten. Diese Daten dienen Ihren persönlichen Notizen.
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => handleCloseRaster(selectedPupil.id)}
                  className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition flex items-center gap-1.5 self-start sm:self-auto shrink-0 border border-slate-700"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                  <span>Bogen schließen</span>
                </button>
              </div>
            )}
            {criteria.map((crit) => (
              <div
                key={crit.id}
                className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 mb-4 border-b border-slate-800/80 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-50 flex items-center gap-2">
                      <span>{crit.name}</span>
                    </h3>
                  </div>

                  {/* Category Quick Fill Buttons */}
                  <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
                    <span className="text-[10px] text-slate-500 uppercase font-bold px-1.5 hidden sm:inline">Kategorie:</span>
                    <button
                      type="button"
                      disabled={isLockedByConference || isPastDeadline || isSubmitted}
                      onClick={() => handleQuickFillCategory(crit, 'crown')}
                      title="Alle Merkmale dieser Kategorie mit Krone füllen"
                      className="pressable focus-ring min-h-[36px] min-w-[36px] rounded-lg bg-amber-400/15 hover:bg-amber-400/30 text-amber-300 flex items-center justify-center transition disabled:opacity-30"
                    >
                      <Crown className="w-4 h-4" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      disabled={isLockedByConference || isPastDeadline || isSubmitted}
                      onClick={() => handleQuickFillCategory(crit, 'smile')}
                      title="Alle Merkmale dieser Kategorie mit Gut (😊) füllen"
                      className="w-7 h-7 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                    >
                      😊
                    </button>
                    <button
                      type="button"
                      disabled={isLockedByConference || isPastDeadline || isSubmitted}
                      onClick={() => handleQuickFillCategory(crit, 'struggle')}
                      title="Alle Merkmale dieser Kategorie mit Mühe (😖) füllen"
                      className="w-7 h-7 rounded-lg bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                    >
                      😖
                    </button>
                    <button
                      type="button"
                      disabled={isLockedByConference || isPastDeadline || isSubmitted}
                      onClick={() => handleQuickFillCategory(crit, 'sad')}
                      title="Alle Merkmale dieser Kategorie mit Traurig (😢) füllen"
                      className="w-7 h-7 rounded-lg bg-rose-500/15 hover:bg-rose-500/30 text-rose-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                    >
                      😢
                    </button>
                    <button
                      type="button"
                      disabled={isLockedByConference || isPastDeadline || isSubmitted}
                      onClick={() => handleQuickFillCategory(crit, 'newstart')}
                      title="Alle Merkmale dieser Kategorie mit Neustart (🔄) füllen"
                      className="w-7 h-7 rounded-lg bg-sky-500/15 hover:bg-sky-500/30 text-sky-300 text-xs flex items-center justify-center transition disabled:opacity-30"
                    >
                      🔄
                    </button>
                    <button
                      type="button"
                      disabled={isLockedByConference || isPastDeadline || isSubmitted}
                      onClick={() => handleQuickFillCategory(crit, '')}
                      title="Kategorie leeren"
                      className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs flex items-center justify-center transition disabled:opacity-30"
                    >
                      ✕
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {crit.items.map((it) => {
                    const itemData = getItemData(selectedPupil, it.key);
                    const currentRating = itemData?.rating;
                    const currentVersion = itemData?.version || 1;

                    // Soft lock check
                    const lockKey = `${selectedPupil.id}_${it.key}`;
                    const softLock = softLocks.get(lockKey);

                    // 5 Smileys buttons
                    const ratingButtons = [
                      {
                        val: 'crown',
                        label: (
                          // Crowned smiley = "Meister". The five faces are the
                          // SMILE rating scale itself, not decoration, so they are kept
                          // as-is; only the deliberate negative-space stacking that
                          // made this look accidental was fixed.
                          <div className="flex flex-col items-center justify-center leading-none gap-0.5">
                            <span className="text-[11px] leading-none">👑</span>
                            <span className="text-lg leading-none">😊</span>
                          </div>
                        ),
                        activeBg: 'bg-amber-400 text-slate-950 font-bold shadow-lg shadow-sm scale-105 border-2 border-amber-300 ring-2 ring-amber-400/40',
                        title: 'Hervorragend (Krone)',
                      },
                      {
                        val: 'smile',
                        label: <span className="text-2xl leading-none">😊</span>,
                        activeBg: 'bg-emerald-500 text-slate-950 font-bold shadow-lg shadow-sm scale-105 border-2 border-emerald-300 ring-2 ring-emerald-500/40',
                        title: 'Gut (😊)',
                      },
                      {
                        val: 'struggle',
                        label: <span className="text-2xl leading-none">😖</span>,
                        activeBg: 'bg-amber-500 text-slate-950 font-bold shadow-lg shadow-sm scale-105 border-2 border-amber-300 ring-2 ring-amber-500/40',
                        title: 'Mit Mühe (😖)',
                      },
                      {
                        val: 'sad',
                        label: <span className="text-2xl leading-none">😢</span>,
                        activeBg: 'bg-rose-500 text-slate-50 font-bold shadow-lg shadow-sm scale-105 border-2 border-rose-300 ring-2 ring-rose-500/40',
                        title: 'Traurig (😢)',
                      },
                      {
                        val: 'newstart',
                        label: <span className="text-2xl leading-none">🔄</span>,
                        activeBg: 'bg-sky-500 text-slate-950 font-bold shadow-lg shadow-sm scale-105 border-2 border-sky-300 ring-2 ring-sky-500/40',
                        title: 'Neustart (🔄)',
                      },
                    ];

                    return (
                      <div
                        key={it.key}
                        className={`bg-slate-900 border rounded-2xl p-4 flex flex-col justify-between transition min-h-[160px] ${
                          softLock
                            ? 'border-amber-400/50 bg-amber-500/5'
                            : 'border-slate-800/80 hover:border-slate-700'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between mb-2">
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
                          <p className="text-xs text-slate-300 font-medium leading-relaxed mb-4">
                            {it.desc || it.label}
                          </p>
                        </div>

                        {/* Smileys Row */}
                        <div className="flex items-center justify-between gap-1 pt-2 border-t border-slate-800/60">
                          {ratingButtons.map((btn) => {
                            const isActive =
                              currentRating === btn.val ||
                              (btn.val === 'crown' && currentRating === '++') ||
                              (btn.val === 'smile' && currentRating === '+') ||
                              (btn.val === 'struggle' && currentRating === 'o') ||
                              (btn.val === 'sad' && currentRating === '-');

                            return (
                              <button
                                key={btn.val}
                                disabled={isLockedByConference || !!softLock || isPastDeadline || isSubmitted}
                                title={btn.title}
                                onFocus={() => onSendFocus(selectedPupil.id, it.key)}
                                onBlur={() => onSendBlur(selectedPupil.id, it.key)}
                                onClick={() => {
                                  // Tapping the active button deselects it to blank!
                                  const nextVal = isActive ? '' : btn.val;
                                  onRate(
                                    selectedPupil.id,
                                    crit.id,
                                    it.key,
                                    nextVal,
                                    currentVersion
                                  );
                                }}
                                className={`w-11 h-11 rounded-2xl flex items-center justify-center transition active:scale-90 disabled:opacity-40 ${
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
                              disabled={isLockedByConference || !!softLock || isPastDeadline || isSubmitted}
                              title="Bewertung löschen (Leer)"
                              onClick={() => {
                                onRate(
                                  selectedPupil.id,
                                  crit.id,
                                  it.key,
                                  '',
                                  currentVersion
                                );
                              }}
                              className="w-7 h-7 rounded-xl bg-slate-800/40 hover:bg-rose-500/20 text-slate-500 hover:text-rose-300 border border-slate-700/40 flex items-center justify-center text-xs font-bold transition ml-0.5"
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

      {/* Non-Core Observation Sheet Information Pop-Up */}
      {showNonCoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
            <div className="flex items-start gap-4 mb-4">
              <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
                <Info className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-50">
                  Hinweis zum Beobachtungsbogen
                </h3>
                <p className="text-xs text-amber-400 font-semibold mt-0.5">
                  Nicht-Hauptfach ({mySubject.name})
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs sm:text-sm text-slate-300 leading-relaxed bg-slate-950/60 p-4 rounded-2xl border border-slate-800/80 mb-6">
              <p className="font-bold text-slate-100 text-sm sm:text-base border-b border-slate-800 pb-2">
                „Der Beobachtungsbogen in Nicht-Hauptfächern ist nur für die eigenen Aufzeichnungen gedacht.“
              </p>
              <p className="text-xs text-slate-400">
                Die standardmäßige kriterienbasierte Einstufung im SMILE-System erfolgt über die Kernfächer (Deutsch, Mathematik, Englisch).
              </p>
              <p className="text-xs text-slate-400">
                Sie können das 18-Kriterien-Raster hier jedoch gerne vollständig für Ihre persönlichen Aufzeichnungen, Notizen und KEL-Gespräche nutzen.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setShowNonCoreModal(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={handleConfirmOpenRaster}
                className="px-5 py-2 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/20 transition active:scale-95"
              >
                <Check className="w-4 h-4" />
                <span>Verstanden, Bogen öffnen</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
