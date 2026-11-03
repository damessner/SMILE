import React, { useState, useEffect, useMemo } from 'react';
import {
  Users,
  Award,
  AlertTriangle,
  Clock,
  Calendar,
  Search,
  Plus,
  Check,
  X,
  FileText,
  RotateCcw,
  Sparkles,
  ChevronRight,
  MessageSquare,
  ShieldAlert,
  Flame,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Snowflake,
  ShieldAlert as ShieldAlertIcon,
} from 'lucide-react';
import { SchoolClass, PupilWithData, User, RubricCriterion } from '../types';
import { scoreSubject, type AssessmentRank } from '../lib/pupilItems';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { PupilProfileModal } from './PupilProfileModal';
import {
  issueCard,
  revokeCard,
  getClassCards,
  getCurrentTimetable,
  sendToTimeout,
  sendToCooldown,
  getActiveTimeouts,
  resolveTimeout,
  getTimeoutHistory,
} from '../services/api';

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

interface TimeoutItem {
  id: string;
  pupil_id: number;
  class_id: number;
  sent_by_teacher_id: number;
  sent_at: string;
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
  onRefreshClassData: () => void;
  criteria: RubricCriterion[];
}

export const Schulalltag: React.FC<SchulalltagProps> = ({
  currentClass,
  classes,
  pupils,
  currentUser,
  onSelectClass,
  onRefreshClassData,
  criteria,
}) => {
  const [cards, setCards] = useState<BehaviorCardItem[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [timetableData, setTimetableData] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRank, setFilterRank] = useState<'all' | 'Lehrling' | 'Geselle' | 'Meister'>('all');
  const [expandedPupilId, setExpandedPupilId] = useState<number | null>(null);
  const [activeProfilePupilId, setActiveProfilePupilId] = useState<number | null>(null);

  // Lernwerkstatt (LW) View Toggle
  const [isLwView, setIsLwView] = useState(false);
  const [activeTimeouts, setActiveTimeouts] = useState<TimeoutItem[]>([]);
  const [timeoutHistory, setTimeoutHistory] = useState<TimeoutItem[]>([]);
  const [loadingTimeouts, setLoadingTimeouts] = useState(false);

  // Modal for standard green or yellow card
  const [activeCardModal, setActiveCardModal] = useState<{
    pupilId: number;
    pupilName: string;
    cardType: 'green' | 'yellow';
  } | null>(null);
  const [cardNote, setCardNote] = useState('');
  const [submittingCard, setSubmittingCard] = useState(false);

  // Two-Step Security Modal for ROTE Karte (Instant Rank Loss)
  const [redCardTarget, setRedCardTarget] = useState<{
    pupilId: number;
    pupilName: string;
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
  } | null>(null);
  const [timeoutTask, setTimeoutTask] = useState('');
  const [submittingTimeout, setSubmittingTimeout] = useState(false);

  // Quick inline note state per pupil
  const [inlineNotes, setInlineNotes] = useState<Record<number, string>>({});
  const [savingInlineNote, setSavingInlineNote] = useState<number | null>(null);

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
          setIsLwView(true);
        }
      })
      .catch((e) => console.error('Timetable fetch error:', e));
  }, []);

  // Load cards for current class
  const loadClassCards = async (cid: number) => {
    setLoadingCards(true);
    try {
      const res = await getClassCards(cid);
      setCards(res);
    } catch (e) {
      console.error('Error fetching cards:', e);
    } finally {
      setLoadingCards(false);
    }
  };

  useEffect(() => {
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
      setTimeoutHistory(hist || []);
    } catch (e) {
      console.error('Error fetching timeouts:', e);
    } finally {
      setLoadingTimeouts(false);
    }
  };

  useEffect(() => {
    loadTimeoutsData();
    const interval = setInterval(loadTimeoutsData, 15000); // Poll every 15s for live updates
    const handleTimeoutsUpdated = () => {
      void loadTimeoutsData();
    };
    window.addEventListener('smile:timeouts-updated', handleTimeoutsUpdated);
    return () => {
      clearInterval(interval);
      window.removeEventListener('smile:timeouts-updated', handleTimeoutsUpdated);
    };
  }, []);

  const rubricItemKeys = useMemo(
    () => Array.from(new Set(criteria.flatMap((c) => c.items.map((i) => i.key)))),
    [criteria],
  );

  const getPupilSubjectResults = (p: PupilWithData) => {
    const subjectsToScore =
      currentClass?.mySubjects && currentClass.mySubjects.length > 0
        ? currentClass.mySubjects
        : Array.from(new Set(p.evaluations.map((e) => e.subjectCode))).map((code) => ({
            code,
            name: code,
          }));

    const pupilCards = Array.isArray(cards) ? cards.filter((c) => c.pupil_id === p.id) : [];
    const activeRedCards = pupilCards.filter((c) => c.card_type === 'red');
    const hasRedCard = activeRedCards.length > 0;

    return subjectsToScore.map((s) => {
      const scored = scoreSubject(p.evaluations, s.code, rubricItemKeys);
      const baseRank = scored.rank;
      let rank: AssessmentRank | null = baseRank;
      let hasRedCardDemotion = false;

      if (hasRedCard && baseRank) {
        if (baseRank === 'Meister') {
          rank = 'Geselle';
          hasRedCardDemotion = true;
        } else if (baseRank === 'Geselle') {
          rank = 'Lehrling';
          hasRedCardDemotion = true;
        } else {
          rank = 'Lehrling';
        }
      }

      const displayRank = rank ?? 'Ausstehend';
      const label = `${s.code} ${scored.positiveCount}/${rubricItemKeys.length} ${displayRank}`;

      return {
        subjectCode: s.code,
        positiveCount: scored.positiveCount,
        totalRated: scored.totalRated,
        baseRank,
        rank,
        hasRedCardDemotion,
        label,
      };
    });
  };

  const getPupilRank = (p: PupilWithData) => {
    // Per-subject results only. A pupil-level rank is deliberately not derived:
    // with subject-scoped scoring there is no single rank to read off `results[0]`
    // (that fabricates one whenever the subject order changes), and every consumer
    // below works per subject - the modal from `subjectResults`, the detail panel
    // from the same list. `hasRedCardDemotion` is likewise per subject only.
    const results = getPupilSubjectResults(p);
    const pupilCards = Array.isArray(cards) ? cards.filter((c) => c.pupil_id === p.id) : [];
    const activeRedCards = pupilCards.filter((c) => c.card_type === 'red');

    return {
      hasRedCard: activeRedCards.length > 0,
      redCardCount: activeRedCards.length,
      subjectResults: results,
    };
  };

  // Submit standard card (green or yellow)
  const handleConfirmCard = async () => {
    if (!activeCardModal || !currentClass) return;
    setSubmittingCard(true);
    const target = activeCardModal;
    const note = cardNote.trim() || undefined;
    try {
      const res = await issueCard(target.pupilId, currentClass.id, target.cardType, note);
      await loadClassCards(currentClass.id);
      onRefreshClassData();
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
              await loadClassCards(currentClass.id);
              onRefreshClassData();
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
  const handleOpenRedCardModal = (pupil: PupilWithData) => {
    const { subjectResults } = getPupilRank(pupil);

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

    setRedCardTarget({
      pupilId: pupil.id,
      pupilName: pupil.fullName,
      deductions,
      pendingNote:
        pendingSubjects.length > 0
          ? `In ${pendingSubjects.join(', ')} liegt noch keine Bewertung vor – kein Rangverlust.`
          : null,
    });
    setRedCardStep(1);
    setRedCardNote('');
  };

  // Confirm Red Card (Step 2 submit)
  const handleConfirmRedCard = async () => {
    if (!redCardTarget || !currentClass) return;
    if (!redCardNote.trim()) {
      toast.error('Bitte geben Sie eine Beschreibung des Vorfalls an.');
      return;
    }

    setSubmittingRedCard(true);
    const target = redCardTarget;
    const note = redCardNote.trim();
    try {
      const res = await issueCard(target.pupilId, currentClass.id, 'red', note);
      await loadClassCards(currentClass.id);
      onRefreshClassData();
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
                await loadClassCards(currentClass.id);
                onRefreshClassData();
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
  const handleOpenTimeoutModal = (pupil: PupilWithData, kind: 'timeout' | 'cooldown' = 'timeout') => {
    setTimeoutTarget({
      pupilId: pupil.id,
      pupilName: pupil.fullName,
      kind,
    });
    setTimeoutTask('');
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
    try {
      const res = isCooldown
        ? await sendToCooldown(target.pupilId, currentClass.id, task || undefined)
        : await sendToTimeout(target.pupilId, currentClass.id, task);
      await loadClassCards(currentClass.id);
      await loadTimeoutsData();
      onRefreshClassData();
      setTimeoutTarget(null);
      setTimeoutTask('');

      // Undo has to undo every record the action created. A Cool-Down creates no
      // red card, so there is no rank loss to reverse there.
      toast.success(
        isCooldown
          ? `${target.pupilName} ist im Cool-Down (Lernwerkstatt), kein Rangverlust.`
          : `${target.pupilName} ist im Time-Out. Rote Karte eingetragen.`,
        {
          action: {
            label: 'Rückgängig',
            onClick: async () => {
              try {
                await resolveTimeout(res.incident.id, 'Rückgängig: Lernwerkstatt-Eintrag aufgehoben');
                if (res.redCard?.id) await revokeCard(res.redCard.id);
                if (res.cooldownCard?.id) await revokeCard(res.cooldownCard.id);
                await loadClassCards(currentClass.id);
                await loadTimeoutsData();
                onRefreshClassData();
                toast.success(
                  isCooldown
                    ? 'Cool-Down aufgehoben.'
                    : 'Time-Out aufgehoben, Rangverlust zurückgenommen.',
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
      if (currentClass) await loadClassCards(currentClass.id);
      onRefreshClassData();
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
      if (isLwView) return;
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
          setActiveCardModal({ pupilId: pupil.id, pupilName: pupil.fullName, cardType: 'green' });
          break;
        case '2':
        case 'y':
        case 'Y':
          e.preventDefault();
          setExpandedPupilId(pupil.id);
          setActiveCardModal({ pupilId: pupil.id, pupilName: pupil.fullName, cardType: 'yellow' });
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
  ]);

  // The class tile is ranked for the subject of the lesson running now — but only
  // when the teacher is actually looking at that lesson's class. If they switch to
  // another class, use that class's first subject instead of a foreign rank.
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

  // Filtered pupils list
  const filteredPupils = useMemo(() => {
    return pupils.filter((p) => {
      const matchesSearch = p.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      const pResults = getPupilSubjectResults(p);
      const displayed =
        pResults.find((r) => r.subjectCode === lessonSubjectCode) ?? pResults[0] ?? null;
      const matchesRank = filterRank === 'all' || displayed?.rank === filterRank;
      return matchesSearch && matchesRank;
    });
  }, [
    pupils,
    searchQuery,
    filterRank,
    cards,
    rubricItemKeys,
    currentClass?.mySubjects,
    lessonSubjectCode,
  ]);

  // Day names helper
  const dayNames = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];

  return (
    <div className="space-y-3">
      {/* Top Banner: Timetable & Active Classroom Info (Compact) */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-3.5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pb-2.5 border-b border-slate-800/80">
          <div className="flex items-center gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            <h1 className="text-lg font-bold text-slate-50">
              {isLwView ? 'Lernwerkstatt (LW)' : currentClass ? `Klasse ${currentClass.name}` : 'Klasse'}
            </h1>
            <span className="text-xs text-slate-400">
              {isLwView
                ? `(${activeTimeouts.length} in der Lernwerkstatt)`
                : `(${pupils.length} Schüler*innen)`}
            </span>
          </div>

          {/* Timetable Indicator (Compact) */}
          {timetableData && (
            <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl px-3 py-1.5 flex items-center gap-3 text-xs">
              <div className="flex items-center gap-1.5 text-slate-300">
                <Clock className="w-3.5 h-3.5 text-amber-400" />
                <span>
                  <strong>{dayNames[timetableData.dayOfWeek] || 'Heute'}</strong>, {timetableData.period}. Std
                </span>
              </div>
              {timetableData.currentLesson ? (
                <div className="flex items-center gap-1.5 pl-2.5 border-l border-slate-800 text-emerald-400 font-bold">
                  <span className="bg-emerald-500/20 px-1.5 py-0.5 rounded text-[11px] border border-emerald-500/30">
                    {timetableData.currentLesson.className || timetableData.currentLesson.class_name} ({timetableData.currentLesson.subjectCode || timetableData.currentLesson.subject_code})
                  </span>
                </div>
              ) : (
                <div className="pl-2.5 border-l border-slate-800 text-slate-400 text-[11px]">
                  {timetableData.nextLesson ? (
                    <span>Nächste: <strong>{timetableData.nextLesson.className || timetableData.nextLesson.class_name}</strong></span>
                  ) : (
                    <span>Keine Stunde</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Class Selection Tabs & LW Pill */}
        <div className="pt-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div data-tour="class-selector" className="flex items-center gap-1.5 overflow-x-auto pb-1 max-w-2xl">
            <span className="text-xs font-bold text-slate-400 mr-1 flex-shrink-0">Bereich:</span>

            {/* Special LW Button */}
            <button
              onClick={() => setIsLwView(true)}
              className={`min-h-[44px] px-3 py-2 rounded-xl font-bold text-xs transition flex-shrink-0 flex items-center gap-1.5 ${
                isLwView
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md'
                  : 'bg-slate-800/80 text-amber-300 hover:text-slate-50 hover:bg-slate-700 border border-amber-500/30'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Lernwerkstatt (LW)</span>
              {activeTimeouts.length > 0 && (
                <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-slate-50 font-bold text-[10px] animate-pulse">
                  {activeTimeouts.length}
                </span>
              )}
            </button>

            <span className="text-slate-700">|</span>

            {classes.filter((c) => c.name !== 'LW').map((cls) => (
              <button
                key={cls.id}
                onClick={() => {
                  setIsLwView(false);
                  onSelectClass(cls.id);
                }}
                className={`min-h-[44px] px-3 py-2 rounded-xl font-bold text-xs transition flex-shrink-0 flex items-center gap-1.5 ${
                  !isLwView && currentClass?.id === cls.id
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-sm'
                    : 'bg-slate-800/80 text-slate-300 hover:text-slate-50 hover:bg-slate-700'
                }`}
              >
                <span>{cls.name}</span>
                {(timetableData?.currentLesson?.className === cls.name || timetableData?.currentLesson?.class_name === cls.name) && (
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" title="Aktuell lt. Stundenplan" />
                )}
              </button>
            ))}
          </div>

          {/* Today's Schedule Quick Links for this Teacher */}
          {timetableData?.todayLessons && timetableData.todayLessons.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs overflow-x-auto">
              <span className="text-[11px] text-slate-500 font-bold uppercase mr-1">Heute:</span>
              {timetableData.todayLessons.map((l: any, i: number) => {
                const cName = l.className || l.class_name;
                const sCode = l.subjectCode || l.subject_code;
                const targetCls = classes.find((c) => c.name === cName);
                const isThisLW = cName === 'LW' || sCode === 'LW';

                return (
                  <button
                    key={i}
                    onClick={() => {
                      if (isThisLW) {
                        setIsLwView(true);
                      } else if (targetCls) {
                        setIsLwView(false);
                        onSelectClass(targetCls.id);
                      }
                    }}
                    className={`min-h-[40px] px-2.5 py-1.5 rounded-xl text-xs font-bold border transition ${
                      (isLwView && isThisLW) || (!isLwView && currentClass.name === cName)
                        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
                        : 'bg-slate-800 text-slate-400 hover:text-slate-50 border-slate-700'
                    }`}
                    title={`${l.period}. Stunde: ${cName} ${sCode} (Raum ${l.room})`}
                  >
                    {l.period}. Std: {cName}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* LERNWERKSTATT (LW) LIVE VIEW FOR SUPERVISORS                          */}
      {/* ===================================================================== */}
      {isLwView ? (
        <div className="space-y-6">
          <div className="bg-slate-900 border-2 border-amber-500/30 rounded-3xl p-6 shadow-lg">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full bg-rose-500 animate-pulse" />
                  <h2 className="text-xl font-bold text-slate-50">
                    Lernwerkstatt – Aktive Time-Out &amp; Cool-Down Schüler*innen
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Disziplinäre Time-Outs und consequence-free Cool-Downs aus den Klassen.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <span className="px-3.5 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs font-bold text-slate-300">
                  Aktuell im Raum: <strong className="text-rose-400 text-sm">{activeTimeouts.length}</strong>
                </span>
                <button
                  onClick={loadTimeoutsData}
                  className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-50 text-xs font-bold transition"
                >
                  Aktualisieren
                </button>
              </div>
            </div>

            {/* Active Timeouts Grid */}
            <div className="pt-5">
              {loadingTimeouts && activeTimeouts.length === 0 ? (
                <div className="py-16 text-center text-slate-500 text-sm">
                  Lade Time-Out Daten...
                </div>
              ) : activeTimeouts.length === 0 ? (
                <div className="py-16 text-center text-slate-400 bg-slate-950/40 rounded-2xl border border-slate-800/80">
                  <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2 opacity-80" />
                  <p className="font-bold text-slate-50 text-base">Aktuell keine Schüler im Time-Out oder Cool-Down!</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sobald eine Lehrkraft eine Schülerin / einen Schüler in die Lernwerkstatt schickt, erscheint sie/er hier live.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeTimeouts.map((item) => (
                    <div
                      key={item.id}
                      className={`bg-slate-950 border-2 ${item.kind === 'cooldown' ? 'border-sky-500/50' : 'border-rose-500/50'} rounded-3xl p-5 shadow-lg flex flex-col justify-between`}
                    >
                      <div>
                        {/* Header: Pupil Name & Class */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className={`px-2.5 py-0.5 rounded-lg border text-[11px] font-bold ${item.kind === 'cooldown' ? 'bg-sky-500/20 text-sky-300 border-sky-500/40' : 'bg-rose-500/20 text-rose-300 border-rose-500/40 animate-pulse'}`}>
                                {item.kind === 'cooldown' ? (
                                  <><Snowflake className="w-3.5 h-3.5 inline" aria-hidden="true" /> Cool-Down aktiv</>
                                ) : (
                                  <><Clock className="w-3.5 h-3.5 inline" aria-hidden="true" /> Time-Out aktiv</>
                                )}
                              </span>
                              <span className="text-xs font-bold text-slate-400">
                                Klasse {item.class_name}
                              </span>
                            </div>
                            <h3 className="text-xl font-bold text-slate-50">
                              {item.pupil_name}
                            </h3>
                          </div>

                          <div className="text-right text-[11px] text-slate-400">
                            <div>Geschickt von <strong className="text-amber-400">{item.sent_by_short}</strong></div>
                            <div className="text-slate-500 mt-0.5">
                              {new Date(item.sent_at).toLocaleTimeString('de-AT', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })} Uhr
                            </div>
                          </div>
                        </div>

                        {/* Arbeitsauftrag Box */}
                        <div className="bg-slate-900 border border-amber-500/30 rounded-2xl p-4 mb-4">
                          <div className={`flex items-center gap-1.5 text-[11px] font-bold uppercase mb-1.5 ${item.kind === 'cooldown' ? 'text-sky-300' : 'text-amber-300'}`}>
                            <FileText className="w-3.5 h-3.5" />
                            <span>{item.kind === 'cooldown' ? 'Notiz / Beobachtung:' : 'Arbeitsauftrag der Lehrperson:'}</span>
                          </div>
                          <p className="text-xs text-slate-50 leading-relaxed font-medium bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                            &bdquo;{item.task_assignment}&ldquo;
                          </p>
                        </div>
                      </div>

                      {/* Action: Resolve and send back */}
                      <button
                        onClick={() => handleResolveTimeout(item.id, item.pupil_name, item.kind)}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-sm active:scale-95"
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

          {/* Today's Resolved History */}
          {timeoutHistory.length > 0 && (
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-lg">
              <h3 className="font-bold text-slate-50 text-sm mb-3 flex items-center gap-2">
                <Clock className="w-4 h-4 text-slate-400" />
                <span>Kürzlich erledigte Lernwerkstatt-Einträge (letzte 48 Stunden)</span>
              </h3>

              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {timeoutHistory.map((h) => (
                  <div
                    key={h.id}
                    className="p-3 rounded-2xl surface-1 text-xs flex items-center justify-between gap-3"
                  >
                    <div>
                      <div className="font-bold text-slate-50">
                        {h.pupil_name} ({h.class_name})
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-bold ${h.kind === 'cooldown' ? 'bg-sky-500/15 text-sky-300' : 'bg-rose-500/15 text-rose-300'}`}>
                          {h.kind === 'cooldown' ? 'Cool-Down' : 'Time-Out'}
                        </span>
                        <span className="ml-2 text-slate-500 font-normal">
                          von {h.sent_by_short} am {new Date(h.sent_at).toLocaleDateString('de-AT')} um {new Date(h.sent_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 italic mt-0.5 truncate max-w-xl">
                        &bdquo;{h.task_assignment}&ldquo;
                      </p>
                    </div>

                    <div className="text-right text-[11px] text-emerald-400 flex-shrink-0 font-bold">
                      {h.status === 'resolved' ? 'Erledigt' : 'Aktiv'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ===================================================================== */
        /* STANDARD CLASSROOM VIEW (SCHÜLER-KARTEN MIT TIMEOUT BUTTON)           */
        /* ===================================================================== */
        <>
          {/* Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-3 shadow-md">
            <div className="relative w-full sm:w-80">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Schüler in Klasse suchen..."
                className="w-full pl-8 pr-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
              <button
                onClick={() => setFilterRank('all')}
                className={`min-h-[40px] px-3 py-2 rounded-xl font-bold text-xs transition ${
                  filterRank === 'all' ? 'bg-slate-700 text-slate-50' : 'bg-slate-800 text-slate-400 hover:text-slate-50'
                }`}
              >
                Alle ({pupils.length})
              </button>
              <button
                onClick={() => setFilterRank('Lehrling')}
                className={`min-h-[40px] px-3 py-2 rounded-xl font-bold text-xs transition flex items-center gap-1 ${
                  filterRank === 'Lehrling' ? 'bg-rose-500 text-slate-50' : 'bg-slate-800 text-rose-400 hover:bg-slate-700'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                Lehrling
              </button>
              <button
                onClick={() => setFilterRank('Geselle')}
                className={`min-h-[40px] px-3 py-2 rounded-xl font-bold text-xs transition flex items-center gap-1 ${
                  filterRank === 'Geselle' ? 'bg-blue-500 text-slate-50' : 'bg-slate-800 text-blue-400 hover:bg-slate-700'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                Geselle
              </button>
              <button
                onClick={() => setFilterRank('Meister')}
                className={`min-h-[40px] px-3 py-2 rounded-xl font-bold text-xs transition flex items-center gap-1 ${
                  filterRank === 'Meister' ? 'bg-amber-400 text-slate-950 font-bold' : 'bg-slate-800 text-amber-400 hover:bg-slate-700'
                }`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                Meister
              </button>
            </div>
          </div>

          {/* Compact Minimalist Pupils List */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-lg overflow-hidden divide-y divide-slate-800/80">
            {/* Simple class overview header */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 bg-slate-950/70 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <span>Klasse {currentClass.name} · {filteredPupils.length} Schüler*innen</span>
              <span className="normal-case font-medium tracking-normal text-[10px] text-slate-500">
                <span className="mr-2"><span className="inline-block w-2 h-2 rounded-full bg-rose-400 mr-1" />Lehrling</span>
                <span className="mr-2"><span className="inline-block w-2 h-2 rounded-full bg-blue-400 mr-1" />Geselle</span>
                <span className="mr-2"><span className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1" />Meister</span>
                <span><span className="inline-block w-2 h-2 rounded-full bg-slate-500 mr-1" />Ausstehend</span>
              </span>
            </div>

            {filteredPupils.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                Keine Schüler gefunden für diese Auswahl.
              </div>
            ) : (
              filteredPupils.map((pupil, index) => {
                const isExpanded = expandedPupilId === pupil.id;
                const { hasRedCard, subjectResults } = getPupilRank(pupil);
                const pupilCards = cards.filter((c) => c.pupil_id === pupil.id);
                const yellowCards = pupilCards.filter((c) => c.card_type === 'yellow');
                const isYellowAlert = yellowCards.length >= 2;
                const activeTimeoutIncident = activeTimeouts.find((ti) => ti.pupil_id === pupil.id);
                const currentResult =
                  subjectResults.find((sr) => sr.subjectCode === lessonSubjectCode) ??
                  subjectResults[0] ??
                  null;
                const currentRank = currentResult?.rank ?? null;
                const rankLabel = currentRank ?? 'Ausstehend';
                const rankBoxClass =
                  currentRank === 'Meister'
                    ? 'border-amber-300 bg-amber-400 text-slate-950'
                    : currentRank === 'Geselle'
                    ? 'border-blue-300 bg-blue-600 text-white'
                    : currentRank === 'Lehrling'
                    ? 'border-rose-300 bg-rose-600 text-white'
                    : 'border-dashed border-slate-600 bg-slate-800 text-slate-300';

                return (
                  <div key={pupil.id} data-tour={index === 0 ? 'pupil-row' : undefined} className="transition-colors">
                    {/* Main Compact Row */}
                    <div
                      onClick={() => setExpandedPupilId(isExpanded ? null : pupil.id)}
                      className={`cursor-pointer px-3 py-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3 transition ${
                        isExpanded
                          ? 'bg-slate-800/80 border-b border-slate-700/60'
                          : activeTimeoutIncident
                          ? 'bg-amber-950/20 hover:bg-amber-950/30'
                          : hasRedCard
                          ? 'bg-rose-950/15 hover:bg-rose-950/25'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      {/* Left: pupil name in a single rank-coloured box */}
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveProfilePupilId(pupil.id);
                          }}
                          className={`flex min-h-[56px] min-w-0 flex-1 items-center justify-between gap-2 rounded-2xl border-2 px-4 py-2 text-left select-none transition hover:brightness-110 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-amber-400 ${rankBoxClass}`}
                          title="Antippen für Schülerprofil & pädagogische Verhaltenspyramide"
                        >
                          <span className="truncate text-base font-extrabold">{pupil.fullName}</span>
                          <span className="shrink-0 rounded-lg border border-black/10 bg-black/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide">
                            {rankLabel}
                          </span>
                        </button>
                        {activeTimeoutIncident && (
                          <span
                            className="shrink-0 rounded-md border border-amber-500/40 bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-bold text-amber-300"
                            title={activeTimeoutIncident.kind === 'cooldown' ? 'Im Cool-Down (Lernwerkstatt)' : 'Im Time-Out (Lernwerkstatt)'}
                          >
                            {activeTimeoutIncident.kind === 'cooldown' ? (
                              <Snowflake className="w-3 h-3" aria-hidden="true" />
                            ) : (
                              <Clock className="w-3 h-3" aria-hidden="true" />
                            )}
                            {' '}LW
                          </span>
                        )}
                        {isYellowAlert && (
                          <span
                            className="shrink-0 rounded-md border border-rose-500/40 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300"
                            title="Mahnstufe (>= 2 gelbe Karten)"
                          >
                            <ShieldAlertIcon className="w-3 h-3" aria-hidden="true" />
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedPupilId(isExpanded ? null : pupil.id);
                          }}
                          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 text-slate-300 transition hover:bg-slate-700 hover:text-slate-50 sm:hidden"
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Details ausblenden' : 'Details einblenden'}
                          title="Details"
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      </div>

                      {/* Right: quick action cards */}
                      <div className="flex items-stretch gap-1.5 sm:shrink-0">
                        <div data-tour={index === 0 ? 'card-actions' : undefined} className="grid flex-1 grid-cols-5 gap-1.5 sm:flex sm:flex-none sm:items-stretch">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCardModal({
                              pupilId: pupil.id,
                              pupilName: pupil.fullName,
                              cardType: 'green',
                            });
                            setCardNote('');
                          }}
                          className="pressable focus-ring min-h-[56px] min-w-0 rounded-xl px-1 py-1.5 sm:w-[64px] bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-[9px] font-bold leading-none transition flex flex-col items-center justify-center gap-0.5 whitespace-nowrap active:scale-95"
                          title="Grüne Karte vergeben  (Tastatur: 1)"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Grün</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setActiveCardModal({
                              pupilId: pupil.id,
                              pupilName: pupil.fullName,
                              cardType: 'yellow',
                            });
                            setCardNote('');
                          }}
                          className="pressable focus-ring min-h-[56px] min-w-0 rounded-xl px-1 py-1.5 sm:w-[64px] bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[9px] font-bold leading-none transition flex flex-col items-center justify-center gap-0.5 whitespace-nowrap active:scale-95"
                          title="Gelbe Karte vergeben  (Tastatur: 2)"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Gelb</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenRedCardModal(pupil);
                          }}
                          className="pressable focus-ring min-h-[56px] min-w-0 rounded-xl px-1 py-1.5 sm:w-[64px] bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 border border-rose-500/40 text-[9px] font-bold leading-none transition flex flex-col items-center justify-center gap-0.5 whitespace-nowrap active:scale-95"
                          title="Rote Karte vergeben (sofortiger Rangverlust)  (Tastatur: 3)"
                        >
                          <ShieldAlertIcon className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Rot</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenTimeoutModal(pupil, 'timeout');
                          }}
                          className="pressable focus-ring min-h-[56px] min-w-0 rounded-xl px-1 py-1.5 sm:w-[64px] bg-gradient-to-r from-amber-500/25 to-rose-500/25 hover:from-amber-500/40 hover:to-rose-500/40 text-amber-200 border border-amber-500/40 text-[9px] font-bold leading-none transition flex flex-col items-center justify-center gap-0.5 whitespace-nowrap active:scale-95"
                          title="Ins Time-Out (Lernwerkstatt) schicken  (Tastatur: 4)"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>TIMEOUT</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenTimeoutModal(pupil, 'cooldown');
                          }}
                          className="pressable focus-ring min-h-[56px] min-w-0 rounded-xl px-1 py-1.5 sm:w-[64px] bg-sky-500/15 hover:bg-sky-500/30 text-sky-200 border border-sky-500/40 text-[9px] font-bold leading-none transition flex flex-col items-center justify-center gap-0.5 whitespace-nowrap active:scale-95"
                          title="Cool-Down in die Lernwerkstatt (kein Rangverlust, Notiz möglich)  (Tastatur: 5)"
                        >
                          <Snowflake className="w-3.5 h-3.5 text-sky-300" />
                          <span>COOL-DOWN</span>
                        </button>

                      </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedPupilId(isExpanded ? null : pupil.id);
                          }}
                          className="hidden min-h-[56px] w-11 shrink-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-slate-700 bg-slate-800/80 text-[9px] font-bold leading-none text-slate-400 transition hover:bg-slate-700 hover:text-slate-50 sm:inline-flex"
                          aria-expanded={isExpanded}
                          title={isExpanded ? 'Details ausblenden' : 'Details einblenden'}
                        >
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          <span>Details</span>
                        </button>
                      </div>
                    </div>

                    {/* Expanded Detail Panel (When clicked) */}
                    {isExpanded && (
                      <div className="bg-surface-2 px-5 py-4 border-t border-hairline space-y-4">
                        {/* Header inside detail: Info Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 text-xs">
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                            {subjectResults.map((sr) => (
                              <span key={sr.subjectCode} className="text-slate-400">
                                {sr.subjectCode}: {sr.positiveCount}/{rubricItemKeys.length} positiv ·
                                Basis-Rang: {sr.baseRank ?? 'Ausstehend'}
                                {sr.hasRedCardDemotion && ` (herabgestuft auf ${sr.rank} durch Rote Karte)`}
                              </span>
                            ))}
                          </div>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setActiveProfilePupilId(pupil.id)}
                              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500/20 via-sky-500/20 to-amber-500/20 hover:from-emerald-500/30 hover:via-sky-500/30 hover:to-amber-500/30 border border-amber-500/35 text-amber-200 text-xs font-bold transition flex items-center gap-1.5 shadow-sm"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                              <span>Verhaltensprofil &amp; Stufenpyramide</span>
                            </button>
                            <div className="text-slate-400 text-xs hidden sm:block">
                              {pupilCards.length === 0 ? 'Keine Karten' : `${pupilCards.length} Verhaltenskarten erfasst`}
                            </div>
                          </div>
                        </div>

                        {/* Active Alerts in Detail */}
                        {activeTimeoutIncident && (
                          <div className={`p-3 rounded-xl border text-xs flex items-start gap-2 ${activeTimeoutIncident.kind === 'cooldown' ? 'bg-sky-500/10 border-sky-500/40 text-sky-200' : 'bg-amber-500/15 border-amber-500/40 text-amber-200'}`}>
                            {activeTimeoutIncident.kind === 'cooldown' ? (
                              <Snowflake className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
                            ) : (
                              <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            )}
                            <div>
                              <strong>
                                {activeTimeoutIncident.kind === 'cooldown'
                                  ? 'Aktuell im Cool-Down (Lernwerkstatt):'
                                  : 'Aktuell im Time-Out (Lernwerkstatt):'}
                              </strong>
                              <div className="mt-0.5 text-slate-300">
                                {activeTimeoutIncident.kind === 'cooldown' ? 'Notiz' : 'Arbeitsauftrag'}: &bdquo;{activeTimeoutIncident.task_assignment}&ldquo;
                              </div>
                              <div className={`mt-1 text-[11px] ${activeTimeoutIncident.kind === 'cooldown' ? 'text-sky-400' : 'text-amber-400'}`}>
                                Geschickt von {activeTimeoutIncident.sent_by_short} um {new Date(activeTimeoutIncident.sent_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Cards History List */}
                        <div className="space-y-2">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                            Verhaltenskarten &amp; Vorfälle
                          </h4>
                          {pupilCards.length === 0 ? (
                            <p className="text-xs text-slate-500 italic py-1">
                              Noch keine Verhaltenskarten für diesen Schüler eingetragen.
                            </p>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              {pupilCards.map((c) => (
                                <div
                                  key={c.id}
                                  className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-2 ${
                                    c.card_type === 'green'
                                      ? 'bg-emerald-500/10 border-emerald-500/25 text-slate-200'
                                      : c.card_type === 'yellow'
                                      ? 'bg-amber-500/10 border-amber-500/25 text-slate-200'
                                      : c.card_type === 'cooldown'
                                      ? 'bg-sky-500/10 border-sky-500/25 text-slate-200'
                                      : 'bg-rose-500/15 border-rose-500/35 text-rose-200'
                                  }`}
                                >
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-1.5 font-bold mb-0.5">
                                      <span className="inline-flex items-center gap-1.5">
                                        <span
                                          className={`w-2 h-2 rounded-full shrink-0 ${
                                            c.card_type === 'green'
                                              ? 'bg-emerald-400'
                                              : c.card_type === 'yellow'
                                              ? 'bg-amber-400'
                                              : c.card_type === 'cooldown'
                                              ? 'bg-sky-400'
                                              : 'bg-rose-400'
                                          }`}
                                          aria-hidden="true"
                                        />
                                        {c.card_type === 'green'
                                          ? 'Grüne Karte'
                                          : c.card_type === 'yellow'
                                          ? 'Gelbe Karte'
                                          : c.card_type === 'cooldown'
                                          ? 'Cool-Down'
                                          : 'Rote Karte'}
                                      </span>
                                      <span className="text-[11px] text-slate-400 font-normal">
                                        von {c.teacher_short} · {new Date(c.created_at).toLocaleDateString('de-AT')} {new Date(c.created_at).toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    {c.note ? (
                                      <p className="text-slate-300 text-xs italic mt-1">
                                        &bdquo;{c.note}&ldquo;
                                      </p>
                                    ) : (
                                      <p className="text-slate-500 text-[11px] italic mt-0.5">
                                        (Keine Notiz)
                                      </p>
                                    )}
                                  </div>

                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleRevokeCard(c);
                                    }}
                                    className="p-1 text-slate-400 hover:text-rose-400 rounded-lg hover:bg-slate-800 transition flex-shrink-0"
                                    title="Karte zurücknehmen"
                                  >
                                    <X className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Inline Note Input in Detail */}
                        <div className="pt-2 border-t border-slate-800/80 flex items-center gap-2">
                          <input
                            type="text"
                            placeholder="Notiz hinzufügen (als grüne Karte erfassen)..."
                            value={inlineNotes[pupil.id] || ''}
                            onChange={(e) =>
                              setInlineNotes((prev) => ({ ...prev, [pupil.id]: e.target.value }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveInlineNote(pupil.id);
                            }}
                            className="flex-1 min-h-[44px] bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400"
                          />
                          <button
                            onClick={() => handleSaveInlineNote(pupil.id)}
                            disabled={savingInlineNote === pupil.id || !inlineNotes[pupil.id]?.trim()}
                            className="min-h-[40px] px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-50 text-xs font-bold transition disabled:opacity-40"
                          >
                            {savingInlineNote === pupil.id ? '...' : 'Notiz speichern'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </>
      )}

      {/* Modal: Standard Card Issue with Note (Green or Yellow) */}
      {activeCardModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl w-full max-w-md p-6 shadow-lg">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800 mb-4">
              <h3 className="font-bold text-slate-50 text-base flex items-center gap-2">
                <span>
                  {activeCardModal.cardType === 'green' ? '★ Grüne Karte' : '▲ Gelbe Karte'} vergeben
                </span>
              </h3>
              <button
                onClick={() => setActiveCardModal(null)}
                className="p-1.5 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-300 mb-3">
              Für Schüler*in: <strong className="text-slate-50">{activeCardModal.pupilName}</strong> (Klasse {currentClass.name})
            </p>

            <div className="mb-4">
              <label className="text-[10px] font-bold text-slate-400 uppercase block mb-1">
                Begründung / Notiz (optional)
              </label>
              <textarea
                rows={3}
                value={cardNote}
                onChange={(e) => setCardNote(e.target.value)}
                placeholder={
                  activeCardModal.cardType === 'green'
                    ? 'z.B. Vorbildliches Engagement, herausragende Mitarbeit...'
                    : 'z.B. Wiederholte Störung, Hausübung unvollständig...'
                }
                className="w-full p-3 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setActiveCardModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
              >
                Abbrechen
              </button>
              <button
                onClick={handleConfirmCard}
                disabled={submittingCard}
                className={`px-4 py-2 rounded-xl text-slate-950 font-bold text-xs transition shadow-md ${
                  activeCardModal.cardType === 'green'
                    ? 'bg-emerald-500 hover:bg-emerald-400 shadow-sm'
                    : 'bg-amber-500 hover:bg-amber-400 shadow-sm'
                }`}
              >
                {submittingCard ? 'Speichere...' : 'Karte jetzt vergeben'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Two-Step Security Modal: ROTE KARTE (Instant Rank Loss) */}
      {redCardTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border-2 border-rose-500/60 rounded-3xl w-full max-w-lg p-6 shadow-lg shadow-sm">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-rose-500/20 mb-4">
              <div className="flex items-center gap-2.5 text-rose-400">
                <ShieldAlert className="w-5 h-5 flex-shrink-0 animate-bounce" />
                <h3 className="font-bold text-slate-50 text-base">
                  {redCardStep === 1
                    ? 'Sicherheitswarnung: Rote Karte (Instant Rank Loss)'
                    : 'Schritt 2: Vorfallsbeschreibung erfassen'}
                </h3>
              </div>
              <button
                onClick={() => setRedCardTarget(null)}
                className="p-1.5 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Step 1: Warning & Confirmation */}
            {redCardStep === 1 && (
              <div className="space-y-4">
                <div className="bg-rose-500/10 border border-rose-500/30 rounded-2xl p-4 text-xs text-rose-200 space-y-2">
                  <p className="text-sm font-bold text-rose-300">
                    Möchten Sie dem Schüler {redCardTarget.pupilName} wirklich eine Rote Karte geben?
                  </p>
                  <p className="text-slate-300 leading-relaxed">
                    Eine <strong className="text-rose-400">Rote Karte</strong> führt zu einem <strong>sofortigen Rangverlust (Instant Rank Loss)</strong>.
                    Der Schüler wird je Fach um eine Rangstufe degradiert:
                  </p>
                  <div className="flex flex-col gap-2 pt-2 font-bold text-sm">
                    {redCardTarget.deductions.map((d) => (
                      <span key={d.label} className="flex items-center gap-1.5">
                        <span className="px-3 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-300">
                          {d.label}: {d.currentRank}
                        </span>
                        <span className="text-rose-400">➔</span>
                        <span className="px-3 py-1 rounded-xl bg-rose-500/30 border border-rose-500/60 text-rose-300">
                          {d.demotedRank}
                        </span>
                      </span>
                    ))}
                  </div>
                  {redCardTarget.pendingNote && (
                    <p className="text-slate-400 text-xs pt-1">{redCardTarget.pendingNote}</p>
                  )}
                </div>

                <p className="text-xs text-slate-400">
                  Im nächsten Schritt müssen Sie zwingend beschreiben, was genau vorgefallen ist, bevor die Rote Karte im System gespeichert wird.
                </p>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setRedCardTarget(null)}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={() => setRedCardStep(2)}
                    className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-slate-50 font-bold text-xs transition shadow-lg shadow-sm flex items-center gap-1.5"
                  >
                    <span>Ja, weiter zur Vorfallsbeschreibung</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Mandatory Incident Description */}
            {redCardStep === 2 && (
              <div className="space-y-4">
                <div className="text-xs text-slate-300 space-y-1.5">
                  Schüler*in: <strong className="text-slate-50">{redCardTarget.pupilName}</strong> (Klasse {currentClass.name})
                  <span className="block text-rose-400 font-bold">Degradierung:</span>
                  <span className="flex flex-col gap-1.5 font-bold">
                    {redCardTarget.deductions.map((d) => (
                      <span key={d.label} className="text-slate-200">
                        {d.label}: {d.currentRank} ➔ {d.demotedRank}
                      </span>
                    ))}
                  </span>
                  {redCardTarget.pendingNote && (
                    <span className="block text-slate-400 font-normal">{redCardTarget.pendingNote}</span>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-bold uppercase text-rose-300 block mb-1.5">
                    Was ist passiert? Vorfallsbeschreibung (zwingend erforderlich):
                  </label>
                  <textarea
                    rows={4}
                    value={redCardNote}
                    onChange={(e) => setRedCardNote(e.target.value)}
                    placeholder="Beschreiben Sie präzise und sachlich den Vorfall..."
                    className="w-full p-3.5 rounded-2xl bg-slate-950 border border-rose-500/40 text-xs text-slate-50 placeholder-slate-500 focus:outline-none focus:border-rose-400 focus:ring-1 focus:ring-rose-400"
                  />
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setRedCardStep(1)}
                    className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                  >
                    Zurück
                  </button>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setRedCardTarget(null)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 text-xs font-bold transition"
                    >
                      Abbrechen
                    </button>
                    <button
                      onClick={handleConfirmRedCard}
                      disabled={submittingRedCard || !redCardNote.trim()}
                      className="px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-slate-50 font-bold text-xs transition shadow-lg shadow-sm flex items-center gap-1.5 disabled:opacity-40"
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>{submittingRedCard ? 'Speichere...' : 'Rote Karte & Degradierung bestätigen'}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Time-Out or consequence-free Cool-Down */}
      {timeoutTarget && (() => {
        const isCooldown = timeoutTarget.kind === 'cooldown';
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
            <div className={`bg-slate-900 border-2 ${isCooldown ? 'border-sky-500/60' : 'border-amber-500/60'} rounded-3xl w-full max-w-lg p-6 shadow-lg shadow-sm`}>
              <div className={`flex items-center justify-between pb-3 border-b ${isCooldown ? 'border-sky-500/20' : 'border-amber-500/20'} mb-4`}>
                <div className={`flex items-center gap-2 ${isCooldown ? 'text-sky-300' : 'text-amber-400'}`}>
                  {isCooldown ? (
                    <Snowflake className="w-5 h-5 flex-shrink-0" />
                  ) : (
                    <Clock className="w-5 h-5 flex-shrink-0 animate-pulse" />
                  )}
                  <h3 className="font-bold text-slate-50 text-base">
                    {isCooldown
                      ? 'Cool-Down (Lernwerkstatt) – kein Rangverlust'
                      : 'Schüler*in ins Time-Out (Lernwerkstatt) schicken'}
                  </h3>
                </div>
                <button
                  onClick={() => setTimeoutTarget(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-50 rounded-xl bg-slate-800 transition"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-4">
                <div className={`${isCooldown ? 'bg-sky-500/10 border-sky-500/30 text-sky-200' : 'bg-amber-500/10 border-amber-500/30 text-amber-200'} border rounded-2xl p-3.5 text-xs`}>
                  <p className={`font-bold ${isCooldown ? 'text-sky-300' : 'text-amber-300'} mb-1`}>
                    {isCooldown ? (
                      <Snowflake className="w-5 h-5 inline align-text-bottom" aria-hidden="true" />
                    ) : (
                      <ShieldAlertIcon className="w-5 h-5 inline align-text-bottom" aria-hidden="true" />
                    )}{' '}
                    {isCooldown ? 'Cool-Down für' : 'Disziplinäres Time-Out für'} {timeoutTarget.pupilName} (Klasse {currentClass.name})
                  </p>
                  <p className="text-slate-300 leading-relaxed">
                    {isCooldown
                      ? 'Der Schüler wird zur Beruhigung in die Lernwerkstatt geschickt. Es gibt keine Rote Karte, keinen Rangverlust und keine Eskalationsstufe. Eine Notiz ist optional.'
                      : 'Dieses Time-Out gilt verbindlich als Rote Karte (Instant Rank Loss) und leitet den Schüler mit dem unten stehenden Arbeitsauftrag direkt an die Aufsicht in der Lernwerkstatt (LW) weiter.'}
                  </p>
                </div>

                <div>
                  <label className={`text-[11px] font-bold uppercase ${isCooldown ? 'text-sky-300' : 'text-amber-300'} block mb-1.5`}>
                    {isCooldown
                      ? 'Notiz / Beobachtung (optional):'
                      : 'Arbeitsauftrag für das Time-Out (zwingend erforderlich):'}
                  </label>
                  <textarea
                    rows={4}
                    value={timeoutTask}
                    onChange={(e) => setTimeoutTask(e.target.value)}
                    placeholder={
                      isCooldown
                        ? 'z.B. Kurze Auszeit zur Beruhigung, kurze Beobachtung...'
                        : 'Geben Sie hier die Aufgaben oder Arbeitsblätter an, die der Schüler in der Lernwerkstatt bearbeiten muss...'
                    }
                    className={`w-full p-3.5 rounded-2xl bg-slate-950 border ${isCooldown ? 'border-sky-500/40 focus:border-sky-400 focus:ring-sky-400' : 'border-amber-500/40 focus:border-amber-400 focus:ring-amber-400'} text-xs text-slate-50 placeholder-slate-500 focus:outline-none focus:ring-1`}
                  />
                  {!isCooldown && timeoutTask.trim().length === 0 && (
                    <span className="text-[10px] text-amber-400 mt-1 block">
                      * Ein konkreter Arbeitsauftrag ist zwingend erforderlich.
                    </span>
                  )}
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    onClick={() => setTimeoutTarget(null)}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold transition"
                  >
                    Abbrechen
                  </button>
                  <button
                    onClick={handleConfirmTimeout}
                    disabled={submittingTimeout || (!isCooldown && !timeoutTask.trim())}
                    className={`px-5 py-2.5 rounded-xl ${isCooldown ? 'bg-sky-500 hover:bg-sky-400 text-slate-950' : 'bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950'} font-bold text-xs transition shadow-lg shadow-sm flex items-center gap-1.5 disabled:opacity-40`}
                  >
                    {isCooldown ? <Snowflake className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    <span>
                      {submittingTimeout
                        ? 'Übermittle...'
                        : isCooldown
                          ? 'Cool-Down senden'
                          : 'Ins Time-Out schicken & Rote Karte eintragen'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal: Schüler-Verhaltensprofil & Stufenpyramide */}
      {activeProfilePupilId && (
        <PupilProfileModal
          pupilId={activeProfilePupilId}
          currentUser={currentUser}
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
