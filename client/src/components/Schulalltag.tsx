import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Users,
  Clock,
  Search,
  Plus,
  Check,
  X,
  CheckCircle2,
  Snowflake,
  ShieldAlert as ShieldAlertIcon,
  GraduationCap,
  SlidersHorizontal,
  ArrowUpDown,
  MoreVertical,
  Send,
  Star,
  User as UserIcon,
  FileText,
} from 'lucide-react';
import { SchoolClass, PupilWithData, User, RubricCriterion } from '../types';
import { scoreSubject, type AssessmentRank } from '../lib/pupilItems';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { PupilProfileModal } from './PupilProfileModal';
import { CardNoteEditor, canEditCardNote } from './schulalltag/CardNoteEditor';
import {
  SchulalltagActionSheets,
  localDateKey,
  type ActiveCardModalState,
  type RedCardTargetState,
  type TimeoutTargetState,
} from './schulalltag/SchulalltagActionSheets';
import {
  issueCard,
  revokeCard,
  getClassCards,
  getClassTimeouts,
  getCurrentTimetable,
  sendToTimeout,
  sendToCooldown,
  getActiveTimeouts,
  resolveTimeout,
  getTimeoutHistory,
  getBehaviorOverview,
  type BehaviorOverview,
  type BehaviorOverviewPupil,
} from '../services/api';
import {
  AllClassesBehaviorPanel,
  type AllClassesAction,
} from './AllClassesBehaviorPanel';

interface BehaviorCardItem {
  id: string;
  pupil_id: number;
  class_id: number;
  teacher_id: number;
  teacher_short: string;
  teacher_name: string;
  card_type: 'green' | 'yellow' | 'red' | 'cooldown';
  note?: string | null;
  created_at: string;
}

const YELLOW_RANK_LOSS_THRESHOLD = 3;

type PupilSortMode = 'name' | 'rank' | 'green' | 'yellow' | 'red' | 'timeout' | 'incidents';

const PUPIL_SORT_OPTIONS: Array<{ value: PupilSortMode; label: string }> = [
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'rank', label: 'Rang (Meister → Lehrling)' },
  { value: 'green', label: 'Grüne Karten (meiste zuerst)' },
  { value: 'yellow', label: 'Gelbe Karten (meiste zuerst)' },
  { value: 'red', label: 'Rote Karten (meiste zuerst)' },
  { value: 'timeout', label: 'Time-Outs (meiste zuerst)' },
  { value: 'incidents', label: 'Gelb/Rot/Time-Out (meiste zuerst)' },
];

interface TimeoutItem {
  id: string;
  pupil_id: number;
  class_id: number;
  sent_by_teacher_id: number;
  sent_at: string;
  recorded_at?: string;
  retroactive?: boolean;
  task_assignment: string;
  kind?: 'timeout' | 'cooldown';
  status: 'active' | 'resolved';
  red_card_id?: string;
  pupil_name: string;
  class_name: string;
  sent_by_short: string;
  sent_by_name: string;
  resolved_at?: string;
  resolved_by?: number;
  resolution_note?: string;
}

interface SchulalltagProps {
  currentClass: SchoolClass;
  classes: SchoolClass[];
  pupils: PupilWithData[];
  currentUser: User;
  onSelectClass: (classId: number) => void;
  onRefreshClassData: () => void | Promise<void>;
  criteria: RubricCriterion[];
  viewMode?: 'class' | 'lw' | 'all';
  onViewModeChange?: (mode: 'class' | 'lw' | 'all') => void;
  onActiveTimeoutCountChange?: (count: number) => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}

function formatElapsedMinutes(isoDate: string): string {
  const parsed = Date.parse(isoDate);
  if (!Number.isFinite(parsed)) return 'aktiv';
  const mins = Math.max(1, Math.round((Date.now() - parsed) / 60000));
  return `${mins} min`;
}

