import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Award,
  CheckCircle2,
  AlertCircle,
  Users,
  Calendar,
  Check,
  RotateCcw,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Clock,
  ShieldAlert,
  Flame,
  LayoutGrid,
  Maximize2,
  FileText,
  UserCheck,
} from 'lucide-react';
import { SchoolClass, User } from '../types';
import { getConferenceSummary, voteConference, voteAllConference } from '../services/api';
import { describeParticipation } from '../lib/conferenceParticipation';
import { useConfirm } from './ConfirmDialog';
import { Meter, useDialogA11y } from './ui';
import { formatConfirmationTimestamp } from '../lib/confirmationTime';
import {
  getRankVisuals,
  type SubjectEvidenceItem,
} from '../lib/conferenceEvidence';

interface TeacherVote {
  teacherId: number;
  teacherShort: string;
  teacherName: string;
  subjectCode: string;
  proposedStatus?: string | null;
  nextStep?: string | null;
  comment?: string | null;
  isSubmitted: boolean;
  submittedAt?: string | null;
  positiveCount: number;
  totalRated: number;
  hours?: number;
  weight?: number;
  isTeamTeaching?: boolean;
}

interface CardItem {
  id: string;
  teacherShort: string;
  teacherName: string;
  note?: string | null;
  createdAt: string;
}

/** One teacher who proposed a rank other than the one the board decided on. */
export interface DissentingVote {
  teacherShort: string;
  teacherName: string;
  subjectCode: string;
  proposedStatus: string;
  /** Weekly lessons this vote carried, which is the weight behind the dissent. */
  hours: number;
  /** The teacher's own justification, when they wrote one. */
  comment?: string | null;
}

/**
 * The votes that disagree with the rank the conference just decided.
 *
 * A decision is a weighted majority, never unanimity, and the board is entitled
 * to see who disagreed before the stamp goes on: "2 Gegenstimmen (6h Lehrling)"
 * is the sentence that stops a hasty confirmation. Only submitted votes count —
 * a teacher who never cast a ballot is missing, not dissenting.
 */
export function dissentingVotes(
  teacherVotes: TeacherVote[],
  decidedRank: string | null | undefined,
): DissentingVote[] {
  if (!decidedRank) return [];
  return teacherVotes
    .filter((tv) => tv.isSubmitted && tv.proposedStatus && tv.proposedStatus !== decidedRank)
    .map((tv) => ({
      teacherShort: tv.teacherShort,
      teacherName: tv.teacherName,
      subjectCode: tv.subjectCode,
      proposedStatus: tv.proposedStatus as string,
      hours: tv.hours ?? 2,
      comment: tv.comment ?? null,
    }));
}

/** The one-line summary of a dissent, or null when the decision was unanimous. */
export function describeDissent(dissenters: DissentingVote[]): string | null {
  if (dissenters.length === 0) return null;
  // Group by the rank they proposed, so "6h Lehrling" reads as one position
  // rather than two unrelated teachers.
  const byRank = new Map<string, number>();
  for (const d of dissenters) {
    byRank.set(d.proposedStatus, (byRank.get(d.proposedStatus) ?? 0) + d.hours);
  }
  const positions = [...byRank.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([rank, hours]) => `${hours}h ${rank}`)
    .join(', ');
  return `${dissenters.length} Gegenstimme${dissenters.length === 1 ? '' : 'n'} (${positions})`;
}

interface ConferencePupil {
  id: number;
  fullName: string;
  /**
   * The 18-item raster per subject, as decision *support*. It is deliberately not
   * aggregated into a rank: summing it across core subjects made three teachers who
   * each rated a pupil 6/18 produce a "Meister", and that number was what the screen
   * fell back to whenever nobody had confirmed anything.
   */
  subjectEvidence: SubjectEvidenceItem[];
  /** null = no teacher has voted yet. Never back-filled with a computed value. */
  suggestedRank: 'Lehrling' | 'Geselle' | 'Meister' | null;
  /** null = the conference has not decided this pupil. */
  finalRank: 'Lehrling' | 'Geselle' | 'Meister' | null;
  hasRedCardDemotion: boolean;
  isConfirmed: boolean;
  confirmedAt?: string | null;
  /**
   * Measured only from submitted evaluations. The previous votesYes/votesNo/totalVoters
   * triple was derived from the class roster minus a number an administrator typed, so a
   * teacher who never voted counted as agreeing.
   */
  participation?: {
    submittedTeachers: number;
    eligibleTeachers: number;
    teachersMissing: number;
  };
  overrideReason?: string | null;
  evaluationsCount: number;
  teacherVotes: TeacherVote[];
  voteStats: {
    Lehrling: number;
    Geselle: number;
    Meister: number;
    hoursLehrling?: number;
    hoursGeselle?: number;
    hoursMeister?: number;
    totalVotedHours?: number;
    pctLehrling?: number;
    pctGeselle?: number;
    pctMeister?: number;
    suggestedRankByHours?: 'Lehrling' | 'Geselle' | 'Meister' | null;
    weightedRank?: 'Lehrling' | 'Geselle' | 'Meister' | null;
  };
  cards: {
    green: CardItem[];
    yellow: CardItem[];
    red: CardItem[];
  };
}

type VoteRank = 'Lehrling' | 'Geselle' | 'Meister' | null;

/**
 * Rebuild the vote map from a fresh summary without discarding the chair's work.
 *
 * loadData() runs after every single accept/withdraw, and it used to rebuild
 * pupilVotes from the server response alone. In table mode that silently replaced
 * every rank the chair had changed for other pupils with the server's suggestion,
 * so the subsequent "Klasse bestätigen" submitted ranks nobody had chosen. Keep a
 * local rank when it differs from what the server currently proposes and the pupil
 * is not confirmed yet; everything else follows the server so co-chairs' decisions
 * still appear.
 */
function mergeVotes(
  summary: ConferencePupil[],
  previous: Record<number, { rank: VoteRank }>,
): Record<number, { rank: VoteRank }> {
  const next: Record<number, { rank: VoteRank }> = {};
  for (const pupil of summary) {
    const serverRank = pupil.finalRank ?? pupil.suggestedRank ?? null;
    const localRank = previous[pupil.id]?.rank ?? null;
    const keepLocal = !pupil.isConfirmed && localRank !== null && localRank !== serverRank;
    next[pupil.id] = { rank: keepLocal ? localRank : serverRank };
  }
  return next;
}

