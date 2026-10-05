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
  Crown,
  Wrench,
  Sprout,
  ShieldAlert as ShieldAlertIcon,
} from 'lucide-react';
import { SchoolClass, PupilWithData, User } from '../types';
import { useToast } from './Toast';
import { useConfirm } from './ConfirmDialog';
import { PupilProfileModal } from './PupilProfileModal';
import {
  issueCard,
  revokeCard,
  getClassCards,
  getCurrentTimetable,
  sendToTimeout,
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
  card_type: 'green' | 'yellow' | 'red';
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
}

export const Schulalltag: React.FC<SchulalltagProps> = ({
  currentClass,
  classes,
  pupils,
  currentUser,
  onSelectClass,
  onRefreshClassData,
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
    currentRank: 'Lehrling' | 'Geselle' | 'Meister';
    demotedRank: 'Lehrling' | 'Geselle';
  } | null>(null);
  const [redCardStep, setRedCardStep] = useState<1 | 2>(1);
  const [redCardNote, setRedCardNote] = useState('');
  const [submittingRedCard, setSubmittingRedCard] = useState(false);

  // TIMEOUT Modal
  const [timeoutTarget, setTimeoutTarget] = useState<{
    pupilId: number;
    pupilName: string;
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
    return () => clearInterval(interval);
  }, []);

  // Compute live rank per pupil (taking red cards into account)
  const isPositiveRating = (r?: string) =>
    r === 'crown' || r === 'smile' || r === '++' || r === '+';

  const getPupilRank = (p: PupilWithData) => {
    const allItems = p.evaluations.flatMap((e) => e.items || []);
    const pos = allItems.filter((i) => isPositiveRating(i.rating)).length;
    let baseRank: 'Lehrling' | 'Geselle' | 'Meister' = 'Lehrling';
    if (pos >= 14) baseRank = 'Meister';
    else if (pos >= 8) baseRank = 'Geselle';

    // Check active red cards
    const pupilCards = cards.filter((c) => c.pupil_id === p.id);
    const activeRedCards = pupilCards.filter((c) => c.card_type === 'red');
    const hasRedCard = activeRedCards.length > 0;

    let rank: 'Lehrling' | 'Geselle' | 'Meister' = baseRank;
    let hasRedCardDemotion = false;

    if (hasRedCard) {
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

    let color = 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    if (rank === 'Meister') color = 'bg-amber-400/20 text-amber-300 border-amber-400/40';
    else if (rank === 'Geselle') color = 'bg-blue-500/20 text-blue-300 border-blue-500/40';

    return {
      rank,
      baseRank,
      hasRedCard,
      hasRedCardDemotion,
      redCardCount: activeRedCards.length,
      color,
      pos,
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
    const { rank } = getPupilRank(pupil);
    const demotedRank: 'Lehrling' | 'Geselle' = rank === 'Meister' ? 'Geselle' : 'Lehrling';

    setRedCardTarget({
      pupilId: pupil.id,
      pupilName: pupil.fullName,
      currentRank: rank,
      demotedRank,
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
      toast.success(
        `Rote Karte für ${target.pupilName}: ${target.currentRank} → ${target.demotedRank}.`,
        {
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

  // Open Time-Out Modal
  const handleOpenTimeoutModal = (pupil: PupilWithData) => {
    setTimeoutTarget({
      pupilId: pupil.id,
      pupilName: pupil.fullName,
    });
    setTimeoutTask('');
  };

  // Confirm sending pupil to Time-Out
  const handleConfirmTimeout = async () => {
    if (!timeoutTarget || !currentClass) return;
    if (!timeoutTask.trim()) {
      toast.error('Bitte geben Sie einen Arbeitsauftrag für die Lernwerkstatt an.');
      return;
    }

    setSubmittingTimeout(true);
    const target = timeoutTarget;
    const task = timeoutTask.trim();
    try {
      const res = await sendToTimeout(target.pupilId, currentClass.id, task);
      await loadClassCards(currentClass.id);
      await loadTimeoutsData();
      onRefreshClassData();
      setTimeoutTarget(null);
      setTimeoutTask('');

      // Previously this fired a blocking alert() on SUCCESS, which meant a teacher
      // had to dismiss a modal before carrying on with the lesson.
      //
      // Undo has to undo two records: the timeout incident and the red card it
      // created. If the card revoke fails, say so rather than implying it worked.
      toast.success(`${target.pupilName} ist im Time-Out. Rote Karte eingetragen.`, {
        action: {
          label: 'Rückgängig',
          onClick: async () => {
            try {
              await resolveTimeout(res.incident.id, 'Rückgängig: Time-Out aufgehoben');
              if (res.redCard?.id) await revokeCard(res.redCard.id);
              await loadClassCards(currentClass.id);
              await loadTimeoutsData();
              onRefreshClassData();
              toast.success('Time-Out aufgehoben, Rangverlust zurückgenommen.');
            } catch (e: any) {
              toast.error(
                e.message || 'Rückgängig fehlgeschlagen. Bitte in der LW-Übersicht prüfen.',
              );
            }
          },
        },
      });
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Erfassen des Time-Outs');
    } finally {
      setSubmittingTimeout(false);
    }
  };

  // Resolve Time-Out in LW
  const handleResolveTimeout = async (id: string, pupilName: string) => {
    const ok = await confirm({
      title: `${pupilName} zurück in die Klasse?`,
      message: 'Der Arbeitsauftrag wird als erledigt protokolliert.',
      confirmLabel: 'Zurück schicken',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await resolveTimeout(id, 'Arbeitsauftrag in Lernwerkstatt erledigt');
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
          handleOpenTimeoutModal(pupil);
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

  // Filtered pupils list
  const filteredPupils = useMemo(() => {
    return pupils.filter((p) => {
      const matchesSearch = p.fullName.toLowerCase().includes(searchQuery.toLowerCase());
      const pRank = getPupilRank(p);
      const matchesRank = filterRank === 'all' || pRank.rank === filterRank;
      return matchesSearch && matchesRank;
    });
  }, [pupils, searchQuery, filterRank, cards]);

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
                ? `(${activeTimeouts.length} im Time-Out)`
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
                  ? 'bg-amber-500 text-slate-950 font-bold shadow-md shadow-sm'
                  : 'bg-slate-800/80 text-amber-300 hover:text-slate-50 hover:bg-slate-700 border border-amber-500/30'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Lernwerkstatt (LW)</span>
              {activeTimeouts.length > 0 && (
                <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-slate-50 font-bold text-[10px] animate-pulse">
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
                    Lernwerkstatt – Aktive Time-Out Schüler*innen
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Hier betreuen Sie Schüler*innen, die disziplinär aus den Klassen ins Time-Out geschickt wurden.
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
                  <p className="font-bold text-slate-50 text-base">Aktuell keine Schüler im Time-Out!</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sobald eine Lehrkraft eine Schülerin / einen Schüler ins Time-Out schickt, erscheint sie/er hier live mit Arbeitsauftrag.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {activeTimeouts.map((item) => (
                    <div
                      key={item.id}
                      className="bg-slate-950 border-2 border-rose-500/50 rounded-3xl p-5 shadow-lg flex flex-col justify-between"
                    >
                      <div>
                        {/* Header: Pupil Name & Class */}
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="px-2.5 py-0.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[11px] font-bold animate-pulse">
                                <Clock className="w-3.5 h-3.5 inline" aria-hidden="true" /> Time-Out aktiv
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
                          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase text-amber-300 mb-1.5">
                            <FileText className="w-3.5 h-3.5" />
                            <span>Arbeitsauftrag der Lehrperson:</span>
                          </div>
                          <p className="text-xs text-slate-50 leading-relaxed font-medium bg-slate-950/60 p-2.5 rounded-xl border border-slate-800">
                            &bdquo;{item.task_assignment}&ldquo;
                          </p>
                        </div>
                      </div>

                      {/* Action: Resolve and send back */}
                      <button
                        onClick={() => handleResolveTimeout(item.id, item.pupil_name)}
                        className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-400 hover:to-emerald-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 transition shadow-lg shadow-sm active:scale-95"
                      >
                        <Check className="w-4 h-4" />
                        <span>Arbeitsauftrag erledigt / Zurück in die Klasse</span>
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
                <span>Kürzlich erledigte Time-Outs (letzte 48 Stunden)</span>
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
            {/* Table / List Header */}
            <div className="hidden md:grid md:grid-cols-12 gap-3 px-4 py-2.5 bg-slate-950/70 text-[11px] font-bold uppercase tracking-wider text-slate-400 border-b border-slate-800">
              <div className="col-span-4 flex items-center gap-1.5">
                <span>Schüler*in ({filteredPupils.length})</span>
              </div>
              <div className="col-span-2">
                <span>Rang</span>
              </div>
              <div className="col-span-2 text-center">
                <span>Karten</span>
              </div>
              <div className="col-span-4 text-right pr-2">
                <span>Schnell-Aktionen</span>
              </div>
            </div>

            {filteredPupils.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">
                Keine Schüler gefunden für diese Auswahl.
              </div>
            ) : (
              filteredPupils.map((pupil, index) => {
                const isExpanded = expandedPupilId === pupil.id;
                const { rank, baseRank, hasRedCard, hasRedCardDemotion, pos: positiveTicks } = getPupilRank(pupil);
                const pupilCards = cards.filter((c) => c.pupil_id === pupil.id);
                const greenCards = pupilCards.filter((c) => c.card_type === 'green');
                const yellowCards = pupilCards.filter((c) => c.card_type === 'yellow');
                const redCards = pupilCards.filter((c) => c.card_type === 'red');
                const isYellowAlert = yellowCards.length >= 2;
                const activeTimeoutIncident = activeTimeouts.find((ti) => ti.pupil_id === pupil.id);

                return (
                  <div key={pupil.id} data-tour={index === 0 ? 'pupil-row' : undefined} className="transition-colors">
                    {/* Main Compact Row */}
                    <div
                      onClick={() => setExpandedPupilId(isExpanded ? null : pupil.id)}
                      className={`cursor-pointer px-4 py-2.5 flex flex-col md:grid md:grid-cols-12 gap-2 md:gap-3 md:items-center transition ${
                        isExpanded
                          ? 'bg-slate-800/80 border-b border-slate-700/60'
                          : activeTimeoutIncident
                          ? 'bg-amber-950/20 hover:bg-amber-950/30'
                          : hasRedCard
                          ? 'bg-rose-950/15 hover:bg-rose-950/25'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      {/* Col 1: Pupil Name & Status Indicators */}
                      <div className="col-span-4 flex items-center justify-between md:justify-start gap-2 min-w-0">
                        <div className="flex items-center gap-2 truncate">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setActiveProfilePupilId(pupil.id);
                            }}
                            className="font-medium text-base text-slate-50 truncate select-none hover:text-amber-300 hover:underline text-left transition flex items-center gap-2 focus:outline-none"
                            title="Klicken für Schülerprofil &amp; pädagogische Verhaltenspyramide"
                          >
                            <span className="truncate">{pupil.fullName}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700/80 hover:border-amber-400 hover:text-amber-300 transition shrink-0 font-semibold">
                              Profil
                            </span>
                          </button>
                          {activeTimeoutIncident && (

                            <span
                              className="px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[10px] font-bold animate-pulse flex-shrink-0"
                              title="Aktuell im Time-Out (Lernwerkstatt)"
                            >
                              <Clock className="w-3 h-3" aria-hidden="true" /> LW
                            </span>
                          )}
                          {isYellowAlert && (
                            <span
                              className="px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-300 border border-rose-500/40 text-[10px] font-bold flex-shrink-0"
                              title="Mahnstufe (>= 2 gelbe Karten)"
                            >
                              <ShieldAlertIcon className="w-3 h-3" aria-hidden="true" />
                            </span>
                          )}
                        </div>
                        <span className="md:hidden text-xs text-slate-400">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </span>
                      </div>

                      {/* Col 2: Rang

                          Minimalist treatment: colour alone carries the meaning, so the
                          badge drops its tint, border, bold weight and letter-spacing.
                          Those four layers were stacked on every label in this row,
                          which is what made the list read as busy rather than calm. */}
                      <div className="col-span-2 flex items-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            rank === 'Meister'
                              ? 'text-amber-300'
                              : rank === 'Geselle'
                              ? 'text-sky-300'
                              : 'text-rose-300'
                          }`}
                        >
                          {rank === 'Meister' ? (
                            <Crown className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          ) : rank === 'Geselle' ? (
                            <Wrench className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          ) : (
                            <Sprout className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          )}
                          <span>{rank}</span>
                        </span>
                        {hasRedCardDemotion && (
                          <span
                            className="text-[11px] text-rose-400/80"
                            title={`Rangverlust durch Rote Karte (ursprünglich ${baseRank})`}
                          >
                            −1
                          </span>
                        )}
                      </div>

                      {/* Col 3: Karten (Counts) */}
                      <div className="col-span-2 flex items-center justify-start md:justify-center gap-1.5">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold ${
                            greenCards.length > 0
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800/60 text-slate-500 border border-slate-800'
                          }`}
                          title={`${greenCards.length} Grüne Karten`}
                        >
                          <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" aria-hidden="true" />
                          <span>{greenCards.length}</span>
                        </span>

                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold ${
                            yellowCards.length > 0
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-slate-800/60 text-slate-500 border border-slate-800'
                          }`}
                          title={`${yellowCards.length} Gelbe Karten`}
                        >
                          <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" aria-hidden="true" />
                          <span>{yellowCards.length}</span>
                        </span>

                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-bold ${
                            redCards.length > 0
                              ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                              : 'bg-slate-800/60 text-slate-500 border border-slate-800'
                          }`}
                          title={`${redCards.length} Rote Karten`}
                        >
                          <span className="w-2 h-2 rounded-full bg-rose-400 shrink-0" aria-hidden="true" />
                          <span>{redCards.length}</span>
                        </span>
                      </div>

                      {/* Col 4: Quick Action Buttons & Expand Chevron */}
                      <div data-tour={index === 0 ? 'card-actions' : undefined} className="col-span-4 flex items-center justify-end gap-1.5 flex-wrap">
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
                          className="pressable focus-ring min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-emerald-500/15 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
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
                          className="pressable focus-ring min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-amber-500/15 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
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
                          className="pressable focus-ring min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-rose-500/20 hover:bg-rose-500/35 text-rose-300 border border-rose-500/40 text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
                          title="Rote Karte vergeben (sofortiger Rangverlust)  (Tastatur: 3)"
                        >
                          <ShieldAlertIcon className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>Rot</span>
                        </button>

                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenTimeoutModal(pupil);
                          }}
                          className="pressable focus-ring min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl bg-gradient-to-r from-amber-500/25 to-rose-500/25 hover:from-amber-500/40 hover:to-rose-500/40 text-amber-200 border border-amber-500/40 text-xs font-bold transition flex items-center gap-1.5 active:scale-95"
                          title="Ins Time-Out (Lernwerkstatt) schicken  (Tastatur: 4)"
                        >
                          <Clock className="w-3.5 h-3.5 text-amber-400" />
                          <span>TIMEOUT</span>
                        </button>

                        <div className="hidden md:flex pl-1 min-h-[44px] min-w-[44px] items-center justify-center text-slate-500 hover:text-slate-300">
                          {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </div>
                      </div>
                    </div>

                    {/* Expanded Detail Panel (When clicked) */}
                    {isExpanded && (
                      <div className="bg-surface-2 px-5 py-4 border-t border-hairline space-y-4">
                        {/* Header inside detail: Info Bar */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800/80 text-xs">
                          <div className="flex items-center gap-3">
                            <span className="text-slate-400">
                              Kriterien: <strong className="text-slate-50">{positiveTicks}</strong> von 18 positiv
                            </span>
                            <span className="text-slate-600">·</span>
                            <span className="text-slate-400">
                              Basis-Rang:{' '}
                              <strong className="text-amber-400">{baseRank}</strong>
                              {hasRedCardDemotion && (
                                <span className="ml-1 text-rose-400 font-bold">
                                  (herabgestuft auf {rank} durch Rote Karte)
                                </span>
                              )}
                            </span>
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
                          <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/40 text-xs text-amber-200 flex items-start gap-2">
                            <Clock className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                            <div>
                              <strong>Aktuell im Time-Out (Lernwerkstatt):</strong>
                              <div className="mt-0.5 text-slate-300">
                                Arbeitsauftrag: &bdquo;{activeTimeoutIncident.task_assignment}&ldquo;
                              </div>
                              <div className="mt-1 text-[11px] text-amber-400">
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
                                              : 'bg-rose-400'
                                          }`}
                                          aria-hidden="true"
                                        />
                                        {c.card_type === 'green'
                                          ? 'Grüne Karte'
                                          : c.card_type === 'yellow'
                                          ? 'Gelbe Karte'
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
                    Möchten Sie den Schüler {redCardTarget.pupilName} wirklich zu {redCardTarget.demotedRank} degradieren?
                  </p>
                  <p className="text-slate-300 leading-relaxed">
                    Eine <strong className="text-rose-400">Rote Karte</strong> führt zu einem <strong>sofortigen Rangverlust (Instant Rank Loss)</strong>.
                    Der Schüler wird verbindlich um eine Rangstufe degradiert:
                  </p>
                  <div className="flex items-center gap-3 pt-2 font-bold text-sm">
                    <span className="px-3 py-1 rounded-xl bg-slate-800 border border-slate-700 text-slate-300">
                      {redCardTarget.currentRank}
                    </span>
                    <span className="text-rose-400">➔</span>
                    <span className="px-3 py-1 rounded-xl bg-rose-500/30 border border-rose-500/60 text-rose-300">
                      {redCardTarget.demotedRank}
                    </span>
                  </div>
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
                <div className="text-xs text-slate-300">
                  Schüler*in: <strong className="text-slate-50">{redCardTarget.pupilName}</strong> (Klasse {currentClass.name})
                  <span className="block text-rose-400 font-bold mt-1">
                    Degradierung zu: {redCardTarget.demotedRank}
                  </span>
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

      {/* Modal: TIMEOUT (Ins Time-Out / Lernwerkstatt schicken) */}
      {timeoutTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md">
          <div className="bg-slate-900 border-2 border-amber-500/60 rounded-3xl w-full max-w-lg p-6 shadow-lg shadow-sm">
            <div className="flex items-center justify-between pb-3 border-b border-amber-500/20 mb-4">
              <div className="flex items-center gap-2 text-amber-400">
                <Clock className="w-5 h-5 flex-shrink-0 animate-pulse" />
                <h3 className="font-bold text-slate-50 text-base">
                  Schüler*in ins Time-Out (Lernwerkstatt) schicken
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
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3.5 text-xs text-amber-200">
                <p className="font-bold text-amber-300 mb-1">
                  <ShieldAlertIcon className="w-5 h-5 inline align-text-bottom" aria-hidden="true" /> Disziplinäres Time-Out für {timeoutTarget.pupilName} (Klasse {currentClass.name})
                </p>
                <p className="text-slate-300 leading-relaxed">
                  Dieses Time-Out gilt verbindlich als <strong>Rote Karte (Instant Rank Loss)</strong> und leitet den Schüler mit dem unten stehenden Arbeitsauftrag direkt an die Aufsicht in der Lernwerkstatt (LW) weiter.
                </p>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase text-amber-300 block mb-1.5">
                  Arbeitsauftrag für das Time-Out (zwingend erforderlich):
                </label>
                <textarea
                  rows={4}
                  value={timeoutTask}
                  onChange={(e) => setTimeoutTask(e.target.value)}
                  placeholder="Geben Sie hier die Aufgaben oder Arbeitsblätter an, die der Schüler in der Lernwerkstatt bearbeiten muss..."
                  className="w-full p-3.5 rounded-2xl bg-slate-950 border border-amber-500/40 text-xs text-slate-50 placeholder-slate-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400"
                />
                {timeoutTask.trim().length === 0 && (
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
                  disabled={submittingTimeout || !timeoutTask.trim()}
                  className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-rose-600 hover:from-amber-400 hover:to-rose-500 text-slate-950 font-bold text-xs transition shadow-lg shadow-sm flex items-center gap-1.5 disabled:opacity-40"
                >
                  <Clock className="w-3.5 h-3.5" />
                  <span>{submittingTimeout ? 'Übermittle...' : 'Ins Time-Out schicken & Rote Karte eintragen'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