export const Schulalltag: React.FC<SchulalltagProps> = ({
  currentClass,
  classes,
  pupils,
  currentUser,
  onSelectClass,
  onRefreshClassData,
  criteria,
  viewMode,
  onViewModeChange,
  onActiveTimeoutCountChange,
}) => {
  const [cards, setCards] = useState<BehaviorCardItem[]>([]);
  const [classTimeouts, setClassTimeouts] = useState<TimeoutItem[]>([]);
  const [, setLoadingCards] = useState(false);
  const [timetableData, setTimetableData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [quickFilter, setQuickFilter] = useState<'all' | 'flagged' | 'lw'>('all');
  const [showRankFilter, setShowRankFilter] = useState(false);
  const [filterRank, setFilterRank] = useState<'all' | 'Lehrling' | 'Geselle' | 'Meister'>('all');
  const [sortMode, setSortMode] = useState<PupilSortMode>('name');
  const [expandedPupilId, setExpandedPupilId] = useState<number | null>(null);
  const [activeProfilePupilId, setActiveProfilePupilId] = useState<number | null>(null);

  // Unified view mode (class roster | Lernwerkstatt LW | school-wide Alle Klassen)
  const [internalViewMode, setInternalViewMode] = useState<'class' | 'lw' | 'all'>('class');
  const activeViewMode = viewMode ?? internalViewMode;
  const setViewMode = (next: 'class' | 'lw' | 'all') => {
    setInternalViewMode(next);
    onViewModeChange?.(next);
  };
  const isAllClassesView = activeViewMode === 'all';
  const isLwView = activeViewMode === 'lw';

  const [allClassesData, setAllClassesData] = useState<BehaviorOverview | null>(null);
  const [allClassesLoading, setAllClassesLoading] = useState(false);
  const [allClassesError, setAllClassesError] = useState<string | null>(null);

  const [activeTimeouts, setActiveTimeouts] = useState<TimeoutItem[]>([]);
  const [timeoutHistory, setTimeoutHistory] = useState<TimeoutItem[]>([]);
  const [loadingTimeouts, setLoadingTimeouts] = useState(false);

  // Modal for standard green or yellow card
  const [activeCardModal, setActiveCardModal] = useState<{
    pupilId: number;
    pupilName: string;
    cardType: 'green' | 'yellow';
    classId: number;
    className: string;
  } | null>(null);
  const [cardNote, setCardNote] = useState('');
  const [submittingCard, setSubmittingCard] = useState(false);

  // Two-Step Security Modal for ROTE Karte (Instant Rank Loss)
  const [redCardTarget, setRedCardTarget] = useState<{
    pupilId: number;
    pupilName: string;
    classId: number;
    className: string;
    deductions: Array<{
      label: string;
      currentRank: 'Lehrling' | 'Geselle' | 'Meister';
      demotedRank: 'Lehrling' | 'Geselle';
    }>;
    pendingNote: string | null;
  } | null>(null);
  const [redCardStep, setRedCardStep] = useState<1 | 2>(1);
  const [redCardNote, setRedCardNote] = useState('');
  const [submittingRedCard, setSubmittingRedCard] = useState(false);

  // TIMEOUT Modal
  const [timeoutTarget, setTimeoutTarget] = useState<{
    pupilId: number;
    pupilName: string;
    kind: 'timeout' | 'cooldown';
    classId: number;
    className: string;
  } | null>(null);
  const [timeoutTask, setTimeoutTask] = useState('');
  const [timeoutRetroactive, setTimeoutRetroactive] = useState(false);
  const [timeoutRetroDate, setTimeoutRetroDate] = useState(localDateKey());
  const [timeoutRetroPeriod, setTimeoutRetroPeriod] = useState(1);
  const [submittingTimeout, setSubmittingTimeout] = useState(false);

  // Quick inline note state per pupil
  const [inlineNotes, setInlineNotes] = useState<Record<number, string>>({});
  const [savingInlineNote, setSavingInlineNote] = useState<number | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);

  const toast = useToast();
  const confirm = useConfirm();

  /** Keyboard shortcuts act on the pupil whose row is expanded, else the first row. */
  const targetPupil = useMemo(() => {
    if (expandedPupilId != null) return pupils.find((p) => p.id === expandedPupilId) ?? null;
    return pupils[0] ?? null;
  }, [expandedPupilId, pupils]);

  // Load timetable info
  useEffect(() => {
    getCurrentTimetable()
      .then((data) => {
        setTimetableData(data);
        // If current lesson is LW, auto-open LW view
        if (
          data.currentLesson?.className === 'LW' ||
          data.currentLesson?.class_name === 'LW' ||
          data.currentLesson?.subjectCode === 'LW' ||
          data.currentLesson?.subject_code === 'LW'
        ) {
          setViewMode('lw');
        }
      })
      .catch((e) => console.error('Timetable fetch error:', e));
  }, []);

  // Load cards & class timeouts for current class
  const loadClassCards = async (cid: number) => {
    setLoadingCards(true);
    try {
      const [cardsRes, timeoutsRes] = await Promise.all([
        getClassCards(cid),
        getClassTimeouts(cid),
      ]);
      setCards(Array.isArray(cardsRes) ? cardsRes : []);
      setClassTimeouts(Array.isArray(timeoutsRes) ? timeoutsRes : []);
    } catch (e) {
      console.error('Error fetching cards/timeouts:', e);
    } finally {
      setLoadingCards(false);
    }
  };

  useEffect(() => {
    setEditingCardId(null);
    if (currentClass?.id) {
      loadClassCards(currentClass.id);
    }
  }, [currentClass?.id]);

  // Load active timeouts
  const loadTimeoutsData = async () => {
    setLoadingTimeouts(true);
    try {
      const [act, hist] = await Promise.all([
        getActiveTimeouts(),
        getTimeoutHistory(),
      ]);
      setActiveTimeouts(act || []);
      onActiveTimeoutCountChange?.((act || []).length);
      setTimeoutHistory(hist || []);
    } catch (e) {
      console.error('Error fetching timeouts:', e);
    } finally {
      setLoadingTimeouts(false);
    }
  };

  /** Load the school-wide "Alle Klassen" status model. */
  const loadAllClasses = async () => {
    setAllClassesLoading(true);
    setAllClassesError(null);
    try {
      setAllClassesData(await getBehaviorOverview());
    } catch (e: any) {
      setAllClassesError(e.message || 'Klassenübersicht konnte nicht geladen werden.');
    } finally {
      setAllClassesLoading(false);
    }
  };

  // The timeout listener is registered once; this ref lets it refresh the school-wide
  // panel when that view happens to be open, without re-registering the interval.
  const allClassesViewRef = useRef(false);
  useEffect(() => {
    allClassesViewRef.current = isAllClassesView;
    if (isAllClassesView) void loadAllClasses();
  }, [isAllClassesView]);

  /**
   * Refresh after a card / Time-Out action. The class view reloads its own class;
   * the school-wide view always refetches its overview so counts are authoritative.
   */
  const refreshAfterBehaviourAction = async (classId: number) => {
    if (classId === currentClass.id) {
      await loadClassCards(classId);
      await onRefreshClassData();
    }
    await loadTimeoutsData();
    if (isAllClassesView) await loadAllClasses();
  };

  // The live-sync listener below is registered once, but the class it must reload
  // changes. Reading currentClass from the mount-time closure reloaded the previous
  // class's cards and time-outs into the new class view after a switch: every row's
  // green/yellow/red/time-out counters fell back to 0 until the next manual reload.
  const currentClassIdRef = useRef<number | undefined>(currentClass?.id);
  useEffect(() => {
    currentClassIdRef.current = currentClass?.id;
  }, [currentClass?.id]);

  useEffect(() => {
    loadTimeoutsData();
    const interval = setInterval(loadTimeoutsData, 15000); // Poll every 15s for live updates
    const handleTimeoutsUpdated = () => {
      void loadTimeoutsData();
      const classId = currentClassIdRef.current;
      if (classId) void loadClassCards(classId);
      if (allClassesViewRef.current) void loadAllClasses();
    };
    const handleCardsUpdated = () => {
      const classId = currentClassIdRef.current;
      if (classId) void loadClassCards(classId);
      if (allClassesViewRef.current) void loadAllClasses();
    };
    window.addEventListener('smile:timeouts-updated', handleTimeoutsUpdated);
    window.addEventListener('smile:cards-updated', handleCardsUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('smile:timeouts-updated', handleTimeoutsUpdated);
      window.removeEventListener('smile:cards-updated', handleCardsUpdated);
    };
  }, []);

  const rubricItemKeys = useMemo(
    () => Array.from(new Set(criteria.flatMap((c) => c.items.map((i) => i.key)))),
    [criteria],
  );

  const demoteRank = (rank: AssessmentRank): AssessmentRank => {
    if (rank === 'Meister') return 'Geselle';
    if (rank === 'Geselle') return 'Lehrling';
    return 'Lehrling';
  };

  const applyDemotion = (rank: AssessmentRank | null, steps: number): AssessmentRank | null => {
    if (!rank) return null;
    let current = rank;
    for (let i = 0; i < steps; i += 1) current = demoteRank(current);
    return current;
  };

  const getDemotionSteps = (
    p: PupilWithData,
    pupilCards: Array<{ card_type: string; created_at?: string }>,
  ): number => {
    const serverCountsStale =
      typeof p.redCardCount === 'number' &&
      (pupilCards.filter((c) => c.card_type === 'yellow').length !== p.yellowCardCount ||
        pupilCards.filter((c) => c.card_type === 'red').length !== p.redCardCount);
    if (typeof p.rankDemotionSteps === 'number' && !serverCountsStale) {
      return p.rankDemotionSteps;
    }

    const confirmMs = p.finalRankConfirmedAt ? Date.parse(p.finalRankConfirmedAt) : NaN;
    if (Number.isFinite(confirmMs)) {
      const redAfterConfirm = pupilCards.filter((c) => {
        if (c.card_type !== 'red') return false;
        const ts = c.created_at ? Date.parse(c.created_at) : NaN;
        return Number.isFinite(ts) && ts > confirmMs;
      }).length;
      const yellowAll = pupilCards.filter((c) => c.card_type === 'yellow');
      const yellowAtConfirm = yellowAll.filter((c) => {
        const ts = c.created_at ? Date.parse(c.created_at) : NaN;
        return Number.isFinite(ts) && ts <= confirmMs;
      }).length;
      const yellowSteps = Math.max(
        0,
        Math.floor(yellowAll.length / YELLOW_RANK_LOSS_THRESHOLD) -
          Math.floor(yellowAtConfirm / YELLOW_RANK_LOSS_THRESHOLD),
      );
      return (redAfterConfirm > 0 ? 1 : 0) + yellowSteps;
    }

    const redCount = pupilCards.filter((c) => c.card_type === 'red').length;
    const yellowCount = pupilCards.filter((c) => c.card_type === 'yellow').length;
    return (redCount > 0 ? 1 : 0) + Math.floor(yellowCount / YELLOW_RANK_LOSS_THRESHOLD);
  };

  const getPupilSubjectResults = (p: PupilWithData) => {
    const subjectsToScore =
      currentClass?.mySubjects && currentClass.mySubjects.length > 0
        ? currentClass.mySubjects
        : Array.from(new Set(p.evaluations.map((e) => e.subjectCode))).map((code) => ({
            code,
            name: code,
          }));

    const pupilCards = Array.isArray(cards) ? cards.filter((c) => c.pupil_id === p.id) : [];
    const demotionSteps = getDemotionSteps(p, pupilCards);

    return subjectsToScore.map((s) => {
      const scored = scoreSubject(p.evaluations, s.code, rubricItemKeys);
      const baseRank = scored.rank;
      const rank = applyDemotion(baseRank, demotionSteps);
      const hasCardDemotion = rank !== null && rank !== baseRank;

      const displayRank = rank ?? 'Ausstehend';
      const label = `${s.code} ${scored.positiveCount}/${rubricItemKeys.length} ${displayRank}`;

      return {
        subjectCode: s.code,
        positiveCount: scored.positiveCount,
        totalRated: scored.totalRated,
        baseRank,
        rank,
        hasRedCardDemotion: hasCardDemotion,
        label,
      };
    });
  };

  const getPupilRank = (p: PupilWithData) => {
    // The tile shows a pupil-level rank. Submitted teacher votes are the same
    // source the conference uses; `subjectResults` remains only as a fallback for
    // pupils without submitted votes, and for the expandable evidence panel.
    const pupilCards = Array.isArray(cards) ? cards.filter((c) => c.pupil_id === p.id) : [];
    const results = getPupilSubjectResults(p);
    const activeRedCards = pupilCards.filter((c) => c.card_type === 'red');

    return {
      hasRedCard: activeRedCards.length > 0,
      redCardCount: activeRedCards.length,
      demotionSteps: getDemotionSteps(p, pupilCards),
      subjectResults: results,
    };
  };

  /**
   * Pupil-level rank from the submitted teacher votes. A strict plurality wins;
   * a tie or no votes falls back to the current lesson subject's rubric rank so
   * the row never invents a rank. Card consequences demote the pupil rank:
   * one step for a red card, one per three active yellow cards.
   */
  const getDisplayedRank = (
    p: PupilWithData,
    subjectResults: Array<{ subjectCode: string; rank: AssessmentRank | null }>,
    demotionSteps: number,
  ): AssessmentRank | null => {
    if (
      p.finalRank === 'Lehrling' ||
      p.finalRank === 'Geselle' ||
      p.finalRank === 'Meister'
    ) {
      return applyDemotion(p.finalRank, demotionSteps);
    }

    const votes: Record<AssessmentRank, number> = {
      Lehrling: 0,
      Geselle: 0,
      Meister: 0,
    };
    for (const evaluation of p.evaluations) {
      if (!evaluation.isSubmitted || !evaluation.proposedStatus) continue;
      votes[evaluation.proposedStatus] += 1;
    }

    const top = Math.max(votes.Lehrling, votes.Geselle, votes.Meister);
    if (top > 0) {
      const leaders = (['Lehrling', 'Geselle', 'Meister'] as AssessmentRank[]).filter(
        (rank) => votes[rank] === top,
      );
      if (leaders.length === 1) {
        return applyDemotion(leaders[0]!, demotionSteps);
      }
    }

    const fallback =
      subjectResults.find((result) => result.subjectCode === lessonSubjectCode) ??
      subjectResults[0] ??
      null;
    return fallback?.rank ?? null;
  };

  // Submit standard card (green or yellow)
  const handleConfirmCard = async () => {
    if (!activeCardModal) return;
    setSubmittingCard(true);
    const target = activeCardModal;
    const note = cardNote.trim() || undefined;
    try {
      const res = await issueCard(target.pupilId, target.classId, target.cardType, note);
      await refreshAfterBehaviourAction(target.classId);
      setActiveCardModal(null);
      setCardNote('');

      // Undo window: a mis-tap costs one tap, not a trip through a confirm dialog.
      const colour = target.cardType === 'green' ? 'Grüne' : 'Gelbe';
      toast.success(`${colour} Karte für ${target.pupilName} gespeichert.`, {
        action: {
          label: 'Rückgängig',
          onClick: async () => {
            try {
              await revokeCard(res.card.id);
              await refreshAfterBehaviourAction(target.classId);
              toast.success('Karte zurückgezogen.');
            } catch (e: any) {
              toast.error(e.message || 'Rückgängig fehlgeschlagen.');
            }
          },
        },
      });
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Vergeben der Karte');
    } finally {
      setSubmittingCard(false);
    }
  };

  // Open 2-step Red Card Modal
  const openRedCardModal = (target: {
    pupilId: number;
    pupilName: string;
    classId: number;
    className: string;
    deductions: Array<{
      label: string;
      currentRank: 'Lehrling' | 'Geselle' | 'Meister';
      demotedRank: 'Lehrling' | 'Geselle';
    }>;
    pendingNote: string | null;
  }) => {
    setRedCardTarget(target);
    setRedCardStep(1);
    setRedCardNote('');
  };

  /** Class view: compute the per-subject demotion preview from the loaded pupil. */
  const handleOpenRedCardModal = (pupil: PupilWithData) => {
    const { demotionSteps, subjectResults } = getPupilRank(pupil);

    // A red card demotes each subject's rank one level from its calculated
    // (base) rank; subjects without a calculated rank are untouched and called
    // out separately.
    const deductions = subjectResults.flatMap((r) =>
      r.baseRank
        ? [
            {
              label: r.subjectCode,
              currentRank: r.baseRank,
              demotedRank: (r.baseRank === 'Meister' ? 'Geselle' : 'Lehrling') as
                | 'Lehrling'
                | 'Geselle',
            },
          ]
        : [],
    );
    const pendingSubjects = subjectResults.filter((r) => !r.baseRank).map((r) => r.subjectCode);

    if (deductions.length === 0 && pupil.finalRank) {
      const currentDisplayed = getDisplayedRank(pupil, subjectResults, demotionSteps) ?? pupil.finalRank;
      const demoted = demoteRank(currentDisplayed);
      openRedCardModal({
        pupilId: pupil.id,
        pupilName: pupil.fullName,
        classId: currentClass.id,
        className: currentClass.name,
        deductions: [
          {
            label: 'Gesamtrang',
            currentRank: currentDisplayed,
            demotedRank: (demoted === 'Geselle' ? 'Geselle' : 'Lehrling') as 'Lehrling' | 'Geselle',
          },
        ],
        pendingNote: null,
      });
      return;
    }

    openRedCardModal({
      pupilId: pupil.id,
      pupilName: pupil.fullName,
      classId: currentClass.id,
      className: currentClass.name,
      deductions,
      pendingNote:
        pendingSubjects.length > 0
          ? `In ${pendingSubjects.join(', ')} liegt noch keine Bewertung vor – kein Rangverlust.`
          : null,
    });
  };

  // Confirm Red Card (Step 2 submit)
  const handleConfirmRedCard = async () => {
    if (!redCardTarget) return;
    if (!redCardNote.trim()) {
      toast.error('Bitte geben Sie eine Beschreibung des Vorfalls an.');
      return;
    }

    setSubmittingRedCard(true);
    const target = redCardTarget;
    const note = redCardNote.trim();
    try {
      const res = await issueCard(target.pupilId, target.classId, 'red', note);
      await refreshAfterBehaviourAction(target.classId);
      setRedCardTarget(null);
      setRedCardNote('');

      // A red card costs a rank, so it carries the same undo window as the others.
      const summary =
        target.deductions.length > 0
          ? target.deductions.map((d) => `${d.label}: ${d.currentRank} → ${d.demotedRank}`).join(', ')
          : 'kein Rangverlust';
      toast.success(`Rote Karte für ${target.pupilName}: ${summary}.`, {
          action: {
            label: 'Rückgängig',
            onClick: async () => {
              try {
                await revokeCard(res.card.id);
                await refreshAfterBehaviourAction(target.classId);
                toast.success('Rangverlust aufgehoben.');
              } catch (e: any) {
                toast.error(e.message || 'Rückgängig fehlgeschlagen.');
              }
            },
          },
        },
      );
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Vergeben der Roten Karte');
    } finally {
      setSubmittingRedCard(false);
    }
  };

  // Open Time-Out / Cool-Down Modal
  const handleOpenTimeoutModal = (
    pupil: { id: number; fullName: string },
    kind: 'timeout' | 'cooldown' = 'timeout',
    classInfo: { classId: number; className: string } = {
      classId: currentClass.id,
      className: currentClass.name,
    },
  ) => {
    setTimeoutTarget({
      pupilId: pupil.id,
      pupilName: pupil.fullName,
      kind,
      classId: classInfo.classId,
      className: classInfo.className,
    });
    setTimeoutTask('');
    setTimeoutRetroactive(false);
    setTimeoutRetroDate(localDateKey());
    const currentPeriod = Number(timetableData?.period ?? 1);
    setTimeoutRetroPeriod(Math.max(1, Math.min(10, currentPeriod - 1)));
  };

  // Confirm sending pupil to Time-Out or Cool-Down
  const handleConfirmTimeout = async () => {
    if (!timeoutTarget || !currentClass) return;
    const isCooldown = timeoutTarget.kind === 'cooldown';
    if (!isCooldown && !timeoutTask.trim()) {
      toast.error('Bitte geben Sie einen Arbeitsauftrag für die Lernwerkstatt an.');
      return;
    }

    setSubmittingTimeout(true);
    const target = timeoutTarget;
    const task = timeoutTask.trim();
    const isRetroactive = !isCooldown && timeoutRetroactive;
    try {
      const res = isCooldown
        ? await sendToCooldown(target.pupilId, target.classId, task || undefined)
        : await sendToTimeout(
            target.pupilId,
            target.classId,
            task,
            isRetroactive
              ? { date: timeoutRetroDate, period: timeoutRetroPeriod }
              : undefined,
          );
      await refreshAfterBehaviourAction(target.classId);
      setTimeoutTarget(null);
      setTimeoutTask('');

      if (isRetroactive) {
        toast.success(
          `${target.pupilName}: Time-Out nachgetragen (${timeoutRetroDate}, ${timeoutRetroPeriod}. Stunde).`,
        );
        return;
      }

      // Undo has to undo every record the action created. A Cool-Down creates no
      // red card, so there is no rank loss to reverse there.
      toast.success(
        isCooldown
          ? `${target.pupilName} ist im Cool-Down (Lernwerkstatt), kein Rangverlust.`
          : `${target.pupilName} ist im Time-Out. Keine Rote Karte, kein Rangverlust.`,
        {
          action: {
            label: 'Rückgängig',
            onClick: async () => {
              try {
                await resolveTimeout(res.incident.id, 'Rückgängig: Lernwerkstatt-Eintrag aufgehoben');
                if (res.redCard?.id) await revokeCard(res.redCard.id);
                if (res.cooldownCard?.id) await revokeCard(res.cooldownCard.id);
                await refreshAfterBehaviourAction(target.classId);
                toast.success(
                  isCooldown
                    ? 'Cool-Down aufgehoben.'
                    : 'Time-Out aufgehoben.',
                );
              } catch (e: any) {
                toast.error(
                  e.message || 'Rückgängig fehlgeschlagen. Bitte in der LW-Übersicht prüfen.',
                );
              }
            },
          },
        },
      );
    } catch (e: any) {
      toast.error(e.message || (isCooldown ? 'Fehler beim Cool-Down' : 'Fehler beim Erfassen des Time-Outs'));
    } finally {
      setSubmittingTimeout(false);
    }
  };

  /** Dispatch an action from the school-wide panel through the same modals. */
  const handleAllClassesAction = (
    pupil: BehaviorOverviewPupil,
    action: AllClassesAction,
  ) => {
    const classInfo = { classId: pupil.classId, className: pupil.className };
    if (action === 'green' || action === 'yellow') {
      setCardNote('');
      setActiveCardModal({
        pupilId: pupil.id,
        pupilName: pupil.fullName,
        cardType: action,
        ...classInfo,
      });
      return;
    }
    if (action === 'red') {
      // The overview does not carry the per-subject raster, so the school-wide
      // dialog states the consequence without a subject-by-subject preview.
      openRedCardModal({
        pupilId: pupil.id,
        pupilName: pupil.fullName,
        deductions: [],
        pendingNote: null,
        ...classInfo,
      });
      return;
    }
    handleOpenTimeoutModal({ id: pupil.id, fullName: pupil.fullName }, action, classInfo);
  };

  // Resolve Time-Out / Cool-Down in LW
  const handleResolveTimeout = async (
    id: string,
    pupilName: string,
    kind: 'timeout' | 'cooldown' = 'timeout',
  ) => {
    const isCooldown = kind === 'cooldown';
    const ok = await confirm({
      title: `${pupilName} zurück in die Klasse?`,
      message: isCooldown
        ? 'Der Cool-Down wird beendet.'
        : 'Der Arbeitsauftrag wird als erledigt protokolliert.',
      confirmLabel: 'Zurück schicken',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await resolveTimeout(
        id,
        isCooldown ? 'Cool-Down beendet' : 'Arbeitsauftrag in Lernwerkstatt erledigt',
      );
      await loadTimeoutsData();
      onRefreshClassData();
      toast.success(`${pupilName} ist zurück in der Klasse.`);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Zurückschicken');
    }
  };

  // Revoke card
  const handleRevokeCard = async (card: BehaviorCardItem) => {
    const isRed = card.card_type === 'red';
    const ok = await confirm({
      title: 'Karte zurückziehen?',
      message: isRed
        ? 'Eine Rote Karte kostet sofort einen Rang. Wird sie zurückgezogen, ist der Rangverlust sofort aufgehoben.'
        : 'Die Karte wird aus der Historie entfernt.',
      confirmLabel: 'Zurückziehen',
      tone: isRed ? 'danger' : 'default',
    });
    if (!ok) return;

    try {
      await revokeCard(card.id);
      await refreshAfterBehaviourAction(card.class_id);
      toast.success('Karte zurückgezogen.');
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Zurückziehen');
    }
  };

  // Save quick note as a card record with green or standard note
  const handleSaveInlineNote = async (pupilId: number) => {
    const noteText = inlineNotes[pupilId]?.trim();
    if (!noteText || !currentClass) return;
    setSavingInlineNote(pupilId);
    try {
      await issueCard(pupilId, currentClass.id, 'green', noteText);
      await loadClassCards(currentClass.id);
      onRefreshClassData();
      setInlineNotes((prev) => ({ ...prev, [pupilId]: '' }));
      toast.success('Notiz gespeichert.');
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Speichern der Notiz');
    } finally {
      setSavingInlineNote(null);
    }
  };

  // --- Keyboard shortcuts ----------------------------------------------------
  // Teachers using an iPad with a keyboard can record the common actions without
  // reaching for a 44px target. Keys act on the expanded pupil row, or the first
  // pupil when nothing is expanded.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Never hijack typing.
      const el = e.target as HTMLElement | null;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.isContentEditable)
      ) {
        return;
      }
      // A modal is open: the dialog owns the keyboard.
      if (activeCardModal || redCardTarget || timeoutTarget) return;
      if (isLwView || isAllClassesView) return;
      // Do not hijack browser/app shortcuts such as Ctrl+R, Cmd+R or Alt+Left.
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const pupil = targetPupil;
      if (!pupil) return;

      switch (e.key) {
        case '1':
        case 'g':
        case 'G':
          e.preventDefault();
          setExpandedPupilId(pupil.id);
          setActiveCardModal({
            pupilId: pupil.id,
            pupilName: pupil.fullName,
            cardType: 'green',
            classId: currentClass.id,
            className: currentClass.name,
          });
          break;
        case '2':
        case 'y':
        case 'Y':
          e.preventDefault();
          setExpandedPupilId(pupil.id);
          setActiveCardModal({
            pupilId: pupil.id,
            pupilName: pupil.fullName,
            cardType: 'yellow',
            classId: currentClass.id,
            className: currentClass.name,
          });
          break;
        case '3':
        case 'r':
        case 'R':
          e.preventDefault();
          setExpandedPupilId(pupil.id);
          handleOpenRedCardModal(pupil);
          break;
        case '4':
        case 't':
        case 'T':
          e.preventDefault();
          setExpandedPupilId(pupil.id);
          handleOpenTimeoutModal(pupil, 'timeout');
          break;
        case '5':
        case 'c':
        case 'C':
          e.preventDefault();
          setExpandedPupilId(pupil.id);
          handleOpenTimeoutModal(pupil, 'cooldown');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    targetPupil,
    activeCardModal,
    redCardTarget,
    timeoutTarget,
    isLwView,
    isAllClassesView,
    currentClass.id,
    currentClass.name,
  ]);

  // The tile shows the pupil-level vote rank. This subject is only the fallback
  // for pupils without submitted votes, and the evidence panel below still shows
  // every subject's rubric result.
  const currentLesson = timetableData?.currentLesson ?? null;
  const currentLessonClassName =
    currentLesson?.className || currentLesson?.class_name || null;
  const currentLessonMatchesClass =
    !!currentLesson &&
    !!currentClass &&
    (currentLessonClassName === currentClass.name ||
      currentLesson.classId === currentClass.id) &&
    (currentClass.mySubjects ?? []).some(
      (s) => s.code === (currentLesson.subjectCode || currentLesson.subject_code),
    );

  const lessonSubjectCode =
    (currentLessonMatchesClass
      ? currentLesson?.subjectCode || currentLesson?.subject_code
      : null) || currentClass?.mySubjects?.[0]?.code;

  const activeLwPupilIds = useMemo(
    () => new Set(activeTimeouts.map((ti) => ti.pupil_id)),
    [activeTimeouts],
  );

  // Class-level counters for filter chips & bottom floating summary capsule.
  const classSummary = useMemo(() => {
    let green = 0;
    let yellow = 0;
    let incidents = 0;
    let flaggedCount = 0;
    let activeLwCount = 0;

    for (const p of pupils) {
      const pCards = cards.filter((c) => c.pupil_id === p.id);
      const pGreen = pCards.filter((c) => c.card_type === 'green').length;
      const pYellow = pCards.filter((c) => c.card_type === 'yellow').length;
      const pRed = pCards.filter((c) => c.card_type === 'red').length;
      const pTimeouts = classTimeouts.filter(
        (ti) => ti.pupil_id === p.id && (ti.kind === 'timeout' || !ti.kind),
      ).length;
      const isActiveLw = activeLwPupilIds.has(p.id);

      green += pGreen;
      yellow += pYellow;
      incidents += pRed + pTimeouts;
      if (isActiveLw) activeLwCount += 1;
      if (pYellow > 0 || pRed > 0 || isActiveLw) flaggedCount += 1;
    }

    return { green, yellow, incidents, flaggedCount, activeLwCount };
  }, [pupils, cards, classTimeouts, activeLwPupilIds]);

  // Filtered and sorted pupils list. Sorting is intentionally client-side: the
  // whole class roster and its card/time-out counters are already loaded, so
  // changing the order must not refetch or mutate anything.
  const filteredPupils = useMemo(() => {
    const rankOrder: Record<AssessmentRank | 'Ausstehend', number> = {
      Meister: 3,
      Geselle: 2,
      Lehrling: 1,
      Ausstehend: 0,
    };
    const byName = (a: PupilWithData, b: PupilWithData) =>
      a.fullName.localeCompare(b.fullName, 'de', { sensitivity: 'base' });

    const decorated = pupils
      .map((p) => {
        const { demotionSteps, subjectResults } = getPupilRank(p);
        const displayedRank = getDisplayedRank(p, subjectResults, demotionSteps);
        const pupilCards = cards.filter((c) => c.pupil_id === p.id);
        const green = pupilCards.filter((c) => c.card_type === 'green').length;
        const yellow = pupilCards.filter((c) => c.card_type === 'yellow').length;
        const red = pupilCards.filter((c) => c.card_type === 'red').length;
        const timeouts = classTimeouts.filter(
          (ti) => ti.pupil_id === p.id && (ti.kind === 'timeout' || !ti.kind),
        ).length;
        const hasActiveLw = activeLwPupilIds.has(p.id);
        return {
          pupil: p,
          displayedRank,
          green,
          yellow,
          red,
          timeouts,
          hasActiveLw,
          incidents: yellow + red + timeouts,
        };
      })
      .filter((entry) => {
        const matchesSearch = entry.pupil.fullName
          .toLowerCase()
          .includes(searchQuery.toLowerCase());
        const matchesRank = filterRank === 'all' || entry.displayedRank === filterRank;
        const matchesQuick =
          quickFilter === 'all'
            ? true
            : quickFilter === 'flagged'
            ? entry.yellow > 0 || entry.red > 0 || entry.hasActiveLw
            : entry.hasActiveLw;
        return matchesSearch && matchesRank && matchesQuick;
      });

    decorated.sort((a, b) => {
      switch (sortMode) {
        case 'rank':
          return (
            rankOrder[b.displayedRank ?? 'Ausstehend'] -
              rankOrder[a.displayedRank ?? 'Ausstehend'] || byName(a.pupil, b.pupil)
          );
        case 'green':
          return b.green - a.green || byName(a.pupil, b.pupil);
        case 'yellow':
          return b.yellow - a.yellow || byName(a.pupil, b.pupil);
        case 'red':
          return b.red - a.red || byName(a.pupil, b.pupil);
        case 'timeout':
          return b.timeouts - a.timeouts || byName(a.pupil, b.pupil);
        case 'incidents':
          return b.incidents - a.incidents || byName(a.pupil, b.pupil);
        case 'name':
        default:
          return byName(a.pupil, b.pupil);
      }
    });

    return decorated.map((entry) => entry.pupil);
  }, [
    pupils,
    searchQuery,
    quickFilter,
    filterRank,
    sortMode,
    cards,
    classTimeouts,
    activeLwPupilIds,
    rubricItemKeys,
    currentClass?.mySubjects,
    lessonSubjectCode,
  ]);

  // Day names helper
  const dayNames = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];

  return (
    <div className="max-w-5xl mx-auto space-y-2.5">
      {/* Top Context Section */}
      <section className="flex flex-col gap-2.5 px-3.5 py-3 rounded-2xl bg-surface-1 border border-hairline/70 shadow-sm">
        {/* Class Meta Badge Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-accent-dim/20 text-accent text-2xs font-semibold shrink-0">
              <GraduationCap className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {isLwView
                  ? `Lernwerkstatt · ${activeTimeouts.length} aktiv`
                  : isAllClassesView
                  ? `Alle Klassen · ${allClassesData?.pupils.length ?? 0} Lernende`
                  : `${currentClass.name} · ${pupils.length} Lernende`}
              </span>
            </span>

            {timetableData && (
              <span className="text-on-surface-variant text-sm truncate">
                {timetableData.currentLesson
                  ? `${timetableData.period}. Std · ${timetableData.currentLesson.className || timetableData.currentLesson.class_name} (${timetableData.currentLesson.subjectCode || timetableData.currentLesson.subject_code})`
                  : timetableData.nextLesson
                  ? `${timetableData.period}. Std · Nächste: ${timetableData.nextLesson.className || timetableData.nextLesson.class_name}`
                  : `${dayNames[timetableData.dayOfWeek] || 'Heute'}, ${timetableData.period}. Std`}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {!isLwView && !isAllClassesView && timetableData?.todayLessons && timetableData.todayLessons.length > 0 && (
              <div className="hidden lg:flex items-center gap-1 mr-1">
                {timetableData.todayLessons.slice(0, 5).map((l: any, i: number) => {
                  const cName = l.className || l.class_name;
                  const sCode = l.subjectCode || l.subject_code;
                  const targetCls = classes.find((c) => c.name === cName);
                  const isThisLW = cName === 'LW' || sCode === 'LW';
                  const isCurrentTarget =
                    (isLwView && isThisLW) || (!isLwView && currentClass.name === cName);
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        if (isThisLW) {
                          setViewMode('lw');
                        } else if (targetCls) {
                          setViewMode('class');
                          onSelectClass(targetCls.id);
                        }
                      }}
                      className={`px-2 py-1 rounded-full text-2xs font-semibold transition focus-ring ${
                        isCurrentTarget
                          ? 'bg-accent/20 text-accent'
                          : 'bg-surface-3 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright'
                      }`}
                      title={`${l.period}. Stunde: ${cName} ${sCode}`}
                    >
                      {l.period}. {cName}
                    </button>
                  );
                })}
              </div>
            )}

            {currentUser.schoolWideBehaviour && (
              <button
                type="button"
                onClick={() => setViewMode(isAllClassesView ? 'class' : 'all')}
                aria-current={isAllClassesView ? 'true' : undefined}
                title="Alle Klassen: Schülerstatus sehen und Karten / Time-Outs / Cool-Downs vergeben"
                className={`pressable focus-ring px-2.5 py-1 rounded-full text-2xs font-semibold transition flex items-center gap-1.5 ${
                  isAllClassesView
                    ? 'bg-info text-surface-lowest shadow-sm'
                    : 'bg-surface-3 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright'
                }`}
              >
                <Users className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Alle Klassen</span>
              </button>
            )}

            {(isLwView || isAllClassesView) && (
              <button
                type="button"
                onClick={() => setViewMode('class')}
                className="pressable focus-ring px-2.5 py-1 rounded-full bg-surface-3 hover:bg-surface-bright text-on-surface text-2xs font-semibold transition"
              >
                Zurück zu {currentClass.name}
              </button>
            )}
          </div>
        </div>

        {/* Filter Toggle Chips & Search Bar (Class view only) */}
        {!isLwView && !isAllClassesView && (
          <>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              <button
                type="button"
                onClick={() => setQuickFilter('all')}
                className={`pressable focus-ring shrink-0 px-3 py-1.5 rounded-full text-sm font-semibold transition flex items-center gap-1.5 ${
                  quickFilter === 'all'
                    ? 'bg-accent text-on-accent shadow-sm'
                    : 'bg-surface-3 text-on-surface hover:bg-surface-bright'
                }`}
              >
                <span>Alle</span>
                <span
                  className={`min-w-[18px] h-4 px-1 rounded-full text-2xs font-bold tabular flex items-center justify-center ${
                    quickFilter === 'all'
                      ? 'bg-on-accent/20 text-on-accent'
                      : 'bg-surface-2 text-on-surface-variant'
                  }`}
                >
                  {pupils.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setQuickFilter(quickFilter === 'flagged' ? 'all' : 'flagged')}
                className={`pressable focus-ring shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-1.5 ${
                  quickFilter === 'flagged'
                    ? 'bg-accent text-on-accent font-semibold shadow-sm'
                    : 'bg-surface-3 text-on-surface hover:bg-surface-bright'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${quickFilter === 'flagged' ? 'bg-on-accent' : 'bg-accent-dim'}`} />
                <span>Auffällig</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-2xs font-bold tabular leading-none ${
                    quickFilter === 'flagged'
                      ? 'bg-on-accent/20 text-on-accent'
                      : 'bg-accent-dim/20 text-accent'
                  }`}
                >
                  {classSummary.flaggedCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setQuickFilter(quickFilter === 'lw' ? 'all' : 'lw')}
                className={`pressable focus-ring shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-1.5 ${
                  quickFilter === 'lw'
                    ? 'bg-critical text-surface-lowest font-semibold shadow-sm'
                    : 'bg-surface-3 text-on-surface hover:bg-surface-bright'
                }`}
              >
                <span className={`w-1.5 h-1.5 rounded-full ${quickFilter === 'lw' ? 'bg-surface-lowest' : 'bg-critical'}`} />
                <span>Lernwerkstatt</span>
                <span
                  className={`px-1.5 py-0.5 rounded-full text-2xs font-bold tabular leading-none ${
                    quickFilter === 'lw'
                      ? 'bg-surface-lowest/20 text-surface-lowest'
                      : 'bg-critical/20 text-critical-soft'
                  }`}
                >
                  {classSummary.activeLwCount}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowRankFilter((prev) => !prev)}
                aria-expanded={showRankFilter}
                className={`pressable focus-ring shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition flex items-center gap-1 ${
                  showRankFilter || filterRank !== 'all'
                    ? 'bg-surface-bright text-accent'
                    : 'bg-surface-3 text-on-surface-variant hover:text-on-surface'
                }`}
              >
                <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Filter{filterRank !== 'all' ? `: ${filterRank}` : ''}</span>
              </button>
            </div>

            {showRankFilter && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5 animate-row-reveal">
                {(['all', 'Lehrling', 'Geselle', 'Meister'] as const).map((rk) => (
                  <button
                    key={rk}
                    type="button"
                    onClick={() => setFilterRank(rk)}
                    className={`px-2.5 py-1 rounded-full text-2xs font-semibold transition focus-ring ${
                      filterRank === rk
                        ? 'bg-accent text-on-accent'
                        : 'bg-surface-2 text-on-surface-variant hover:bg-surface-bright hover:text-on-surface'
                    }`}
                  >
                    {rk === 'all' ? 'Alle Ränge' : rk}
                  </button>
                ))}
              </div>
            )}

            {/* Ultra-Compact Search & Sort Row */}
            <div className="flex items-center gap-2">
              <div className="relative flex-1 flex items-center">
                <Search className="w-4 h-4 text-on-surface-variant absolute left-3 pointer-events-none" aria-hidden="true" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Lernende suchen..."
                  className="w-full h-9 pl-9 pr-8 rounded-lg bg-surface-3 text-on-surface placeholder:text-on-surface-variant/70 text-sm focus:outline-none focus:bg-surface-bright transition selectable"
                />
                {searchQuery && (
                  <button
                    type="button"
                    aria-label="Suche leeren"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 p-1 rounded-md text-on-surface-variant hover:text-on-surface"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <div className="relative flex items-center shrink-0">
                <label htmlFor="pupil-sort" className="sr-only">
                  Sortieren:
                </label>
                <ArrowUpDown
                  className="w-3.5 h-3.5 text-on-surface-variant absolute left-2.5 pointer-events-none"
                  aria-hidden="true"
                />
                <select
                  id="pupil-sort"
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as PupilSortMode)}
                  className="h-9 pl-8 pr-2.5 rounded-lg bg-surface-3 hover:bg-surface-bright text-on-surface text-sm font-medium focus:outline-none cursor-pointer transition max-w-[175px]"
                >
                  {PUPIL_SORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ===================================================================== */}
      {/* LERNWERKSTATT (LW) LIVE VIEW FOR SUPERVISORS                          */}
      {/* ===================================================================== */}
      {isLwView ? (
        <div className="space-y-4">
          <div className="bg-surface-1 border border-hairline rounded-2xl p-4 sm:p-5 shadow-md">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-hairline">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-critical animate-pulse" />
                  <h2 className="text-lg font-bold text-on-surface">
                    Lernwerkstatt – Aktive Time-Out &amp; Cool-Down Schüler*innen
                  </h2>
                </div>
                <p className="text-sm text-on-surface-variant mt-0.5">
                  Disziplinäre Time-Outs und consequence-free Cool-Downs aus den Klassen.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3 py-1 rounded-full bg-surface-3 text-sm font-semibold text-on-surface tabular">
                  Aktuell im Raum: <strong className="text-critical">{activeTimeouts.length}</strong>
                </span>
                <button
                  type="button"
                  onClick={loadTimeoutsData}
                  className="pressable focus-ring min-h-[36px] px-3 py-1.5 rounded-xl bg-surface-3 hover:bg-surface-bright text-on-surface text-sm font-semibold transition"
                >
                  Aktualisieren
                </button>
              </div>
            </div>

            {/* Active Timeouts Grid */}
            <div className="pt-4">
              {loadingTimeouts && activeTimeouts.length === 0 ? (
                <div className="py-12 text-center text-on-surface-variant text-sm">
                  Lade Time-Out Daten...
                </div>
              ) : activeTimeouts.length === 0 ? (
                <div className="py-12 text-center text-on-surface-variant bg-surface-lowest/60 rounded-2xl border border-hairline">
                  <CheckCircle2 className="w-10 h-10 text-positive mx-auto mb-2 opacity-85" />
                  <p className="font-bold text-on-surface text-base">Aktuell keine Schüler im Time-Out oder Cool-Down!</p>
                  <p className="text-sm text-on-surface-variant mt-0.5">
                    Sobald eine Lehrkraft eine Schülerin / einen Schüler in die Lernwerkstatt schickt, erscheint sie/er hier live.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                  {activeTimeouts.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-surface-2 border ${item.kind === 'cooldown' ? 'border-info/50' : 'border-critical/50'} rounded-2xl p-4 shadow-md flex flex-col justify-between`}
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-2 py-0.5 rounded-full text-2xs font-bold inline-flex items-center gap-1 ${item.kind === 'cooldown' ? 'bg-info/20 text-info' : 'bg-critical/20 text-critical-soft animate-pulse'}`}>
                                {item.kind === 'cooldown' ? (
                                  <><Snowflake className="w-3 h-3" aria-hidden="true" /> Cool-Down aktiv</>
                                ) : (
                                  <><Clock className="w-3 h-3" aria-hidden="true" /> Time-Out aktiv</>
                                )}
                              </span>
                              <span className="text-sm font-semibold text-on-surface-variant">
                                Klasse {item.class_name}
                              </span>
                            </div>
                            <h3 className="text-lg font-bold text-on-surface">
                              {item.pupil_name}
                            </h3>
                          </div>

                          <div className="text-right text-2xs text-on-surface-variant tabular">
                            <div>von <strong className="text-accent">{item.sent_by_short}</strong></div>
                            <div className="mt-0.5">
                              {new Date(item.sent_at).toLocaleTimeString('de-AT', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })} Uhr · {formatElapsedMinutes(item.sent_at)}
                            </div>
                          </div>
                        </div>

                        <div className="bg-surface-lowest/70 border border-hairline rounded-xl p-3 mb-3.5">
                          <div className={`flex items-center gap-1.5 text-2xs font-bold uppercase mb-1 ${item.kind === 'cooldown' ? 'text-info' : 'text-accent'}`}>
                            <FileText className="w-3.5 h-3.5" />
                            <span>{item.kind === 'cooldown' ? 'Notiz / Beobachtung:' : 'Arbeitsauftrag:'}</span>
                          </div>
                          <p className="text-sm text-on-surface leading-relaxed selectable">
                            &bdquo;{item.task_assignment}&ldquo;
                          </p>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleResolveTimeout(item.id, item.pupil_name, item.kind)}
                        className="pressable focus-ring w-full py-2.5 px-4 rounded-xl bg-positive-dim hover:brightness-110 text-surface-lowest font-bold text-sm flex items-center justify-center gap-2 transition shadow-sm"
                      >
                        <Check className="w-4 h-4" />
                        <span>
                          {item.kind === 'cooldown'
                            ? 'Cool-Down beenden / Zurück in die Klasse'
                            : 'Arbeitsauftrag erledigt / Zurück in die Klasse'}
                        </span>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {timeoutHistory.length > 0 && (
            <div className="bg-surface-1 border border-hairline rounded-2xl p-4 shadow-md">
              <h3 className="font-bold text-on-surface text-sm mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-on-surface-variant" />
                <span>Kürzlich erledigte Lernwerkstatt-Einträge (letzte 48 Stunden)</span>
              </h3>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {timeoutHistory.map((h) => (
                  <div
                    key={h.id}
                    className="p-3 rounded-xl bg-surface-2 border border-hairline/70 text-sm flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-on-surface">
                        {h.pupil_name} ({h.class_name})
                        <span className={`ml-2 rounded-full px-2 py-0.5 text-2xs font-bold ${h.kind === 'cooldown' ? 'bg-info/15 text-info' : 'bg-critical/15 text-critical-soft'}`}>
                          {h.kind === 'cooldown' ? 'Cool-Down' : 'Time-Out'}
                        </span>
                        {h.retroactive && (
                          <span className="ml-1 rounded-full bg-surface-3 px-2 py-0.5 text-2xs font-bold text-on-surface-variant">
                            Nachtrag
                          </span>
                        )}
                        <span className="ml-2 text-on-surface-variant font-normal text-2xs">
                          von {h.sent_by_short} · {new Date(h.sent_at).toLocaleDateString('de-AT')} {new Date(h.sent_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-2xs text-on-surface-variant italic mt-0.5 truncate max-w-xl selectable">
                        &bdquo;{h.task_assignment}&ldquo;
                      </p>
                    </div>

                    <div className="text-right text-2xs text-positive shrink-0 font-bold">
                      {h.status === 'resolved' ? 'Erledigt' : 'Aktiv'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : isAllClassesView ? (
        <AllClassesBehaviorPanel
          data={allClassesData}
          loading={allClassesLoading}
          error={allClassesError}
          onRefresh={() => void loadAllClasses()}
          onAction={handleAllClassesAction}
        />
      ) : (
        /* ===================================================================== */
        /* STREAMLINED CLASSROOM ACTION ROWS                                     */
        /* ===================================================================== */
        <>
          <div className="divide-y divide-hairline/40">
            {filteredPupils.length === 0 ? (
              <div className="py-10 px-4 text-center bg-surface-1 rounded-2xl border border-hairline text-on-surface-variant text-sm space-y-2">
                <p>Keine Schüler gefunden für diese Auswahl.</p>
                <div className="flex items-center justify-center gap-2">
                  {(quickFilter !== 'all' || filterRank !== 'all' || searchQuery) && (
                    <button
                      type="button"
                      onClick={() => {
                        setQuickFilter('all');
                        setFilterRank('all');
                        setSearchQuery('');
                      }}
                      className="px-3 py-1.5 rounded-full bg-surface-3 hover:bg-surface-bright text-on-surface text-2xs font-semibold transition"
                    >
                      Filter zurücksetzen
                    </button>
                  )}
                  {quickFilter === 'lw' && (
                    <button
                      type="button"
                      onClick={() => setViewMode('lw')}
                      className="px-3 py-1.5 rounded-full bg-accent text-on-accent text-2xs font-bold transition"
                    >
                      Lernwerkstatt-Raum öffnen ({activeTimeouts.length})
                    </button>
                  )}
                </div>
              </div>
            ) : (
              filteredPupils.map((pupil, index) => {
                const isExpanded = expandedPupilId === pupil.id;
                const { demotionSteps, subjectResults } = getPupilRank(pupil);
                const pupilCards = cards.filter((c) => c.pupil_id === pupil.id);
                const greenCards = pupilCards.filter((c) => c.card_type === 'green');
                const yellowCards = pupilCards.filter((c) => c.card_type === 'yellow');
                const redCards = pupilCards.filter((c) => c.card_type === 'red');
                const cooldownCards = pupilCards.filter((c) => c.card_type === 'cooldown');

                const pupilTimeouts = classTimeouts.filter((ti) => ti.pupil_id === pupil.id);
                const timeoutCount = pupilTimeouts.filter((ti) => ti.kind === 'timeout' || !ti.kind).length;
                const cooldownCount =
                  cooldownCards.length > 0
                    ? cooldownCards.length
                    : pupilTimeouts.filter((ti) => ti.kind === 'cooldown').length;

                const isYellowAlert = yellowCards.length >= 2;
                const activeTimeoutIncident = activeTimeouts.find((ti) => ti.pupil_id === pupil.id);
                const currentRank = getDisplayedRank(pupil, subjectResults, demotionSteps);
                const rankLabel = currentRank ?? 'Ausstehend';

                const hasAlert = isYellowAlert || redCards.length > 0;
                const hasAnyIncidentOrCard =
                  greenCards.length > 0 ||
                  yellowCards.length > 0 ||
                  redCards.length > 0 ||
                  timeoutCount > 0 ||
                  cooldownCount > 0 ||
                  Boolean(activeTimeoutIncident);
                const isCleanMeister =
                  currentRank === 'Meister' && !hasAlert && yellowCards.length === 0 && !activeTimeoutIncident;

                const rankPillClass =
                  currentRank === 'Meister'
                    ? 'bg-positive-dim/20 text-positive'
                    : currentRank === 'Lehrling'
                    ? 'bg-critical/15 text-critical-soft'
                    : currentRank === 'Geselle'
                    ? 'bg-surface-3 text-on-surface-variant'
                    : 'bg-surface-2 text-on-surface-variant/75';

                return (
                  <div
                    key={pupil.id}
                    data-tour={index === 0 ? 'pupil-row' : undefined}
                    className={
                      isExpanded
                        ? 'flex flex-col bg-surface-3/85 rounded-xl my-1.5 overflow-hidden transition-all shadow-md border border-hairline'
                        : 'flex flex-col bg-surface-0 hover:bg-surface-1/80 transition-colors'
                    }
                  >
                    {/* Main Row Tappable Header */}
                    <div
                      onClick={() => setExpandedPupilId(isExpanded ? null : pupil.id)}
                      className="cursor-pointer flex items-center justify-between min-h-[60px] px-2.5 sm:px-3 py-1.5 gap-2"
                    >
                      {/* Left: Avatar + Name + Rank & Non-zero Micro Pills */}
                      <div className="flex items-center gap-2.5 min-w-0 flex-1">
                        <div className="relative shrink-0">
                          <div
                            className={`w-10 h-10 rounded-full flex items-center justify-center font-semibold text-sm tabular ${
                              isCleanMeister
                                ? 'bg-positive-dim/15 text-positive'
                                : isExpanded
                                ? 'bg-surface-1 text-on-surface'
                                : 'bg-surface-3 text-on-surface'
                            }`}
                          >
                            {getInitials(pupil.fullName)}
                          </div>
                          {activeTimeoutIncident ? (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-surface-1 flex items-center justify-center shadow-sm">
                              <span className="w-2.5 h-2.5 rounded-full bg-critical animate-pulse" />
                            </span>
                          ) : hasAlert ? (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-surface-1 flex items-center justify-center shadow-sm">
                              <span className="w-2.5 h-2.5 rounded-full bg-critical" />
                            </span>
                          ) : yellowCards.length > 0 ? (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-accent-dim border-2 border-surface-0" />
                          ) : isCleanMeister ? (
                            <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-surface-0 flex items-center justify-center">
                              <Star className="w-3 h-3 text-positive fill-positive" aria-hidden="true" />
                            </span>
                          ) : null}
                        </div>

                        <div className="flex flex-col min-w-0 pr-1">
                          <span
                            data-testid="pupil-name"
                            className="text-base font-semibold text-on-surface truncate leading-tight selectable"
                          >
                            {pupil.fullName}
                          </span>

                          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className={`inline-flex px-1.5 py-0.5 rounded-full text-2xs leading-tight font-semibold uppercase tracking-wide ${rankPillClass}`}>
                              {rankLabel}
                            </span>

                            {activeTimeoutIncident && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-critical/20 text-critical-soft text-2xs font-bold tabular leading-tight">
                                {activeTimeoutIncident.kind === 'cooldown' ? (
                                  <Snowflake className="w-3 h-3" aria-hidden="true" />
                                ) : (
                                  <Clock className="w-3 h-3" aria-hidden="true" />
                                )}
                                <span>
                                  {activeTimeoutIncident.kind === 'cooldown' ? 'CD' : 'LW'} · {formatElapsedMinutes(activeTimeoutIncident.sent_at)}
                                </span>
                              </span>
                            )}

                            {isYellowAlert && (
                              <span className="inline-flex px-1.5 py-0.5 rounded-full bg-critical/20 text-critical-soft text-2xs leading-tight font-semibold tracking-wide uppercase">
                                Mahnstufe
                              </span>
                            )}

                            {greenCards.length > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-positive-dim/20 text-positive text-2xs font-bold tabular leading-tight">
                                +{greenCards.length} Lob
                              </span>
                            )}

                            {yellowCards.length > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent-dim/25 text-accent text-2xs font-bold tabular leading-tight">
                                {yellowCards.length}× Gelb
                              </span>
                            )}

                            {redCards.length > 0 && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-critical/25 text-critical-soft text-2xs font-bold tabular leading-tight">
                                {redCards.length}× Rot
                              </span>
                            )}

                            {timeoutCount > 0 && !activeTimeoutIncident && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-warning/20 text-warning text-2xs font-bold tabular leading-tight">
                                {timeoutCount}× TO
                              </span>
                            )}

                            {cooldownCount > 0 && !activeTimeoutIncident && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-info/20 text-info text-2xs font-bold tabular leading-tight">
                                {cooldownCount}× CD
                              </span>
                            )}

                            {!hasAnyIncidentOrCard && (
                              <span className="text-on-surface-variant/65 text-2xs inline-flex items-center gap-0.5">
                                <Check className="w-3 h-3 text-positive" aria-hidden="true" />
                                <span>unauffällig</span>
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Right: Minimal Thumb Quick Actions (+ G, + Y, ⋮) or LW Return */}
                      <div
                        data-tour={index === 0 ? 'card-actions' : undefined}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1.5 shrink-0"
                      >
                        {activeTimeoutIncident ? (
                          <button
                            type="button"
                            onClick={() =>
                              handleResolveTimeout(
                                activeTimeoutIncident.id,
                                pupil.fullName,
                                activeTimeoutIncident.kind,
                              )
                            }
                            className="pressable focus-ring h-9 px-3 rounded-lg bg-surface-3 text-accent hover:bg-surface-bright transition-colors flex items-center justify-center gap-1 text-sm font-semibold"
                            title="Zurück in die Klasse"
                          >
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                            <span>Rückkehr</span>
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveCardModal({
                                  pupilId: pupil.id,
                                  pupilName: pupil.fullName,
                                  cardType: 'green',
                                  classId: currentClass.id,
                                  className: currentClass.name,
                                });
                                setCardNote('');
                              }}
                              className={`pressable focus-ring h-9 px-2.5 rounded-lg transition-colors flex items-center justify-center gap-0.5 text-sm font-bold ${
                                greenCards.length > 0 || currentRank === 'Meister'
                                  ? 'bg-positive-dim/20 text-positive hover:bg-positive-dim/30'
                                  : 'bg-surface-3 text-on-surface-variant hover:text-positive hover:bg-surface-bright'
                              }`}
                              title="Grüne Karte vergeben (Lob · Tastatur: 1)"
                              aria-label={`Grüne Karte für ${pupil.fullName}`}
                            >
                              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>G</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                setActiveCardModal({
                                  pupilId: pupil.id,
                                  pupilName: pupil.fullName,
                                  cardType: 'yellow',
                                  classId: currentClass.id,
                                  className: currentClass.name,
                                });
                                setCardNote('');
                              }}
                              className={`pressable focus-ring h-9 px-2.5 rounded-lg transition-colors flex items-center justify-center gap-0.5 text-sm font-bold ${
                                yellowCards.length > 0
                                  ? 'bg-accent-dim/25 text-accent hover:bg-accent-dim/35'
                                  : 'bg-surface-3 text-on-surface-variant hover:text-accent hover:bg-surface-bright'
                              }`}
                              title="Gelbe Karte vergeben (Mahnung · Tastatur: 2)"
                              aria-label={`Gelbe Karte für ${pupil.fullName}`}
                            >
                              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Y</span>
                            </button>
                          </>
                        )}

                        <button
                          type="button"
                          onClick={() => setExpandedPupilId(isExpanded ? null : pupil.id)}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Optionen und Details ausblenden' : 'Optionen und Details einblenden'}
                          title={isExpanded ? 'Details ausblenden' : 'Weitere Aktionen & Historie'}
                          className={`focus-ring w-8 h-9 rounded-lg flex items-center justify-center transition-colors ${
                            isExpanded
                              ? 'bg-surface-bright text-on-surface'
                              : 'text-on-surface-variant hover:text-on-surface hover:bg-surface-3'
                          }`}
                        >
                          <MoreVertical className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Expandable Drawer Content */}
                    {isExpanded && (
                      <div className="flex flex-col gap-2.5 px-3 pb-3 pt-2.5 bg-surface-lowest/70 border-t border-hairline/50 animate-row-reveal">
                        {/* Active LW Callout */}
                        {activeTimeoutIncident && (
                          <div className="flex items-start gap-2 p-2.5 rounded-lg bg-surface-3/90">
                            {activeTimeoutIncident.kind === 'cooldown' ? (
                              <Snowflake className="w-4 h-4 text-info shrink-0 mt-0.5" />
                            ) : (
                              <Clock className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between text-2xs text-on-surface-variant">
                                <span className="font-semibold text-accent">
                                  {activeTimeoutIncident.kind === 'cooldown'
                                    ? 'Aktuell im Cool-Down (Lernwerkstatt)'
                                    : 'Aktuell im Time-Out (Lernwerkstatt)'}
                                </span>
                                <span className="tabular">
                                  {activeTimeoutIncident.sent_by_short} · {new Date(activeTimeoutIncident.sent_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                              <p className="text-2xs text-on-surface mt-0.5 selectable">
                                &bdquo;{activeTimeoutIncident.task_assignment}&ldquo;
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Per-subject & Conference Evidence Summary */}
                        {(subjectResults.length > 0 || (pupil.finalRank && currentRank && currentRank !== pupil.finalRank)) && (
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-on-surface-variant">
                            {pupil.finalRank && currentRank && currentRank !== pupil.finalRank && (
                              <span className="text-critical-soft font-semibold">
                                Konferenzbeschluss: {pupil.finalRank} (herabgestuft auf {currentRank} durch Karten)
                              </span>
                            )}
                            {subjectResults.map((sr) => (
                              <span key={sr.subjectCode}>
                                {sr.subjectCode}: {sr.positiveCount}/{rubricItemKeys.length} positiv · Basis-Rang: {sr.baseRank ?? 'Ausstehend'}
                                {sr.hasRedCardDemotion && ` (herabgestuft auf ${sr.rank} durch Karten)`}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Card & Incident History */}
                        {pupilCards.length > 0 ? (
                          <div className="space-y-1.5">
                            {pupilCards.map((c) => (
                              <div
                                key={c.id}
                                className="flex items-start justify-between gap-2 p-2.5 rounded-lg bg-surface-3/85"
                              >
                                <div className="flex items-start gap-2 min-w-0 flex-1">
                                  <span
                                    className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${
                                      c.card_type === 'green'
                                        ? 'bg-positive'
                                        : c.card_type === 'yellow'
                                        ? 'bg-accent-dim'
                                        : c.card_type === 'cooldown'
                                        ? 'bg-info'
                                        : 'bg-critical'
                                    }`}
                                    aria-hidden="true"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-2 text-2xs">
                                      <span
                                        className={`font-semibold ${
                                          c.card_type === 'green'
                                            ? 'text-positive'
                                            : c.card_type === 'yellow'
                                            ? 'text-accent'
                                            : c.card_type === 'cooldown'
                                            ? 'text-info'
                                            : 'text-critical-soft'
                                        }`}
                                      >
                                        {c.card_type === 'green'
                                          ? 'Grüne Karte'
                                          : c.card_type === 'yellow'
                                          ? 'Gelbe Karte'
                                          : c.card_type === 'cooldown'
                                          ? 'Cool-Down'
                                          : 'Rote Karte'}
                                      </span>
                                      <span className="text-on-surface-variant tabular shrink-0">
                                        {c.teacher_short} · {new Date(c.created_at).toLocaleDateString('de-AT')} {new Date(c.created_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    <CardNoteEditor
                                      cardId={c.id}
                                      cardType={c.card_type}
                                      note={c.note}
                                      canEdit={canEditCardNote(c, currentUser, currentClass?.isKv)}
                                      isEditing={editingCardId === c.id}
                                      onStartEdit={() => setEditingCardId(c.id)}
                                      onCancelEdit={() => setEditingCardId(null)}
                                      onSaved={async (updatedNote) => {
                                        setCards((prev) =>
                                          prev.map((item) =>
                                            item.id === c.id ? { ...item, note: updatedNote } : item,
                                          ),
                                        );
                                        setEditingCardId(null);
                                        await loadClassCards(c.class_id);
                                      }}
                                    />
                                  </div>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRevokeCard(c);
                                  }}
                                  className="p-1 text-on-surface-variant hover:text-critical rounded-lg hover:bg-surface-2 transition shrink-0"
                                  title="Karte zurücknehmen"
                                  aria-label="Karte zurücknehmen"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-2xs text-on-surface-variant italic">
                            Noch keine Verhaltenskarten erfasst.
                          </p>
                        )}

                        {/* Quick Observation Note Bar */}
                        <div className="flex items-center gap-1.5">
                          <input
                            type="text"
                            placeholder="Kurznotiz hinzufügen (als grüne Karte)..."
                            value={inlineNotes[pupil.id] || ''}
                            onChange={(e) =>
                              setInlineNotes((prev) => ({ ...prev, [pupil.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveInlineNote(pupil.id);
                            }}
                            className="h-9 px-3 rounded-lg bg-surface-2 text-on-surface placeholder:text-on-surface-variant/60 text-sm flex-1 focus:outline-none focus:bg-surface-3 border border-hairline/60 selectable"
                          />
                          <button
                            type="button"
                            onClick={() => handleSaveInlineNote(pupil.id)}
                            disabled={savingInlineNote === pupil.id || !inlineNotes[pupil.id]?.trim()}
                            aria-label="Kurznotiz speichern"
                            className="pressable focus-ring h-9 px-3 rounded-lg bg-surface-3 hover:bg-surface-bright text-accent hover:text-on-surface flex items-center justify-center transition disabled:opacity-40"
                          >
                            <Send className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>

                        {/* Direct Escalation & Profile Action Pills */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 pt-0.5">
                          <button
                            type="button"
                            onClick={() => handleOpenRedCardModal(pupil)}
                            title="Rote Karte vergeben (sofortiger Rangverlust · Tastatur: 3)"
                            className="pressable focus-ring h-9 rounded-lg bg-surface-2 hover:bg-surface-bright text-on-surface text-2xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            <ShieldAlertIcon className="w-3.5 h-3.5 text-critical" aria-hidden="true" />
                            <span>Rot</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenTimeoutModal(pupil, 'timeout')}
                            title="Ins Time-Out (Lernwerkstatt) schicken (Tastatur: 4)"
                            className="pressable focus-ring h-9 rounded-lg bg-surface-2 hover:bg-surface-bright text-on-surface text-2xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            <Clock className="w-3.5 h-3.5 text-accent" aria-hidden="true" />
                            <span>Time-Out</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => handleOpenTimeoutModal(pupil, 'cooldown')}
                            title="Cool-Down in die Lernwerkstatt (kein Rangverlust, Notiz möglich · Tastatur: 5)"
                            className="pressable focus-ring h-9 rounded-lg bg-surface-2 hover:bg-surface-bright text-on-surface text-2xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            <Snowflake className="w-3.5 h-3.5 text-info" aria-hidden="true" />
                            <span>Cool-Down</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => setActiveProfilePupilId(pupil.id)}
                            title="Verhaltensprofil & Stufenpyramide öffnen"
                            className="pressable focus-ring h-9 rounded-lg bg-surface-2 hover:bg-surface-bright text-on-surface text-2xs font-semibold flex items-center justify-center gap-1.5 transition"
                          >
                            <UserIcon className="w-3.5 h-3.5 text-on-surface-variant" aria-hidden="true" />
                            <span>Profil</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Bottom Floating Triage / Summary Capsule */}
          {pupils.length > 0 && (
            <div className="sticky bottom-20 md:bottom-4 z-30 mt-3 no-print">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-surface-3/95 backdrop-blur-md border border-hairline-strong shadow-xl">
                <div className="flex items-center gap-2 min-w-0 tabular text-sm">
                  <div className="flex items-center gap-1 text-positive font-semibold">
                    <span className="w-2 h-2 rounded-full bg-positive" />
                    <span>{classSummary.green} Positiv</span>
                  </div>
                  <span className="text-on-surface-variant/40">·</span>
                  <div className="flex items-center gap-1 text-accent font-semibold">
                    <span className="w-2 h-2 rounded-full bg-accent-dim" />
                    <span>{classSummary.yellow} Gelb</span>
                  </div>
                  <span className="text-on-surface-variant/40">·</span>
                  <div className="flex items-center gap-1 text-critical-soft font-semibold">
                    <span className="w-2 h-2 rounded-full bg-critical" />
                    <span>{classSummary.incidents} Vorfälle</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setViewMode('lw')}
                  className="pressable focus-ring h-8 px-3 rounded-lg bg-accent text-on-accent text-sm font-bold flex items-center gap-1.5 shrink-0 shadow-sm transition"
                >
                  <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>
                    Lernwerkstatt{activeTimeouts.length > 0 ? ` (${activeTimeouts.length})` : ''}
                  </span>
                </button>
              </div>
            </div>
          )}
        </>
      )}

      <SchulalltagActionSheets
        activeCardModal={activeCardModal}
        onCloseCardModal={() => setActiveCardModal(null)}
        cardNote={cardNote}
        onCardNoteChange={setCardNote}
        submittingCard={submittingCard}
        onConfirmCard={handleConfirmCard}
        redCardTarget={redCardTarget}
        onCloseRedCard={() => setRedCardTarget(null)}
        redCardStep={redCardStep}
        onRedCardStepChange={setRedCardStep}
        redCardNote={redCardNote}
        onRedCardNoteChange={setRedCardNote}
        submittingRedCard={submittingRedCard}
        onConfirmRedCard={handleConfirmRedCard}
        timeoutTarget={timeoutTarget}
        onCloseTimeout={() => setTimeoutTarget(null)}
        timeoutTask={timeoutTask}
        onTimeoutTaskChange={setTimeoutTask}
        timeoutRetroactive={timeoutRetroactive}
        onTimeoutRetroactiveChange={setTimeoutRetroactive}
        timeoutRetroDate={timeoutRetroDate}
        onTimeoutRetroDateChange={setTimeoutRetroDate}
        timeoutRetroPeriod={timeoutRetroPeriod}
        onTimeoutRetroPeriodChange={setTimeoutRetroPeriod}
        submittingTimeout={submittingTimeout}
        onConfirmTimeout={handleConfirmTimeout}
      />

      {/* Modal: Schüler-Verhaltensprofil & Stufenpyramide */}
      {activeProfilePupilId && (
        <PupilProfileModal
          pupilId={activeProfilePupilId}
          currentUser={currentUser}
          isKv={currentClass?.isKv}
          onClose={() => setActiveProfilePupilId(null)}
          onRefreshParent={() => {
            if (currentClass) loadClassCards(currentClass.id);
            onRefreshClassData();
          }}
        />
      )}
    </div>
  );
};