interface ConferenceVotingModalProps {
  classes: SchoolClass[];
  initialClassId: number;
  currentUser?: User | null;
  onClose: () => void;
  onOpenAllClassesExport?: () => void;
  onVotesUpdated?: () => void;
  /** Test/embedding seam; production defaults to the editable list. */
  initialViewMode?: 'walkthrough' | 'table';
}

export const ConferenceVotingModal: React.FC<ConferenceVotingModalProps> = ({
  classes,
  initialClassId,
  currentUser,
  onClose,
  onOpenAllClassesExport,
  onVotesUpdated,
  initialViewMode = 'table',
}) => {
  const [selectedClassId, setSelectedClassId] = useState<number>(initialClassId);
  const [loading, setLoading] = useState(true);
  const [totalTeachers, setTotalTeachers] = useState(1);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [pupils, setPupils] = useState<ConferencePupil[]>([]);
  const [currentPupilIndex, setCurrentPupilIndex] = useState<number>(0);
  const [submittingId, setSubmittingId] = useState<number | null>(null);
  const [batchSubmitting, setBatchSubmitting] = useState(false);
  const confirm = useConfirm();
  const [error, setError] = useState<string | null>(null);
  // The editable list is the default working surface; the walkthrough remains
  // available for the beamer/presentation.
  const [viewMode, setViewMode] = useState<'walkthrough' | 'table'>(initialViewMode);

  // Local state for vote adjustments per pupil before submitting. `null` is a
  // real state for a pupil the conference has not decided yet; it must not be
  // sent to the server as if it were a rank.
  const [pupilVotes, setPupilVotes] = useState<
    Record<number, { rank: 'Lehrling' | 'Geselle' | 'Meister' | null }>
  >({});
  const loadGenerationRef = useRef(0);
  const currentPupilIdRef = useRef<number | null>(null);
  // The class the modal is showing *now*; a response for any other class is stale.
  const selectedClassIdRef = useRef(selectedClassId);

  const formatTimestamp = formatConfirmationTimestamp;

  const currentClass = classes.find((c) => c.id === selectedClassId) || classes[0];
  const currentClassIndex = classes.findIndex((c) => c.id === selectedClassId);

  // Check if current user is KV for the selected class
  const teacherShort = currentUser?.teacher?.shortName?.toUpperCase();
  const isHeadmaster =
    currentUser?.role === 'admin' ||
    teacherShort === 'MED' ||
    teacherShort === 'SLC' ||
    currentUser?.username?.toUpperCase() === 'MED' ||
    currentUser?.username?.toUpperCase() === 'SLC';

  const isClassKv = Boolean(
    currentClass &&
      teacherShort &&
      ((currentClass.headTeacher1 && currentClass.headTeacher1.toUpperCase().includes(teacherShort)) ||
        (currentClass.headTeacher2 && currentClass.headTeacher2.toUpperCase().includes(teacherShort)))
  );

  const loadData = async (cid: number, resetToFirstPupil = false) => {
    // A vote for class 1A can finish after the chair has switched to 2B. Applying
    // it would show 1A's pupils under 2B's header and make the old response the
    // newest generation, discarding the load that actually belongs on screen.
    if (cid !== selectedClassIdRef.current) return;
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getConferenceSummary(cid);
      if (generation !== loadGenerationRef.current) return;
      if (cid !== selectedClassIdRef.current) return;
      const summary: ConferencePupil[] = data.summary || [];
      setTotalTeachers(data.totalClassTeachers || 1);
      setIsAuthorized(data.isAuthorized);
      setPupils(summary);

      // Keep the chair on the same pupil after a vote; only a class change
      // starts the walkthrough from the first pupil.
      const previousPupilId = currentPupilIdRef.current;
      const previousIndex = previousPupilId
        ? summary.findIndex((pupil) => pupil.id === previousPupilId)
        : -1;
      setCurrentPupilIndex(
        resetToFirstPupil || previousIndex < 0 ? 0 : previousIndex,
      );

      // An undecided pupil starts from the hours-weighted suggestion. Sending
      // null to /vote is rejected by the server and leaves the board stuck.
      setPupilVotes((previous) => mergeVotes(summary, previous));
    } catch (e: any) {
      if (generation !== loadGenerationRef.current) return;
      setError(e.message || 'Fehler beim Laden der Konferenzdaten');
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedClassId) {
      selectedClassIdRef.current = selectedClassId;
      currentPupilIdRef.current = null;
      void loadData(selectedClassId, true);
    }
  }, [selectedClassId]);

  // Remember the pupil currently on screen so a post-vote reload can keep it.
  useEffect(() => {
    currentPupilIdRef.current = pupils[currentPupilIndex]?.id ?? null;
  }, [pupils, currentPupilIndex]);

  // Keyboard navigation for pupil walk-through
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode !== 'walkthrough') return;
      // Never move the pupil selection while the chair is typing a comment.
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'ArrowLeft') {
        goToPrevPupil();
      } else if (e.key === 'ArrowRight') {
        goToNextPupil();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentPupilIndex, pupils.length, viewMode]);

  const handleRankChange = (pupilId: number, rank: 'Lehrling' | 'Geselle' | 'Meister') => {
    setPupilVotes((prev) => ({
      ...prev,
      [pupilId]: {
        ...prev[pupilId],
        rank,
      },
    }));
  };

  // Toggle acceptance (Angenommen / Zurücknehmen)
  const handleToggleVoteSingle = async (p: ConferencePupil) => {
    const cur = pupilVotes[p.id] || { rank: p.finalRank ?? p.suggestedRank ?? null };
    if (!p.isConfirmed && !cur.rank) {
      setError('Für diese Schüler/in liegt noch kein Rangvorschlag vor. Bitte zuerst einen Rang wählen.');
      return;
    }
    setSubmittingId(p.id);
    setError(null);
    try {
      if (p.isConfirmed) {
        // Toggle OFF / Revoke accidental acceptance. The server does not need a
        // rank for an unconfirm, so an absent rank is sent as an omitted field.
        await voteConference(
          selectedClassId,
          p.id,
          cur.rank ?? undefined,
          undefined,
          'unconfirm'
        );
      } else {
        // Confirm with official conference timestamp
        await voteConference(
          selectedClassId,
          p.id,
          cur.rank ?? undefined,
          `Beschluss der Klassenkonferenz vom ${new Date().toLocaleDateString('de-AT')}`,
          'confirm'
        );
      }
      await loadData(selectedClassId);
      if (onVotesUpdated) onVotesUpdated();
    } catch (e: any) {
      setError(e.message || 'Fehler beim Speichern des Konferenzbeschlusses');
    } finally {
      setSubmittingId(null);
    }
  };

  const handleAcceptAllProposals = async () => {
    const ok = await confirm({
      title: `Alle ${pupils.length} Einstufungen annehmen?`,
      message: `Alle vorgeschlagenen Einstufungen für Klasse ${currentClass?.name} werden als Beschluss erfasst. Die Beteiligung je Schüler/in bleibt dabei sichtbar. Einzelne Entscheidungen lassen sich danach zurücknehmen.`,
      confirmLabel: 'Alle annehmen',
      tone: 'danger',
    });
    if (!ok) return;
    setBatchSubmitting(true);
    setError(null);
    try {
      const items = pupils.map((p) => {
        const cur = pupilVotes[p.id];
        return {
          pupilId: p.id,
          rank: cur?.rank ?? p.finalRank ?? p.suggestedRank ?? null,
        };
      });
      const undecided = items.filter((item) => !item.rank);
      if (undecided.length > 0) {
        setError(
          `${undecided.length} Schüler/in(nen) haben noch keinen Rangvorschlag. Bitte einzeln entscheiden oder zuerst einen Rang wählen.`,
        );
        return;
      }
      await voteAllConference(selectedClassId, items as Array<{ pupilId: number; rank: string }>);
      await loadData(selectedClassId);
      if (onVotesUpdated) onVotesUpdated();
    } catch (e: any) {
      setError(e.message || 'Fehler beim Stapel-Beschluss');
    } finally {
      setBatchSubmitting(false);
    }
  };

  const goToPrevClass = () => {
    if (currentClassIndex > 0) {
      setSelectedClassId(classes[currentClassIndex - 1].id);
    }
  };

  const goToNextClass = () => {
    if (currentClassIndex < classes.length - 1) {
      setSelectedClassId(classes[currentClassIndex + 1].id);
    }
  };

  const goToPrevPupil = () => {
    if (currentPupilIndex > 0) {
      setCurrentPupilIndex((prev) => prev - 1);
    }
  };

  const goToNextPupil = () => {
    if (currentPupilIndex < pupils.length - 1) {
      setCurrentPupilIndex((prev) => prev + 1);
    }
  };

  // Full-screen modal: shared focus trap, initial focus, Escape and focus restore.
  const {
    dialogRef,
    handleKeyDown: handleDialogKeyDown,
    initialFocusRef: closeButtonRef,
  } = useDialogA11y({ onClose, labelledBy: 'conference-mode-title' });

  const confirmedCount = pupils.filter((p) => p.isConfirmed).length;
  const rankForPupil = (p: ConferencePupil) =>
    pupilVotes[p.id]?.rank ?? p.finalRank ?? p.suggestedRank ?? null;
  const missingRankCount = pupils.filter((p) => !rankForPupil(p)).length;
  const currentPupil = pupils[currentPupilIndex];

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conference-mode-title"
      tabIndex={-1}
      onKeyDown={handleDialogKeyDown}
      className="fixed inset-0 z-50 bg-slate-950 flex flex-col w-screen h-screen overflow-hidden text-slate-100"
    >
      {/* Top Vollbild Header Bar */}
      <div className="p-3.5 px-6 border-b border-slate-800 bg-slate-900/90 flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-amber-400 animate-pulse" />
            <h1 id="conference-mode-title" className="text-xl font-bold text-slate-50 tracking-tight flex items-center gap-2">
              <span>Konferenz-Modus</span>
              <span className="text-sm px-2.5 py-0.5 rounded-lg bg-amber-500/20 text-amber-300 border border-amber-500/30 uppercase font-bold tracking-wider">
                {isHeadmaster ? 'Schulleitung (MED & SLC)' : isClassKv ? 'Klassenvorstand' : 'Konferenz'}
              </span>
            </h1>
          </div>

          {/* Class Stepper & Pills */}
          <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-2xl border border-slate-800">
            <button
              onClick={goToPrevClass}
              disabled={currentClassIndex <= 0}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-50 disabled:opacity-30 transition"
              title="Vorherige Klasse"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1 overflow-x-auto max-w-md px-1">
              {classes.map((cls) => {
                const isThisClassKv = Boolean(
                  teacherShort &&
                    ((cls.headTeacher1 && cls.headTeacher1.toUpperCase().includes(teacherShort)) ||
                      (cls.headTeacher2 && cls.headTeacher2.toUpperCase().includes(teacherShort)))
                );

                return (
                  <button
                    key={cls.id}
                    onClick={() => setSelectedClassId(cls.id)}
                    className={`px-3 py-1 rounded-xl font-bold text-sm transition flex items-center gap-1 ${
                      selectedClassId === cls.id
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-sm'
                        : 'text-slate-400 hover:text-slate-50 hover:bg-slate-800'
                    }`}
                  >
                    <span>{cls.name}</span>
                    {isThisClassKv && (
                      <span className="w-1.5 h-1.5 rounded-full bg-sky-400" title="Klassenvorstand" />
                    )}
                  </button>
                );
              })}
            </div>

            <button
              onClick={goToNextClass}
              disabled={currentClassIndex >= classes.length - 1}
              className="p-1.5 rounded-xl hover:bg-slate-800 text-slate-400 hover:text-slate-50 disabled:opacity-30 transition"
              title="Nächste Klasse"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Right Action Controls & View Switcher */}
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-3 text-sm text-slate-400">
            <span className="flex items-center gap-1 text-amber-400 font-bold bg-amber-400/10 px-2.5 py-1 rounded-xl border border-amber-400/20">
              <Calendar className="w-3.5 h-3.5" />
              03.11.2026
            </span>
            <span className="flex items-center gap-1 text-slate-300 font-medium">
              <Users className="w-3.5 h-3.5 text-sky-400" />
              {totalTeachers} Lehrpersonen ({currentClass?.name})
            </span>
            <span className="bg-slate-800 px-3 py-1 rounded-xl text-slate-300 font-bold border border-slate-700">
              Beschlüsse: <strong className="text-slate-50">{confirmedCount}</strong> / {pupils.length}
            </span>
          </div>

          {/* View Mode Toggle: Walk-Through Presentation vs Overview Table */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-xl border border-slate-800">
            <button
              onClick={() => setViewMode('walkthrough')}
              className={`px-2.5 py-1 rounded-lg text-sm font-bold transition flex items-center gap-1 ${
                viewMode === 'walkthrough'
                  ? 'bg-slate-800 text-slate-50 shadow-sm'
                  : 'text-slate-400 hover:text-slate-50'
              }`}
              title="Präsentationsansicht (Schüler für Schüler)"
            >
              <Maximize2 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Präsentation</span>
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-2.5 py-1 rounded-lg text-sm font-bold transition flex items-center gap-1 ${
                viewMode === 'table'
                  ? 'bg-slate-800 text-slate-50 shadow-sm'
                  : 'text-slate-400 hover:text-slate-50'
              }`}
              title="Liste zum Bearbeiten: Vorschläge vorausgewählt"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Bearbeiten</span>
            </button>
          </div>

          {/* All Classes PDF Export */}
          {onOpenAllClassesExport && (
            <button
              onClick={onOpenAllClassesExport}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-slate-50 font-bold text-sm flex items-center gap-1.5 transition border border-slate-700 shadow-sm"
              title="Gesamtexport aller Klassen (1 Seite pro Klasse) vor und nach der Konferenz als PDF"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden sm:inline">Gesamtexport (PDF)</span>
              <span className="sm:hidden">PDF</span>
            </button>
          )}

          {isAuthorized && pupils.length > 0 && (
            <button
              onClick={handleAcceptAllProposals}
              disabled={batchSubmitting}
              className="px-3.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center gap-1.5 transition shadow-lg shadow-sm disabled:opacity-50"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>{batchSubmitting ? 'Speichere...' : 'Alle annehmen'}</span>
            </button>
          )}

          <button
            ref={closeButtonRef}
            onClick={onClose}
            className="pressable focus-ring p-2 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 hover:bg-slate-700 transition"
            title="Vollbild schließen"
            aria-label="Konferenz-Modus schließen"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Error notification */}
      {error && (
        <div className="px-6 py-2.5 bg-red-500/15 border-b border-red-500/30 text-sm text-red-300 flex items-center gap-2 flex-shrink-0">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-slate-400 text-sm">
          Lade Konferenzdaten für Klasse {currentClass?.name}...
        </div>
      ) : pupils.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
          Keine aktiven Schüler in Klasse {currentClass?.name} gefunden.
        </div>
      ) : viewMode === 'walkthrough' && currentPupil ? (
        /* ========================================================================= */
        /* WALKTHROUGH PRESENTATION MODE (Schüler für Schüler Beamer-Präsentation)   */
        /* ========================================================================= */
        <div data-mode="beamer" className="flex-1 flex flex-col justify-between overflow-y-auto p-4 md:p-6 max-w-6xl w-full mx-auto">
          {(() => {
            const p = currentPupil;
            const cur = pupilVotes[p.id] || {
              rank: p.finalRank ?? p.suggestedRank ?? null,
            };

            // Derived only from submitted evaluations. No roster-derived headcount.
            const participation = describeParticipation(p.participation, p.voteStats);

            // Badge colour for this pupil's decided rank, from the shared
            // helper so the conference view and the assessment grid agree.
            // The evidence bars below carry their own per-subject colour and
            // deliberately do NOT use this pupil-level colour.
            const { badgeBg } = getRankVisuals(cur.rank);

            // Who disagreed with the rank on screen, while the board is still
            // looking at the decision card and can still change its mind.
            const dissent = dissentingVotes(p.teacherVotes, cur.rank);
            const dissentSummary = describeDissent(dissent);

            const isSubmitting = submittingId === p.id;
            const greenCards = p.cards?.green || [];
            const yellowCards = p.cards?.yellow || [];
            const redCards = p.cards?.red || [];

            return (
              <div className="space-y-5">
                {/* 1. Top Pupil Header & Rank Banner */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 md:p-6 shadow-lg">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <div className="flex items-center gap-2 text-sm text-slate-400 font-bold mb-1">
                        <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-slate-300">
                          Schüler {currentPupilIndex + 1} von {pupils.length}
                        </span>
                        <span>· Klasse {currentClass?.name}</span>
                        {p.isConfirmed && (
                          <span className="inline-flex items-center gap-1 text-emerald-400 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Beschluss erfasst</span>
                          </span>
                        )}
                      </div>
                      <h2 className="text-2xl md:text-3xl font-bold text-slate-50 tracking-tight">
                        {p.fullName}
                      </h2>
                    </div>

                    {/* Rank Badge & Red Card Demotion Indicator */}
                    <div className="flex items-center gap-3">
                      {p.hasRedCardDemotion && (
                        <div className="px-3 py-1 rounded-xl bg-rose-500/20 border border-rose-500/50 text-rose-200 text-sm font-bold flex items-center gap-1.5 animate-pulse">
                          <ShieldAlert className="w-4 h-4 text-rose-400" />
                          <span>Degradiert durch Karten</span>
                        </div>
                      )}

                      <div className={`px-4 py-1.5 rounded-2xl text-base font-bold uppercase tracking-wider border shadow-md ${badgeBg}`}>
                        {cur.rank}
                      </div>
                    </div>
                  </div>

                  {/* Hours-Weighted Breakdown */}
                  <div className="mt-4 pt-3 border-t border-slate-800/80 space-y-3">
                    {/* Hours-Weighted Breakdown Bar */}
                    {p.voteStats?.totalVotedHours ? (
                      <div className="pt-2.5 border-t border-slate-800/60">
                        <div className="flex flex-wrap items-center justify-between text-sm text-slate-400 mb-1.5 gap-2">
                          <span className="flex items-center gap-1.5 text-slate-300 font-medium">
                            <span>⚖️</span>
                            <span>Gewichtung nach Unterrichtsstunden ({p.voteStats.totalVotedHours} Wochenstunden):</span>
                          </span>
                          <span className="flex items-center gap-1.5">
                            <span>Vorschlag nach Stunden:</span>
                            <strong className="text-amber-300 font-bold">{p.suggestedRank ?? 'keine Mehrheit'}</strong>
                            {p.hasRedCardDemotion && (
                              <span className="text-2xs text-rose-400 font-semibold" title={`Ohne Karten wäre die Einordnung ${p.suggestedRank ?? 'offen'}`}>
                                
                              </span>
                            )}
                          </span>
                        </div>
                        {/* Segmented color bar of voted hours */}
                        <div className="w-full h-3.5 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800 divide-x divide-slate-950/60 shadow-inner">
                          {(p.voteStats.pctMeister || 0) > 0 && (
                            <Meter
                              value={(p.voteStats.pctMeister || 0)}
                              className="h-full bg-amber-400 transition-all duration-300"
                              title={`Meister: ${p.voteStats.hoursMeister}h (${p.voteStats.pctMeister}%)`}
                            />
                          )}
                          {(p.voteStats.pctGeselle || 0) > 0 && (
                            <Meter
                              value={(p.voteStats.pctGeselle || 0)}
                              className="h-full bg-blue-500 transition-all duration-300"
                              title={`Geselle: ${p.voteStats.hoursGeselle}h (${p.voteStats.pctGeselle}%)`}
                            />
                          )}
                          {(p.voteStats.pctLehrling || 0) > 0 && (
                            <Meter
                              value={(p.voteStats.pctLehrling || 0)}
                              className="h-full bg-rose-500 transition-all duration-300"
                              title={`Lehrling: ${p.voteStats.hoursLehrling}h (${p.voteStats.pctLehrling}%)`}
                            />
                          )}
                        </div>
                        <div className="flex items-center justify-between text-2xs font-bold text-slate-400 mt-1">
                          <span className="text-amber-300">👑 Meister: {p.voteStats.hoursMeister || 0}h ({p.voteStats.pctMeister || 0}%)</span>
                          <span className="text-blue-300">🔵 Geselle: {p.voteStats.hoursGeselle || 0}h ({p.voteStats.pctGeselle || 0}%)</span>
                          <span className="text-rose-300">🔴 Lehrling: {p.voteStats.hoursLehrling || 0}h ({p.voteStats.pctLehrling || 0}%)</span>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* 2. Statistical Breakdown: What each teacher voted */}
                <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 pb-2 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <FileText className="w-4 h-4 text-amber-400" />
                      <h3 className="font-bold text-slate-50 text-sm uppercase tracking-wider">
                        Lehrer-Votings &amp; Vorschläge ({p.teacherVotes?.length || 0} {(p.teacherVotes?.length || 0) === 1 ? 'Rückmeldung' : 'Rückmeldungen'} · {p.voteStats?.totalVotedHours || 0}h gewichtet)
                      </h3>
                    </div>

                    {/* Quick proposals summary tally */}
                    <div className="flex flex-wrap items-center gap-2 text-sm font-bold">
                      <span className="px-2 py-0.5 rounded-lg bg-amber-400/20 text-amber-300 border border-amber-400/30" title={`${p.voteStats?.hoursMeister || 0} Wochenstunden für Meister`}>
                        {p.voteStats?.hoursMeister !== undefined ? `${p.voteStats.hoursMeister}h` : `${p.voteStats?.Meister || 0}x`} Meister
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-blue-500/20 text-blue-300 border border-blue-500/30" title={`${p.voteStats?.hoursGeselle || 0} Wochenstunden für Geselle`}>
                        {p.voteStats?.hoursGeselle !== undefined ? `${p.voteStats.hoursGeselle}h` : `${p.voteStats?.Geselle || 0}x`} Geselle
                      </span>
                      <span className="px-2 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30" title={`${p.voteStats?.hoursLehrling || 0} Wochenstunden für Lehrling`}>
                        {p.voteStats?.hoursLehrling !== undefined ? `${p.voteStats.hoursLehrling}h` : `${p.voteStats?.Lehrling || 0}x`} Lehrling
                      </span>
                    </div>
                  </div>

                  {p.teacherVotes && p.teacherVotes.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {p.teacherVotes.map((tv, i) => (
                        <article
                          key={`${tv.teacherId}-${tv.subjectCode}-${i}`}
                          aria-label={`${tv.subjectCode} · ${tv.teacherShort}`}
                          className="bg-slate-950/70 border border-slate-800/80 rounded-2xl p-3 flex flex-col justify-between"
                        >
                          <div>
                            <div className="flex items-center justify-between gap-2 mb-1.5">
                              <span className="font-bold text-slate-50 text-sm">
                                {tv.subjectCode} · {tv.teacherShort}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-lg text-2xs font-bold uppercase border ${
                                  !tv.isSubmitted
                                    ? 'bg-slate-800 text-slate-400 border-slate-700'
                                    : tv.proposedStatus === 'Meister'
                                      ? 'bg-amber-400/20 text-amber-300 border-amber-400/40'
                                      : tv.proposedStatus === 'Geselle'
                                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/40'
                                        : 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                }`}
                              >
                                {tv.isSubmitted ? tv.proposedStatus || 'Ausstehend' : 'Ausstehend'}
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-1.5 text-2xs text-slate-400 mb-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 font-bold text-amber-300">
                                ⏱️ {tv.hours ?? 2}h / Woche
                              </span>
                              {tv.isTeamTeaching && (
                                <span className="px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold" title="Hauptfach Team-Teaching (D, M, E)">
                                  Team-Teaching
                                </span>
                              )}
                              {tv.isSubmitted && (
                                <span className="text-slate-400">
                                  (Gewicht: {tv.weight ?? tv.hours ?? 2})
                                </span>
                              )}
                            </div>

                            {tv.isSubmitted && (
                              <div className="text-2xs text-slate-400 mb-1">
                                Kriterien: <strong className="text-slate-200">{tv.positiveCount}</strong> positiv
                              </div>
                            )}

                            {tv.isSubmitted && tv.comment && (
                              <p className="text-2xs text-slate-300 italic bg-slate-900/60 p-2 rounded-xl border border-slate-800">
                                &bdquo;{tv.comment}&ldquo;
                              </p>
                            )}
                          </div>

                          {tv.isSubmitted && tv.nextStep && (
                            <div className="text-2xs text-slate-400 mt-2 pt-1.5 border-t border-slate-800/60 truncate">
                              Nächster Schritt: <span className="text-slate-200">{tv.nextStep}</span>
                            </div>
                          )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500 py-3 italic text-center">
                      Noch keine detaillierten Beobachtungsbögen der Fachlehrer für diesen Schüler abgegeben.
                    </p>
                  )}
                </div>

                {/* 3. Verhaltenskarten mit Infotext (Grün, Gelb, Rot) */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Grüne Karten */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-lg flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                        <span className="font-bold text-sm text-emerald-400 flex items-center gap-1.5">
                          <span>★</span>
                          <span>Grüne Karten</span>
                        </span>
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/20 text-emerald-300 text-sm font-bold border border-emerald-500/30">
                          {greenCards.length}
                        </span>
                      </div>

                      {greenCards.length > 0 ? (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {greenCards.map((c) => (
                            <div key={c.id} className="p-2 rounded-xl bg-emerald-500/5 border border-emerald-500/20 text-sm">
                              <div className="text-2xs text-slate-400 font-bold mb-0.5">
                                von {c.teacherShort} · {new Date(c.createdAt).toLocaleDateString('de-AT')}
                              </div>
                              <div className="text-slate-200">{c.note || 'Kein Text hinterlegt'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 py-4 text-center italic">
                          Keine grünen Karten vorhanden.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Gelbe Karten */}
                  <div className="bg-slate-900 border border-slate-800 rounded-3xl p-4 shadow-lg flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                        <span className="font-bold text-sm text-amber-400 flex items-center gap-1.5">
                          <span>▲</span>
                          <span>Gelbe Karten</span>
                        </span>
                        <span className={`px-2 py-0.5 rounded-lg text-sm font-bold border ${
                          yellowCards.length >= 2
                            ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'
                            : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                        }`}>
                          {yellowCards.length} {yellowCards.length >= 2 ? '(Mahnstufe)' : ''}
                        </span>
                      </div>

                      {yellowCards.length > 0 ? (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {yellowCards.map((c) => (
                            <div key={c.id} className="p-2 rounded-xl bg-amber-500/5 border border-amber-500/20 text-sm">
                              <div className="text-2xs text-slate-400 font-bold mb-0.5">
                                von {c.teacherShort} · {new Date(c.createdAt).toLocaleDateString('de-AT')}
                              </div>
                              <div className="text-slate-200">{c.note || 'Kein Text hinterlegt'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 py-4 text-center italic">
                          Keine gelben Karten vorhanden.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Rote Karten */}
                  <div className={`bg-slate-900 border rounded-3xl p-4 shadow-lg flex flex-col justify-between ${
                    redCards.length > 0 ? 'border-rose-500/60 shadow-sm' : 'border-slate-800'
                  }`}>
                    <div>
                      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                        <span className="font-bold text-sm text-rose-400 flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Rote Karten (Rangverlust)</span>
                        </span>
                        <span className={`px-2 py-0.5 rounded-lg text-sm font-bold border ${
                          redCards.length > 0
                            ? 'bg-rose-500/30 text-rose-200 border-rose-500/60 shadow-md shadow-sm'
                            : 'bg-slate-800 text-slate-400 border-slate-700'
                        }`}>
                          {redCards.length} {redCards.length > 0 ? '(Rangverlust)' : ''}
                        </span>
                      </div>

                      {redCards.length > 0 ? (
                        <div className="space-y-2 max-h-36 overflow-y-auto pr-1">
                          {redCards.map((c) => (
                            <div key={c.id} className="p-2 rounded-xl bg-rose-500/15 border border-rose-500/40 text-sm">
                              <div className="text-2xs text-rose-300 font-bold mb-0.5 flex items-center gap-1">
                                <ShieldAlert className="w-3 h-3 text-rose-400" />
                                <span>von {c.teacherShort} · {new Date(c.createdAt).toLocaleDateString('de-AT')}</span>
                              </div>
                              <div className="text-slate-100 font-medium">{c.note || 'Keine Beschreibung angegeben'}</div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-500 py-4 text-center italic">
                          Keine roten Karten erfasst.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                {/* 4. Konferenz-Beschluss & Abstimmung Card */}
                <div className="bg-slate-900/90 border-2 border-amber-500/40 rounded-3xl p-5 md:p-6 shadow-lg flex flex-col md:flex-row md:items-center justify-between gap-5">
                  <div className="flex flex-wrap items-center gap-6">
                    {/* Rank Selection */}
                    <div>
                      <div className="text-2xs font-bold uppercase tracking-wider text-amber-300 mb-1.5 flex flex-wrap items-center gap-2">
                        <span>Festgelegter Rang</span>
                        {p.suggestedRank && p.suggestedRank !== cur.rank && isAuthorized && (
                          <button
                            type="button"
                            onClick={() => handleRankChange(p.id, p.suggestedRank!)}
                            className="text-2xs px-2 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 font-bold transition flex items-center gap-1 active:scale-95 cursor-pointer"
                            title="Vorschlag nach Unterrichtsstunden übernehmen"
                          >
                            <span>⚖️ Stunden-Vorschlag ({p.suggestedRank}) übernehmen</span>
                          </button>
                        )}
                      </div>
                      {isAuthorized ? (
                        <div className="inline-flex items-center p-1 bg-slate-950 border border-slate-800 rounded-2xl gap-1 shadow-sm">
                          <button
                            type="button"
                            onClick={() => handleRankChange(p.id, 'Meister')}
                            className={`px-3 py-1.5 rounded-xl text-sm font-bold transition flex items-center gap-1.5 active:scale-95 ${
                              cur.rank === 'Meister'
                                ? 'bg-amber-400 text-slate-950 shadow-md ring-1 ring-amber-300'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                            }`}
                          >
                            <span>👑</span>
                            <span>Meister</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRankChange(p.id, 'Geselle')}
                            className={`px-3 py-1.5 rounded-xl text-sm font-bold transition flex items-center gap-1.5 active:scale-95 ${
                              cur.rank === 'Geselle'
                                ? 'bg-blue-500 text-slate-50 shadow-md ring-1 ring-blue-400'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                            }`}
                          >
                            <span>🔵</span>
                            <span>Geselle</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRankChange(p.id, 'Lehrling')}
                            className={`px-3 py-1.5 rounded-xl text-sm font-bold transition flex items-center gap-1.5 active:scale-95 ${
                              cur.rank === 'Lehrling'
                                ? 'bg-rose-500 text-slate-50 shadow-md ring-1 ring-rose-400'
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                            }`}
                          >
                            <span>🔴</span>
                            <span>Lehrling</span>
                          </button>
                        </div>
                      ) : (
                        <span className={`px-3 py-1.5 rounded-xl text-sm font-bold border ${badgeBg}`}>
                          {cur.rank}
                        </span>
                      )}
                    </div>

                    {/* Participation and hours-weighted split */}
                    <div>
                      <div className="text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Beteiligung
                      </div>
                      <div className="text-sm font-bold text-slate-50">
                        <span className={participation.missing ? "text-amber-400" : "text-emerald-400"}>
                          {participation.headline}
                        </span>
                        {participation.missing && (
                          <span className="text-slate-400 block text-sm font-normal">
                            {participation.missing}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Who disagreed with the decision on screen (Decision 0.3). */}
                    {dissentSummary && (
                      <div>
                        <div className="text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                          Gegenstimmen
                        </div>
                        <div className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
                          <span>⚠️</span>
                          <span>{dissentSummary}</span>
                        </div>
                        <div className="mt-1 space-y-1">
                          {dissent.map((d) => (
                            <div
                              key={`${d.teacherShort}-${d.subjectCode}`}
                              className="text-2xs text-slate-400 font-normal flex items-baseline gap-1.5"
                              title={`${d.teacherName} (${d.teacherShort}) schlug ${d.proposedStatus} in ${d.subjectCode} vor`}
                            >
                              <span className="font-bold text-slate-300">{d.teacherShort}</span>
                              <span>{d.subjectCode}</span>
                              <span className="text-slate-500">→ {d.proposedStatus}</span>
                              <span className="text-slate-500">({d.hours}h)</span>
                              {d.comment && (
                                <span className="text-slate-500 italic truncate max-w-[280px]">„{d.comment}“</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Hours-weighted split, never a roster-derived headcount. */}
                    <div>
                      <div className="text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                        Verteilung nach Unterrichtsstunden
                      </div>
                      {participation.hasNoVotes ? (
                        <div className="text-sm font-bold text-slate-400">
                          Keine abgegebenen Bewertungen
                        </div>
                      ) : (
                        <div className="text-sm font-bold text-slate-50">
                          <span className="text-rose-300">Lehrling {participation.share.Lehrling}%</span>
                          <span className="text-slate-500">{' · '}</span>
                          <span className="text-blue-300">Geselle {participation.share.Geselle}%</span>
                          <span className="text-slate-500">{' · '}</span>
                          <span className="text-amber-300">Meister {participation.share.Meister}%</span>
                          <span className="text-slate-400 block text-sm font-normal">
                            {participation.totalVotedHours} gewichtete Stunden
                          </span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Angenommen Button & Timestamp & Un-accept toggle */}
                  <div className="flex flex-col sm:flex-row items-end sm:items-center gap-3">
                    {p.isConfirmed ? (
                      <div className="text-right sm:mr-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold text-sm">
                          <Check className="w-3.5 h-3.5" />
                          <span>Angenommen</span>
                        </span>
                        <span className="block text-2xs text-amber-300 font-mono mt-0.5" title="Offizieller Konferenzstempel">
                          {formatTimestamp(p.confirmedAt)}
                        </span>
                      </div>
                    ) : null}

                    {isAuthorized && (
                      <div className="flex items-center gap-2">
                        {p.isConfirmed ? (
                          <button
                            onClick={() => handleToggleVoteSingle(p)}
                            disabled={isSubmitting}
                            className="px-4 py-2.5 rounded-xl font-bold text-sm flex items-center gap-1.5 bg-slate-800 hover:bg-rose-500/20 hover:text-rose-300 text-slate-300 border border-slate-700 hover:border-rose-500/40 transition active:scale-95"
                            title="Aus Versehen angenommen? Hier klicken, um den Beschluss zurückzusetzen."
                          >
                            <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
                            <span>{isSubmitting ? 'Widerrufe...' : 'Annahme zurücknehmen'}</span>
                          </button>
                        ) : (
                          <button
                            onClick={() => handleToggleVoteSingle(p)}
                            disabled={isSubmitting}
                            className="px-6 py-2.5 rounded-xl font-bold text-sm flex items-center gap-2 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 shadow-lg transition active:scale-95"
                          >
                            <Check className="w-4 h-4" />
                            <span>{isSubmitting ? 'Speichere...' : 'Als Beschluss annehmen'}</span>
                          </button>
                        )}

                        <button
                          onClick={goToNextPupil}
                          disabled={currentPupilIndex >= pupils.length - 1}
                          className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 font-bold text-sm flex items-center gap-1 transition disabled:opacity-30"
                          title="Zum nächsten Schüler"
                        >
                          <span>Nächster</span>
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      ) : (
        /* ========================================================================= */
        /* TABLE OVERVIEW MODE                                                       */
        /* ========================================================================= */
        <div className="flex-1 overflow-y-auto p-6 max-w-7xl w-full mx-auto divide-y divide-slate-800/80">
          <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-4 border-b border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h3 className="text-sm font-extrabold text-slate-100">
                  Klasse {currentClass?.name}: Beschlüsse bearbeiten
                </h3>
                <p className="mt-0.5 text-2xs text-slate-400">
                  Die vorgeschlagenen Ränge sind vorausgewählt. Ändern Sie nur
                  Abweichungen; danach die ganze Klasse bestätigen.
                </p>
                {missingRankCount > 0 && (
                  <p className="mt-1 text-2xs font-bold text-amber-300" role="status">
                    Noch {missingRankCount} Schüler/in(nen) ohne Rangvorschlag —
                    bitte im Dropdown auswählen.
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => void handleAcceptAllProposals()}
                disabled={loading || batchSubmitting || missingRankCount > 0}
                className="min-h-[44px] shrink-0 rounded-xl bg-emerald-500 px-4 py-2 text-sm font-extrabold text-slate-950 shadow-lg transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {batchSubmitting
                  ? 'Speichere...'
                  : `Klasse bestätigen (${confirmedCount}/${pupils.length})`}
              </button>
            </div>
          </div>
          {pupils.map((pupil, idx) => {
            const cur = pupilVotes[pupil.id] || {
              rank: pupil.finalRank ?? pupil.suggestedRank ?? null,
            };

            // Derived only from submitted evaluations. No roster-derived headcount.
            const participation = describeParticipation(pupil.participation, pupil.voteStats);

            const { badgeBg } = getRankVisuals(cur.rank);

            return (
              <div
                key={pupil.id}
                className={`py-4 px-5 rounded-2xl transition flex flex-col md:flex-row md:items-center justify-between gap-4 ${
                  pupil.isConfirmed ? 'bg-slate-900/60 border border-slate-800/60' : 'hover:bg-slate-900/40'
                }`}
              >
                <div className="w-full md:w-80">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-500 font-mono text-sm w-6">{idx + 1}.</span>
                    <button
                      onClick={() => {
                        setCurrentPupilIndex(idx);
                        setViewMode('walkthrough');
                      }}
                      className="font-bold text-slate-50 text-base leading-tight truncate hover:text-amber-400 text-left"
                    >
                      {pupil.fullName}
                    </button>
                    {pupil.isConfirmed && (
                      <span title="Beschluss gefasst">
                        <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                      </span>
                    )}
                    {pupil.hasRedCardDemotion && (
                      <span title="Degradiert durch Karten">
                        <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0" />
                      </span>
                    )}
                  </div>

                  <div className="mt-2 pl-8 space-y-1.5">
                    {pupil.voteStats?.totalVotedHours ? (
                      <div className="pt-1">
                        <div className="flex items-center justify-between text-2xs text-slate-400 mb-0.5">
                          <span>⚖️ Stunden ({pupil.voteStats.totalVotedHours}h):</span>
                          <span className="font-semibold text-amber-300">
                            {pupil.suggestedRank ?? 'keine Mehrheit'}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-950 rounded-full overflow-hidden flex border border-slate-800">
                          <Meter value={(pupil.voteStats.pctMeister || 0)} className="h-full bg-amber-400" />
                          <Meter value={(pupil.voteStats.pctGeselle || 0)} className="h-full bg-blue-500" />
                          <Meter value={(pupil.voteStats.pctLehrling || 0)} className="h-full bg-rose-500" />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                {/* Middle: Rank, participation & weighted split */}
                <div className="flex flex-wrap items-center gap-5">
                  <div>
                    <div className="text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Vorschlag
                    </div>
                    <span className={`inline-flex min-w-[110px] items-center rounded-xl border px-2.5 py-1.5 text-2xs font-bold ${
                      pupil.suggestedRank
                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                        : 'border-slate-700 bg-slate-900 text-slate-400'
                    }`}>
                      {pupil.suggestedRank ?? 'keine Mehrheit'}
                    </span>
                  </div>

                  <div>
                    <div className="text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Rang
                    </div>
                    {isAuthorized ? (
                      <select
                        value={cur.rank ?? ''}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === 'Lehrling' || value === 'Geselle' || value === 'Meister') {
                            handleRankChange(pupil.id, value);
                          }
                        }}
                        aria-label={`Rang für ${pupil.fullName}`}
                        className={`min-w-[140px] rounded-xl border px-3 py-2 text-sm font-bold focus:outline-none focus-ring ${
                          cur.rank
                            ? 'border-slate-700 bg-slate-950 text-slate-50'
                            : 'border-amber-500/50 bg-amber-500/10 text-amber-200'
                        }`}
                      >
                        <option value="" disabled>Bitte wählen…</option>
                        <option value="Lehrling">Lehrling</option>
                        <option value="Geselle">Geselle</option>
                        <option value="Meister">Meister</option>
                      </select>
                    ) : (
                      <span className={`px-2.5 py-1 rounded-xl text-sm font-bold border ${badgeBg}`}>
                        {cur.rank ?? 'offen'}
                      </span>
                    )}
                  </div>

                  <div>
                    <div className="text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Beteiligung
                    </div>
                    <div className="text-sm font-bold text-slate-50">
                      <span className={participation.missing ? "text-amber-400" : "text-emerald-400"}>
                        {participation.headline}
                      </span>
                      {participation.missing && (
                        <span className="text-slate-400 block text-2xs font-normal">
                          {participation.missing}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="min-w-[150px]">
                    <div className="text-2xs font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Verteilung (nach Stunden)
                    </div>
                    {participation.hasNoVotes ? (
                      <div className="text-sm font-bold text-slate-400">Keine Bewertungen</div>
                    ) : (
                      <div className="text-sm font-bold text-slate-50">
                        <span className="text-rose-300">L {participation.share.Lehrling}%</span>
                        <span className="text-slate-500">{" · "}</span>
                        <span className="text-blue-300">G {participation.share.Geselle}%</span>
                        <span className="text-slate-500">{" · "}</span>
                        <span className="text-amber-300">M {participation.share.Meister}%</span>
                        <span className="text-slate-400 block text-2xs font-normal">
                          {participation.totalVotedHours} gewichtete Stunden
                        </span>
                      </div>
                    )}
                  </div>                </div>

                {/* Right: Angenommen Button & Un-accept toggle */}
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    {pupil.isConfirmed ? (
                      <>
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-bold text-sm">
                          <Check className="w-3.5 h-3.5" />
                          <span>Beschluss erfasst</span>
                        </span>
                        <span className="block text-2xs text-slate-400 font-mono mt-0.5">
                          {formatTimestamp(pupil.confirmedAt)}
                        </span>
                        {cur.rank && cur.rank !== pupil.finalRank && (
                          <span className="mt-1 block text-2xs font-bold text-amber-300">
                            geändert — noch nicht gespeichert
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-300 font-bold text-sm">
                        <Clock className="w-3.5 h-3.5 text-amber-300" />
                        <span>Offen</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bottom Bar: Pupil Carousel & Navigation */}
      <div className="p-3 px-6 border-t border-slate-800 bg-slate-900/90 flex flex-col md:flex-row md:items-center justify-between gap-3 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={goToPrevPupil}
            disabled={currentPupilIndex <= 0}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 font-bold text-sm flex items-center gap-1 transition disabled:opacity-30"
          >
            <ChevronLeft className="w-4 h-4" />
            <span>Vorheriger</span>
          </button>

          {/* Quick Pupil Thumbnails Carousel */}
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-xl py-1">
            {pupils.map((p, idx) => {
              const cur = pupilVotes[p.id] || { rank: p.finalRank ?? p.suggestedRank ?? null };
              let dotColor = 'bg-rose-500';
              if (cur.rank === 'Meister') dotColor = 'bg-amber-400';
              else if (cur.rank === 'Geselle') dotColor = 'bg-blue-500';

              return (
                <button
                  key={p.id}
                  onClick={() => {
                    setCurrentPupilIndex(idx);
                    setViewMode('walkthrough');
                  }}
                  className={`px-2.5 py-1 rounded-xl text-sm font-bold transition flex items-center gap-1.5 flex-shrink-0 border ${
                    currentPupilIndex === idx && viewMode === 'walkthrough'
                      ? 'bg-slate-700 text-slate-50 border-amber-400 shadow-sm'
                      : 'bg-slate-950/80 text-slate-400 border-slate-800 hover:text-slate-50'
                  }`}
                  title={`${idx + 1}. ${p.fullName} (${cur.rank})`}
                >
                  <span className={`w-2 h-2 rounded-full ${dotColor}`} />
                  <span className="truncate max-w-[80px]">{p.fullName.split(' ')[0]}</span>
                  {p.isConfirmed && (
                    <Check className="w-3 h-3 text-emerald-400" />
                  )}
                </button>
              );
            })}
          </div>

          <button
            onClick={goToNextPupil}
            disabled={currentPupilIndex >= pupils.length - 1}
            className="min-h-[44px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 font-bold text-sm flex items-center gap-1 transition disabled:opacity-30"
          >
            <span>Nächster</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm">
            Schüler <strong className="text-slate-50">{currentPupilIndex + 1}</strong> von {pupils.length}
          </span>

          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-50 font-bold text-sm transition"
          >
            Schließen
          </button>
        </div>
      </div>
    </div>
  );
};
