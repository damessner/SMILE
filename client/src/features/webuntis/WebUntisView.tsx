import { WebUntisConnectModal } from './WebUntisConnectModal';
import React, { useState, useEffect, useMemo } from 'react';
import {
  BookOpen,
  Calendar,
  Clock,
  UserCheck,
  UserX,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Search,
  Plus,
  Send,
  ShieldAlert,
  Sparkles,
  Layers,
  ChevronLeft,
  ChevronRight,
  FileEdit,
  Info,
  ExternalLink,
} from 'lucide-react';
import type { SchoolClass, User, PupilWithData } from '../../types';
import {
  getWebUntisStatus,
  getWebUntisAccount,
  type WebUntisAccountStatus,
  getWebUntisTimetable,
  saveWebUntisTeachingContent,
  getWebUntisAbsences,
  getWebUntisEvents,
  createWebUntisEvent,
  type WebUntisStatus,
  type WebUntisLessonItem,
  type WebUntisAbsenceItem,
  type WebUntisEventItem,
} from '../../services/api';

interface WebUntisViewProps {
  currentClass: SchoolClass | null;
  classes: SchoolClass[];
  currentUser: User;
  pupils: PupilWithData[];
}

type SubTab = 'timetable' | 'absences' | 'events';
type TimetableMode = 'calendar' | 'list';

/**
 * Format a Date object to 'YYYY-MM-DD' using local calendar components.
 * Prevents UTC timezone off-by-one errors (e.g. midnight CET -> previous day UTC).
 */
export function formatLocalDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Format a Date object to YYYYMMDD integer using local calendar components.
 */
export function formatLocalDateInt(d: Date): number {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return Number(`${y}${m}${day}`);
}

/** Convert a WebUntis YYYYMMDD integer into `YYYY-MM-DD` (no Date round-trip). */
export function dateIntToIso(value: number): string {
  const s = String(value);
  if (!/^\d{8}$/.test(s)) return '';
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message
    ? err.message
    : 'WebUntis ist derzeit nicht erreichbar.';
}

export interface DutyBadgeInfo {
  label: string;
  icon: string;
  bg: string;
  text: string;
  border: string;
}

export function getDutyBadge(lesson: WebUntisLessonItem): DutyBadgeInfo | null {
  const isMM =
    lesson.dutyType === 'lunch' ||
    lesson.subjects.some((s) => /^(MM|MITTAGSBETREUUNG)$/i.test(s.name?.trim() || ''));
  if (isMM) {
    return {
      label: 'Mittagsbetreuung',
      icon: '🍽️',
      bg: 'bg-amber-500/15',
      text: 'text-amber-300',
      border: 'border-amber-500/30',
    };
  }
  const isSPR =
    lesson.dutyType === 'office_hour' ||
    lesson.subjects.some((s) => /^(SPR|SPRECHSTUNDE)$/i.test(s.name?.trim() || ''));
  if (isSPR) {
    return {
      label: 'Sprechstunde',
      icon: '💬',
      bg: 'bg-purple-500/15',
      text: 'text-purple-300',
      border: 'border-purple-500/30',
    };
  }
  const isAufsicht =
    lesson.dutyType === 'supervision' ||
    lesson.subjects.some((s) => /AUFSICHT|PAUSENAUFSICHT|BEREITSCHAFT/i.test(s.name?.trim() || ''));
  if (isAufsicht) {
    return {
      label: 'Pausenaufsicht',
      icon: '👁️',
      bg: 'bg-sky-500/15',
      text: 'text-sky-300',
      border: 'border-sky-500/30',
    };
  }
  if (lesson.isDuty) {
    return {
      label: 'Dienst / Aufsicht',
      icon: '📋',
      bg: 'bg-slate-800',
      text: 'text-slate-300',
      border: 'border-slate-700',
    };
  }
  return null;
}

export function groupDutyLessons(lessons: WebUntisLessonItem[]): WebUntisLessonItem[] {
  const result: WebUntisLessonItem[] = [];
  const dutyGroups = new Map<string, WebUntisLessonItem>();

  for (const l of lessons) {
    const dutyBadge = getDutyBadge(l);
    if (!l.isDuty && !dutyBadge) {
      result.push(l);
      continue;
    }
    const dutyTypeKey = l.dutyType || dutyBadge?.label || l.subjects[0]?.name || 'duty';
    const dutyKey = `${l.date}_${l.startTime}_${l.endTime}_${dutyTypeKey}`;
    const existing = dutyGroups.get(dutyKey);
    if (!existing) {
      const grouped: WebUntisLessonItem = {
        ...l,
        isDuty: true,
        missingTeachingContent: false,
        missingAttendance: false,
        classes: [...l.classes],
      };
      dutyGroups.set(dutyKey, grouped);
      result.push(grouped);
    } else {
      for (const c of l.classes) {
        if (!existing.classes.some((ec) => ec.id === c.id || ec.name === c.name)) {
          existing.classes.push(c);
        }
      }
    }
  }

  return result;
}

export function WebUntisView({ currentClass, classes, currentUser, pupils }: WebUntisViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('timetable');
  const [selectedClassId, setSelectedClassId] = useState<number | 'all'>('all');
  const [timetableMode, setTimetableMode] = useState<TimetableMode>('calendar');

  // Dates
  const [refDate, setRefDate] = useState<Date>(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string>(() => formatLocalDateIso(new Date()));

  // Status
  const [status, setStatus] = useState<WebUntisStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const [dataError, setDataError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Personal WebUntis Account
  const [accountStatus, setAccountStatus] = useState<WebUntisAccountStatus | null>(null);
  const [loadingAccount, setLoadingAccount] = useState<boolean>(true);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState<boolean>(false);

  // Timetable & Teaching Content
  const [lessons, setLessons] = useState<WebUntisLessonItem[]>([]);
  const [loadingLessons, setLoadingLessons] = useState<boolean>(false);
  const [lessonEdits, setLessonEdits] = useState<Record<number, string>>({});
  const [savingLessonId, setSavingLessonId] = useState<number | null>(null);
  const [savedLessonIds, setSavedLessonIds] = useState<Record<number, boolean>>({});

  // Absences
  const [absences, setAbsences] = useState<WebUntisAbsenceItem[]>([]);
  const [loadingAbsences, setLoadingAbsences] = useState<boolean>(false);
  const [absenceSearch, setAbsenceSearch] = useState<string>('');

  // Events / Disciplinary
  const [events, setEvents] = useState<WebUntisEventItem[]>([]);
  const [loadingEvents, setLoadingEvents] = useState<boolean>(false);
  const [eventSearch, setEventSearch] = useState<string>('');

  // Modal: New Event
  const [isNewEventModalOpen, setIsNewEventModalOpen] = useState<boolean>(false);
  const [modalPupilId, setModalPupilId] = useState<number>(0);
  const [modalCategoryId, setModalCategoryId] = useState<number>(2); // 2 = Verhalten
  const [modalText, setModalText] = useState<string>('');
  const [submittingEvent, setSubmittingEvent] = useState<boolean>(false);
  const [eventError, setEventError] = useState<string | null>(null);

  // Calculate School Week (Monday through Friday)
  const schoolWeek = useMemo(() => {
    const d = new Date(refDate);
    const day = d.getDay();
    // On Saturday (6) or Sunday (0), move forward to the upcoming Monday
    const diffToMonday = day === 0 ? 1 : day === 6 ? 2 : 1 - day;
    const monday = new Date(d);
    monday.setDate(d.getDate() + diffToMonday);
    monday.setHours(12, 0, 0, 0); // Noon prevents any DST or midnight boundary rollovers

    const dayNames = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag'];
    const dayShorts = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
    const todayStr = formatLocalDateIso(new Date());

    const days: Array<{
      date: Date;
      dateStr: string;
      dayName: string;
      dayShort: string;
      formattedDate: string;
      isToday: boolean;
      dateInt: number;
    }> = [];

    for (let i = 0; i < 5; i++) {
      const cur = new Date(monday);
      cur.setDate(monday.getDate() + i);
      const dateStr = formatLocalDateIso(cur);
      const dateInt = formatLocalDateInt(cur);
      const dd = String(cur.getDate()).padStart(2, '0');
      const mm = String(cur.getMonth() + 1).padStart(2, '0');

      days.push({
        date: cur,
        dateStr,
        dayName: dayNames[i],
        dayShort: dayShorts[i],
        formattedDate: `${dd}.${mm}.`,
        isToday: dateStr === todayStr,
        dateInt,
      });
    }

    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    // Calculate calendar week (ISO KW)
    const target = new Date(monday.valueOf());
    const dayNr = (monday.getDay() + 6) % 7;
    target.setDate(target.getDate() - dayNr + 3);
    const firstThursday = target.valueOf();
    target.setMonth(0, 1);
    if (target.getDay() !== 4) {
      target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
    }
    const kw = 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);

    const moDay = String(monday.getDate()).padStart(2, '0');
    const moMonth = String(monday.getMonth() + 1).padStart(2, '0');
    const frDay = String(friday.getDate()).padStart(2, '0');
    const frMonth = String(friday.getMonth() + 1).padStart(2, '0');
    const year = friday.getFullYear();

    return {
      monday,
      friday,
      mondayStr: formatLocalDateIso(monday),
      fridayStr: formatLocalDateIso(friday),
      kw,
      label: `Schulwoche KW ${kw} (${moDay}.${moMonth}. – ${frDay}.${frMonth}.${year})`,
      days,
    };
  }, [refDate]);

  // Load Personal WebUntis Account
  const loadAccount = async () => {
    try {
      setLoadingAccount(true);
      const acc = await getWebUntisAccount();
      setAccountStatus(acc);
    } catch {
      setAccountStatus(null);
    } finally {
      setLoadingAccount(false);
    }
  };

  // Load Status
  const loadStatus = async () => {
    try {
      setLoadingStatus(true);
      const s = await getWebUntisStatus();
      setStatus(s);
    } catch {
      setStatus(null);
    } finally {
      setLoadingStatus(false);
    }
  };

  // Load Timetable
  const loadLessons = async () => {
    try {
      setLoadingLessons(true);
      setDataError(null);
      const classIdParam = selectedClassId === 'all' ? undefined : selectedClassId;

      let res: { lessons: WebUntisLessonItem[] };
      if (timetableMode === 'calendar') {
        res = await getWebUntisTimetable({
          startDate: schoolWeek.mondayStr,
          endDate: schoolWeek.fridayStr,
          classId: classIdParam,
        });
      } else {
        res = await getWebUntisTimetable(selectedDate, classIdParam);
      }

      setLessons(res.lessons || []);

      // Prepopulate lesson edits from existing Lehrstoff
      const initialEdits: Record<number, string> = {};
      for (const l of res.lessons || []) {
        if (l.lessonText) {
          initialEdits[l.id] = l.lessonText;
        }
      }
      setLessonEdits((prev) => ({ ...initialEdits, ...prev }));
    } catch (err) {
      // An outage is not an empty timetable. Keep the previous data visible and
      // show why it could not be refreshed.
      setDataError(errorMessage(err));
    } finally {
      setLoadingLessons(false);
    }
  };

  // Save Teaching Content (Lehrstoff)
  const handleSaveTeachingContent = async (lesson: WebUntisLessonItem) => {
    const text = lessonEdits[lesson.id]?.trim();
    if (!text) return;

    const classId = selectedClassId === 'all' ? lesson.classes[0]?.id : selectedClassId;
    const date = dateIntToIso(lesson.date);
    if (!classId || !date) {
      setSaveError('Klasse oder Datum der Stunde konnte nicht bestimmt werden.');
      return;
    }

    try {
      setSavingLessonId(lesson.id);
      setSaveError(null);
      await saveWebUntisTeachingContent(lesson.id, classId, date, text);
      setSavedLessonIds((prev) => ({ ...prev, [lesson.id]: true }));
      // Also update in-memory lesson state
      setLessons((prev) =>
        prev.map((l) => (l.id === lesson.id ? { ...l, lessonText: text, hasTeachingContent: true, missingTeachingContent: false } : l)),
      );
      setTimeout(() => {
        setSavedLessonIds((prev) => ({ ...prev, [lesson.id]: false }));
      }, 3000);
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setSavingLessonId(null);
    }
  };

  // Load Absences
  const loadAbsences = async () => {
    try {
      setLoadingAbsences(true);
      setDataError(null);
      const classIdParam = selectedClassId === 'all' ? undefined : selectedClassId;
      const res = await getWebUntisAbsences(selectedDate, classIdParam);
      setAbsences(res.absences || []);
    } catch (err) {
      setDataError(errorMessage(err));
    } finally {
      setLoadingAbsences(false);
    }
  };

  // Load Events
  const loadEvents = async () => {
    try {
      setLoadingEvents(true);
      const classIdParam = selectedClassId === 'all' ? undefined : selectedClassId;
      const res = await getWebUntisEvents(classIdParam);
      setEvents(res.events || []);
    } catch {
      // Event reading permissions may not be granted to standard teacher accounts.
      // Keep events empty rather than masking the timetable or absences.
      setEvents([]);
    } finally {
      setLoadingEvents(false);
    }
  };

  const refreshData = () => {
    loadLessons();
    loadAbsences();
    loadEvents();
  };

  useEffect(() => {
    loadStatus();
    loadAccount();
  }, []);

  useEffect(() => {
    refreshData();
  }, [timetableMode, refDate, selectedDate, selectedClassId]);

  // Week navigation
  const handleShiftWeek = (weeks: number) => {
    setRefDate((prev) => new Date(prev.getTime() + weeks * 7 * 86400000));
  };

  const handleResetToCurrentWeek = () => {
    setRefDate(new Date());
  };

  // Date shifting (for list view)
  const handleShiftDate = (days: number) => {
    const parts = selectedDate.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
    d.setDate(d.getDate() + days);
    setSelectedDate(formatLocalDateIso(d));
  };

  const isToday = selectedDate === formatLocalDateIso(new Date());

  // Filter lessons by selected class if specific class chosen
  const filteredLessons = useMemo(() => {
    if (selectedClassId === 'all') return lessons;
    const selectedClass = classes.find((c) => c.id === selectedClassId);
    return lessons.filter(
      (l) =>
        l.classes.some((c) => c.id === selectedClassId) ||
        (selectedClass && l.classes.some((c) => c.name.toLowerCase() === selectedClass.name.toLowerCase())),
    );
  }, [lessons, selectedClassId, classes]);

  // Group lessons by day (dateInt) for Calendar View and collapse duplicate duty slots
  const lessonsByDay = useMemo(() => {
    const map = new Map<number, WebUntisLessonItem[]>();
    for (const d of schoolWeek.days) {
      map.set(d.dateInt, []);
    }
    for (const l of filteredLessons) {
      const arr = map.get(l.date);
      if (arr) {
        arr.push(l);
      }
    }
    for (const [dateInt, list] of map.entries()) {
      list.sort((a, b) => a.startTime - b.startTime);
      map.set(dateInt, groupDutyLessons(list));
    }
    return map;
  }, [filteredLessons, schoolWeek]);

  // Lessons for List View with collapsed duplicate duty slots
  const listLessons = useMemo(() => {
    const sorted = [...filteredLessons].sort((a, b) => a.startTime - b.startTime);
    return groupDutyLessons(sorted);
  }, [filteredLessons]);

  // Missing counts (duty slots like MM, SPR, Aufsicht do not require teaching content or attendance)
  const missingLehrstoffCount = useMemo(
    () => filteredLessons.filter((l) => !l.isDuty && !getDutyBadge(l) && l.missingTeachingContent).length,
    [filteredLessons],
  );
  const missingAttendanceCount = useMemo(
    () => filteredLessons.filter((l) => !l.isDuty && !getDutyBadge(l) && l.missingAttendance).length,
    [filteredLessons],
  );

  // Filtered Absences
  const filteredAbsences = useMemo(() => {
    if (!absenceSearch.trim()) return absences;
    const q = absenceSearch.toLowerCase();
    return absences.filter(
      (a) =>
        a.studentName?.toLowerCase().includes(q) ||
        a.className?.toLowerCase().includes(q) ||
        a.reason?.toLowerCase().includes(q) ||
        a.text?.toLowerCase().includes(q),
    );
  }, [absences, absenceSearch]);

  // Filtered Events
  const filteredEvents = useMemo(() => {
    if (!eventSearch.trim()) return events;
    const q = eventSearch.toLowerCase();
    return events.filter(
      (e) =>
        e.studentName?.toLowerCase().includes(q) ||
        e.className?.toLowerCase().includes(q) ||
        e.teacherName?.toLowerCase().includes(q) ||
        e.text.toLowerCase().includes(q),
    );
  }, [events, eventSearch]);

  // Navigate to absences tab for a specific day
  const handleInspectAbsences = (dateStr: string) => {
    setSelectedDate(dateStr);
    setActiveSubTab('absences');
  };

  // Submit New Klassenbucheintrag
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modalPupilId || !modalText.trim()) {
      setEventError('Bitte wählen Sie einen Schüler und geben Sie einen Text ein.');
      return;
    }

    const targetClassId = selectedClassId === 'all' ? (currentClass?.id || classes[0]?.id) : selectedClassId;
    if (!targetClassId) {
      setEventError('Keine Klasse ausgewählt.');
      return;
    }

    try {
      setSubmittingEvent(true);
      setEventError(null);
      await createWebUntisEvent({
        studentId: modalPupilId,
        classId: targetClassId,
        text: modalText.trim(),
        categoryId: modalCategoryId,
        date: selectedDate,
      });

      setIsNewEventModalOpen(false);
      setModalText('');
      setModalPupilId(0);
      loadEvents();
    } catch (err) {
      setEventError(err instanceof Error ? err.message : 'Fehler beim Erstellen des Eintrags in WebUntis.');
    } finally {
      setSubmittingEvent(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Cockpit Header */}
      <div className="p-4 md:p-6 rounded-2xl bg-slate-900 border border-slate-800 shadow-xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-100">WebUntis-Integration</h1>
                {!loadingStatus && status && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                      status.connected
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${status.connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                    {status.connected
                      ? status.account === 'service'
                        ? 'Schulweite Ansicht (nur Lesen)'
                        : status.environment === 'playground'
                          ? 'Spielwiese'
                          : 'MS-Telfs Live'
                      : 'Getrennt'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Stundenplan, Wochenübersicht, Lehrstoff eintragen, Abwesenheiten & Klassenbuch-Synchronisierung.
              </p>
            </div>
          </div>

          {/* Top Actions: Personal Account Wizard & Refresh */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setIsConnectModalOpen(true)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 shadow-sm ${
                accountStatus?.connected
                  ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                  : 'bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 border-transparent shadow-sky-500/20 font-extrabold'
              }`}
              title={
                accountStatus?.connected
                  ? `Verbunden als ${accountStatus.account?.teacherShort || accountStatus.account?.username} (${accountStatus.account?.server}). Klicken zum Verwalten oder Trennen.`
                  : 'Eigenes persönliches WebUntis-Konto verknüpfen'
              }
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>
                {accountStatus?.connected
                  ? `WebUntis: ${accountStatus.account?.teacherShort || accountStatus.account?.username}`
                  : 'Eigenes WebUntis-Konto verknüpfen'}
              </span>
              {accountStatus?.connected && (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
            </button>

            <button
              onClick={refreshData}
              disabled={loadingLessons || loadingAbsences || loadingEvents}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
              title="Daten aus WebUntis neu laden"
            >
              <RefreshCw
                className={`w-4 h-4 ${loadingLessons || loadingAbsences || loadingEvents ? 'animate-spin text-sky-400' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Filter Bar: Class Selector & Week/Date Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Filter:</span>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-slate-100 focus:outline-none focus:border-sky-500"
            >
              <option value="all">Alle meine Klassen & Stunden</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  Klasse {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Navigation Controls: School Week for Calendar vs Day Picker for List/Absences */}
          {activeSubTab === 'timetable' && timetableMode === 'calendar' ? (
            <div className="flex items-center gap-1.5 bg-slate-800/70 p-1 rounded-xl border border-slate-700">
              <button
                onClick={() => handleShiftWeek(-1)}
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition"
                title="Vorherige Schulwoche"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="text-xs font-bold text-slate-200 px-2 py-0.5 whitespace-nowrap">
                {schoolWeek.label}
              </span>

              <button
                onClick={() => handleShiftWeek(1)}
                className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition"
                title="Nächste Schulwoche"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                onClick={handleResetToCurrentWeek}
                className="ml-1 px-2.5 py-1 rounded-md bg-sky-500/20 text-sky-300 text-[11px] font-bold hover:bg-sky-500/30 transition"
              >
                Aktuelle Woche
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1.5 bg-slate-800/70 p-1 rounded-xl border border-slate-700">
              <button
                onClick={() => handleShiftDate(-1)}
                className="p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition"
                title="Vorheriger Tag"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-xs font-bold text-slate-200 px-2 py-0.5 focus:outline-none cursor-pointer"
              />

              <button
                onClick={() => handleShiftDate(1)}
                className="p-1 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-slate-100 transition"
                title="Nächster Tag"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              {!isToday && (
                <button
                  onClick={() => setSelectedDate(formatLocalDateIso(new Date()))}
                  className="ml-1 px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 text-[11px] font-bold hover:bg-sky-500/30 transition"
                >
                  Heute
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Load / write errors are stated, not rendered as an empty day. */}
      {dataError && (
        <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-200 text-xs flex items-center justify-between gap-3">
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
            <span>{dataError}</span>
          </span>
          <button
            onClick={refreshData}
            className="px-2.5 py-1 rounded-lg bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 font-semibold shrink-0"
          >
            Erneut versuchen
          </button>
        </div>
      )}

      {saveError && (
        <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {/* Banner if personal account not connected */}
      {accountStatus && !accountStatus.connected && (
        <div className="p-4 rounded-2xl bg-gradient-to-r from-sky-950/40 via-slate-900 to-indigo-950/40 border border-sky-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-lg">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center text-sky-400 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
                <span>Eigenes WebUntis-Konto noch nicht verknüpft</span>
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Empfohlen
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Verbinden Sie Ihren persönlichen WebUntis-Account, um Ihren individuellen Wochenplan, fehlenden Lehrstoff und offene Anwesenheiten direkt zu sehen.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsConnectModalOpen(true)}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 font-bold text-xs flex items-center gap-2 shrink-0 shadow-md transition"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Jetzt verknüpfen</span>
          </button>
        </div>
      )}

      {/* Main Feature Navigation Sub-Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('timetable')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
              activeSubTab === 'timetable'
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Stundenplan & Lehrstoff</span>
            {filteredLessons.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeSubTab === 'timetable' ? 'bg-slate-950 text-sky-400' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {filteredLessons.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('absences')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
              activeSubTab === 'absences'
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <UserX className="w-4 h-4" />
            <span>Abwesenheiten</span>
            {absences.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeSubTab === 'absences' ? 'bg-slate-950 text-sky-400' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {absences.length}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveSubTab('events')}
            className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-2 transition ${
              activeSubTab === 'events'
                ? 'bg-sky-500 text-slate-950 shadow-md'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Klassenbuch & Disziplinar</span>
            {events.length > 0 && (
              <span
                className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  activeSubTab === 'events' ? 'bg-slate-950 text-sky-400' : 'bg-slate-800 text-slate-400'
                }`}
              >
                {events.length}
              </span>
            )}
          </button>
        </div>

        {/* View Mode Switcher (Calendar vs List) when on timetable tab */}
        {activeSubTab === 'timetable' && (
          <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
            <button
              onClick={() => setTimetableMode('calendar')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                timetableMode === 'calendar'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Wochen-Kalender</span>
            </button>
            <button
              onClick={() => setTimetableMode('list')}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 transition ${
                timetableMode === 'list'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Tages-Liste</span>
            </button>
          </div>
        )}
      </div>

      {/* SUB-TAB 1: Stundenplan & Lehrstoff */}
      {activeSubTab === 'timetable' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-sky-400" />
                <span>
                  {timetableMode === 'calendar'
                    ? `Wochenplan: ${schoolWeek.label} (${filteredLessons.length} Einheiten)`
                    : `Unterrichtsstunden & Lehrstoff am ${selectedDate} (${filteredLessons.length})`}
                </span>
              </h2>
              <span className="text-xs text-slate-400">
                Stundenplan nach Schulwoche. Tragen Sie hier direkt den Lehrstoff ein und prüfen Sie offene Anwesenheiten.
              </span>
            </div>

            {/* Timetable status chips */}
            <div className="flex flex-wrap items-center gap-2">
              {missingLehrstoffCount > 0 ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  {missingLehrstoffCount}x Lehrstoff fehlt
                </span>
              ) : filteredLessons.some((l) => l.hasTeachingContent) ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Lehrstoff vollständig
                </span>
              ) : null}

              {missingAttendanceCount > 0 ? (
                <button
                  onClick={() => setActiveSubTab('absences')}
                  className="px-2.5 py-1 rounded-full text-xs font-bold bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 flex items-center gap-1.5 transition cursor-pointer"
                  title="Zur Abwesenheitsliste wechseln"
                >
                  <UserX className="w-3.5 h-3.5 text-rose-400" />
                  {missingAttendanceCount}x Anwesenheit fehlt
                </button>
              ) : filteredLessons.some((l) => l.attendanceChecked === true) ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Anwesenheiten geprüft
                </span>
              ) : null}
            </div>
          </div>

          {loadingLessons ? (
            <div className="py-20 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-8 h-8 animate-spin text-sky-400" />
              <span className="text-sm font-semibold">Stundenplan wird aus WebUntis synchronisiert...</span>
            </div>
          ) : filteredLessons.length === 0 ? (
            <div className="py-16 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800/80 space-y-2">
              <Calendar className="w-10 h-10 mx-auto text-slate-600" />
              <p className="font-semibold text-slate-300">
                {dataError ? 'Stundenplan konnte nicht geladen werden.' : 'Keine Stunden für diesen Zeitraum gefunden.'}
              </p>
              {!dataError && (
                <p className="text-xs text-slate-500">
                  Wählen Sie eine andere Schulwoche oder überprüfen Sie Ihre verknüpften Kontodaten.
                </p>
              )}
            </div>
          ) : timetableMode === 'calendar' ? (
            /* ==============================================================
             * 5-COLUMN CALENDAR VIEW (SCHULWOCHE: MONTAG BIS FREITAG)
             * ============================================================== */
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              {schoolWeek.days.map((day) => {
                const dayLessons = lessonsByDay.get(day.dateInt) || [];
                const dayMissingLehrstoff = dayLessons.filter((l) => !l.isDuty && !getDutyBadge(l) && l.missingTeachingContent).length;
                const dayMissingAttendance = dayLessons.filter((l) => !l.isDuty && !getDutyBadge(l) && l.missingAttendance).length;

                return (
                  <div
                    key={day.dateStr}
                    className={`rounded-2xl border flex flex-col bg-slate-900/60 overflow-hidden transition ${
                      day.isToday ? 'border-sky-500/50 shadow-lg shadow-sky-500/10' : 'border-slate-800'
                    }`}
                  >
                    {/* Day Column Header */}
                    <div
                      className={`p-3 border-b flex items-center justify-between ${
                        day.isToday
                          ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
                          : 'bg-slate-950/60 border-slate-800/80 text-slate-200'
                      }`}
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="font-extrabold text-xs">{day.dayName}</span>
                          {day.isToday && (
                            <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-sky-500 text-slate-950">
                              Heute
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">{day.formattedDate}</span>
                      </div>

                      <div className="flex items-center gap-1 text-[10px] font-bold">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                          {dayLessons.length}
                        </span>
                        {dayMissingLehrstoff > 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-amber-400 animate-pulse"
                            title={`${dayMissingLehrstoff}x Lehrstoff fehlt`}
                          />
                        )}
                        {dayMissingAttendance > 0 && (
                          <span
                            className="w-2 h-2 rounded-full bg-rose-400 animate-pulse"
                            title={`${dayMissingAttendance}x Anwesenheit fehlt`}
                          />
                        )}
                      </div>
                    </div>

                    {/* Day Column Lessons */}
                    <div className="p-2.5 flex-1 space-y-2.5">
                      {dayLessons.length === 0 ? (
                        <div className="py-10 text-center text-[11px] text-slate-600 border border-dashed border-slate-800/60 rounded-xl">
                          Keine Stunden
                        </div>
                      ) : (
                        dayLessons.map((lesson) => {
                          const dutyBadge = getDutyBadge(lesson);
                          const startTimeStr = String(lesson.startTime).padStart(4, '0');
                          const endTimeStr = String(lesson.endTime).padStart(4, '0');
                          const timeLabel = `${startTimeStr.slice(0, 2)}:${startTimeStr.slice(2)} – ${endTimeStr.slice(0, 2)}:${endTimeStr.slice(2)}`;
                          const subject = lesson.subjects.map((s) => s.name).join(', ') || 'Unterricht';
                          const teacher = lesson.teachers.map((t) => t.name).join(', ');
                          const room = lesson.rooms.map((r) => r.name).join(', ');
                          const classesStr = lesson.classes.map((c) => c.name).join(', ');
                          const isSaved = savedLessonIds[lesson.id];
                          const isSaving = savingLessonId === lesson.id;

                          return (
                            <div
                              key={lesson.id}
                              className={`p-3 rounded-xl border transition space-y-2 ${
                                dutyBadge
                                  ? 'bg-slate-900/40 border-slate-800/80 hover:border-slate-700'
                                  : lesson.missingTeachingContent || lesson.missingAttendance
                                  ? 'border-amber-500/30 hover:border-amber-500/50 bg-slate-950/80'
                                  : 'border-slate-800/90 hover:border-slate-700 bg-slate-950/80'
                              }`}
                            >
                              {/* Top row: Subject / Duty Badge, Class, Room & Time */}
                              <div className="flex items-start justify-between gap-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {dutyBadge ? (
                                    <span
                                      className={`px-2 py-0.5 rounded-md font-bold text-xs border flex items-center gap-1.5 ${dutyBadge.bg} ${dutyBadge.text} ${dutyBadge.border}`}
                                    >
                                      <span>{dutyBadge.icon}</span>
                                      <span>{dutyBadge.label}</span>
                                    </span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-300 font-bold text-xs border border-sky-500/30">
                                      {subject}
                                    </span>
                                  )}
                                  {classesStr && (
                                    <span className="text-[11px] font-bold text-slate-200 bg-slate-800 px-1.5 py-0.5 rounded">
                                      {classesStr}
                                    </span>
                                  )}
                                  {room && (
                                    <span className="text-[10px] text-slate-400 bg-slate-800/40 px-1 py-0.5 rounded">
                                      {room}
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3 text-slate-500" />
                                  {timeLabel}
                                </span>
                                {teacher && <span className="text-[10px] text-slate-500">{teacher}</span>}
                              </div>

                              {/* Status Badges */}
                              {dutyBadge ? (
                                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800/60 border border-slate-700/60 text-slate-400">
                                    Dienst / Betreuung • kein Lehrstoff
                                  </span>
                                </div>
                              ) : (
                                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                                  {lesson.missingTeachingContent ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                                      <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                                      Lehrstoff fehlt
                                    </span>
                                  ) : lesson.hasTeachingContent ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                                      <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                                      Lehrstoff erfasst
                                    </span>
                                  ) : null}

                                  {lesson.missingAttendance ? (
                                    <button
                                      onClick={() => handleInspectAbsences(day.dateStr)}
                                      className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 flex items-center gap-1 transition cursor-pointer"
                                      title="Anwesenheitsliste für diese Stunde prüfen"
                                    >
                                      <UserX className="w-3 h-3 text-rose-400 shrink-0" />
                                      Anwesenheit fehlt
                                    </button>
                                  ) : lesson.attendanceChecked ? (
                                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                                      <UserCheck className="w-3 h-3 text-emerald-400 shrink-0" />
                                      Anwesenheit erfasst
                                    </span>
                                  ) : null}
                                </div>
                              )}

                              {/* Lehrstoff Inline Editor (only for teaching lessons, not duty slots) */}
                              {!dutyBadge && (
                                <div className="pt-1.5 border-t border-slate-800/80 space-y-1">
                                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
                                    <span>Lehrstoff:</span>
                                    {isSaved && (
                                      <span className="text-emerald-400 flex items-center gap-1 font-bold">
                                        <CheckCircle2 className="w-3 h-3" /> Gespeichert
                                      </span>
                                    )}
                                  </div>
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      value={lessonEdits[lesson.id] ?? ''}
                                      onChange={(e) =>
                                        setLessonEdits((prev) => ({ ...prev, [lesson.id]: e.target.value }))
                                      }
                                      placeholder="Thema / Lehrstoff..."
                                      className="flex-1 px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-[11px] text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                                    />
                                    <button
                                      onClick={() => handleSaveTeachingContent(lesson)}
                                      disabled={isSaving || !lessonEdits[lesson.id]?.trim()}
                                      className="p-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold transition shrink-0"
                                      title="Lehrstoff in WebUntis speichern"
                                    >
                                      {isSaving ? (
                                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                      ) : (
                                        <Send className="w-3.5 h-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            /* ==============================================================
             * LIST VIEW (TAGES-LISTE)
             * ============================================================== */
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {listLessons.map((lesson) => {
                const dutyBadge = getDutyBadge(lesson);
                const startTimeStr = String(lesson.startTime).padStart(4, '0');
                const endTimeStr = String(lesson.endTime).padStart(4, '0');
                const timeLabel = `${startTimeStr.slice(0, 2)}:${startTimeStr.slice(2)} – ${endTimeStr.slice(0, 2)}:${endTimeStr.slice(2)}`;
                const subject = lesson.subjects.map((s) => s.name).join(', ') || 'Unterricht';
                const teacher = lesson.teachers.map((t) => t.name).join(', ') || 'Lehrkraft';
                const room = lesson.rooms.map((r) => r.name).join(', ') || '';
                const classesStr = lesson.classes.map((c) => c.name).join(', ');
                const isSaved = savedLessonIds[lesson.id];
                const isSaving = savingLessonId === lesson.id;

                return (
                  <div
                    key={lesson.id}
                    className={`p-4 rounded-xl border transition space-y-3 ${
                      dutyBadge
                        ? 'bg-slate-900/60 border-slate-800 hover:border-slate-700'
                        : 'bg-slate-900 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {dutyBadge ? (
                          <span
                            className={`px-2.5 py-1 rounded-lg font-bold text-xs border flex items-center gap-1.5 ${dutyBadge.bg} ${dutyBadge.text} ${dutyBadge.border}`}
                          >
                            <span>{dutyBadge.icon}</span>
                            <span>{dutyBadge.label}</span>
                          </span>
                        ) : (
                          <span className="px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-400 font-bold text-xs border border-sky-500/20">
                            {subject}
                          </span>
                        )}
                        {classesStr && (
                          <span className="text-xs font-semibold text-slate-300 bg-slate-800 px-2 py-0.5 rounded">
                            {classesStr}
                          </span>
                        )}
                        {room && (
                          <span className="text-[11px] text-slate-400 bg-slate-800/50 px-1.5 py-0.5 rounded">
                            {room}
                          </span>
                        )}
                      </div>
                      <div className="text-right">
                        <span className="text-xs font-semibold text-slate-400 flex items-center gap-1">
                          <Clock className="w-3 h-3 text-slate-500" />
                          {timeLabel}
                        </span>
                        <span className="text-[10px] text-slate-500">{teacher}</span>
                      </div>
                    </div>

                    {/* Status Badges: Lehrstoff fehlt / Anwesenheit fehlt */}
                    {dutyBadge ? (
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-slate-800/60 border border-slate-700/60 text-slate-400">
                          Dienst / Betreuung • kein Lehrstoff erforderlich
                        </span>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2 pt-0.5">
                        {lesson.missingTeachingContent ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/30 flex items-center gap-1">
                            <AlertCircle className="w-3 h-3 text-amber-400" />
                            Lehrstoff fehlt
                          </span>
                        ) : lesson.hasTeachingContent ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            Lehrstoff erfasst
                          </span>
                        ) : null}

                        {lesson.missingAttendance ? (
                          <button
                            onClick={() => setActiveSubTab('absences')}
                            className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 flex items-center gap-1 transition cursor-pointer"
                            title="Anwesenheitsliste für diese Stunde prüfen"
                          >
                            <UserX className="w-3 h-3 text-rose-400" />
                            Anwesenheit fehlt
                          </button>
                        ) : lesson.attendanceChecked ? (
                          <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                            <UserCheck className="w-3 h-3 text-emerald-400" />
                            Anwesenheit erfasst
                          </span>
                        ) : null}
                      </div>
                    )}

                    {/* Lehrstoff Input (only for teaching lessons, not duty slots) */}
                    {!dutyBadge && (
                      <div className="space-y-1.5">
                        <label className="text-[11px] font-semibold text-slate-400 flex items-center justify-between">
                          <span>Lehrstoff (Was wurde gemacht?):</span>
                          {isSaved && (
                            <span className="text-emerald-400 flex items-center gap-1 font-bold text-[10px]">
                              <CheckCircle2 className="w-3 h-3" /> In WebUntis gespeichert
                            </span>
                          )}
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            value={lessonEdits[lesson.id] ?? ''}
                            onChange={(e) =>
                              setLessonEdits((prev) => ({ ...prev, [lesson.id]: e.target.value }))
                            }
                            placeholder="z.B. Grammatik Seite 42, Leseverständnis..."
                            className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                          />
                          <button
                            onClick={() => handleSaveTeachingContent(lesson)}
                            disabled={isSaving || !lessonEdits[lesson.id]?.trim()}
                            className="px-3 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition shrink-0"
                            title="Lehrstoff in WebUntis speichern"
                          >
                            {isSaving ? (
                              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            <span>Speichern</span>
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 2: Abwesenheiten */}
      {activeSubTab === 'absences' && (
        <div className="space-y-4">
          {/* Explanation banner for Attendance Check & WebUntis direct jump */}
          <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-200">
                <Info className="w-4 h-4 text-sky-400 shrink-0" />
                <span>Anwesenheitskontrolle & Absenzen erfassen</span>
              </div>
              <p className="text-xs text-slate-400">
                Die Anwesenheitskontrolle (Abhaken der Stunde) wird im offiziellen WebUntis-Klassenbuch oder in der Untis Mobile App durchgeführt. SMILE überwacht den Status in Echtzeit und signalisiert, falls eine Stunde noch nicht abgehakt wurde.
              </p>
            </div>
            <a
              href={`https://${accountStatus?.account?.server || status?.server || 'arche.webuntis.com'}/WebUntis/?school=${encodeURIComponent(accountStatus?.account?.school || status?.school || 'ms-telfs')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-500/30 text-sky-300 font-bold text-xs flex items-center gap-1.5 transition shrink-0"
              title="WebUntis im neuen Tab öffnen"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>In WebUntis öffnen</span>
            </a>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
              <UserX className="w-4 h-4 text-rose-400" />
              <span>Abwesenheiten am {selectedDate} ({filteredAbsences.length})</span>
            </h2>

            {/* Search */}
            <div className="relative w-64">
              <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                value={absenceSearch}
                onChange={(e) => setAbsenceSearch(e.target.value)}
                placeholder="Schüler / Klasse suchen..."
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
              />
            </div>
          </div>

          {loadingAbsences ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              <span>Abwesenheiten werden geladen...</span>
            </div>
          ) : filteredAbsences.length === 0 ? (
            <div className="py-16 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800/80">
              <UserCheck className="w-10 h-10 mx-auto mb-2 text-emerald-400" />
              <p className="font-semibold text-slate-300">
                {dataError ? 'Abwesenheiten konnten nicht geladen werden.' : 'Keine Abwesenheiten verzeichnet.'}
              </p>
              {!dataError && <p className="text-xs text-slate-500 mt-1">Alle Schüler sind anwesend.</p>}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-800 text-slate-400 bg-slate-950/40">
                    <th className="py-2.5 px-4 font-semibold">Schüler*in</th>
                    <th className="py-2.5 px-4 font-semibold">Klasse</th>
                    <th className="py-2.5 px-4 font-semibold">Zeitraum</th>
                    <th className="py-2.5 px-4 font-semibold">Grund</th>
                    <th className="py-2.5 px-4 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredAbsences.map((absence) => (
                    <tr key={absence.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-4 font-bold text-slate-100">
                        {absence.studentName || `Schüler #${absence.studentId}`}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">
                        {absence.className || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-400 font-mono">
                        {absence.startTime} – {absence.endTime}
                      </td>
                      <td className="py-2.5 px-4 text-slate-300">
                        {absence.reason || absence.text || 'Nicht angegeben'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            absence.excused
                              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}
                        >
                          {absence.excused ? 'Entschuldigt' : 'Unentschuldigt'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SUB-TAB 3: Klassenbuch & Disziplinar */}
      {activeSubTab === 'events' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-400" />
                <span>Klassenbucheinträge & Disziplinar ({filteredEvents.length})</span>
              </h2>
              <p className="text-xs text-slate-400">
                Gelbe Karten, Rote Karten und Time-Outs aus SMILE werden automatisch als Klassenbucheintrag synchronisiert.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Search */}
              <div className="relative w-48 sm:w-64">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                  placeholder="Eintrag suchen..."
                  className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-sky-500"
                />
              </div>

              {/* Action: Neuer Klassenbucheintrag */}
              <button
                onClick={() => setIsNewEventModalOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Neuer Eintrag</span>
              </button>
            </div>
          </div>

          {loadingEvents ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              <span>Klassenbucheinträge werden aus WebUntis geladen...</span>
            </div>
          ) : filteredEvents.length === 0 ? (
            <div className="py-16 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800/80">
              <CheckCircle2 className="w-10 h-10 mx-auto mb-2 text-slate-600" />
              <p className="font-semibold text-slate-300">
                {dataError ? 'Klassenbucheinträge konnten nicht geladen werden.' : 'Keine Vorfälle im Klassenbuch verzeichnet.'}
              </p>
              {!dataError && (
                <p className="text-xs text-slate-500 mt-1">Keine aktuellen Einträge in den letzten 14 Tagen.</p>
              )}
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredEvents.map((event) => {
                const dateStr = String(event.date);
                const formattedDate =
                  dateStr.length === 8
                    ? `${dateStr.slice(6, 8)}.${dateStr.slice(4, 6)}.${dateStr.slice(0, 4)}`
                    : dateStr;

                const isYellow = event.text.includes('[Gelbe Karte]');
                const isRed = event.text.includes('[Rote Karte');
                const isTimeout = event.text.includes('[Time-Out]');

                return (
                  <div
                    key={event.id}
                    className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {isYellow && (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-[11px] font-bold border border-amber-500/30">
                            🟨 Gelbe Karte (SMILE)
                          </span>
                        )}
                        {isRed && (
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 text-[11px] font-bold border border-rose-500/30">
                            🟥 Rote Karte (SMILE)
                          </span>
                        )}
                        {isTimeout && (
                          <span className="px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 text-[11px] font-bold border border-indigo-500/30">
                            ⏱️ Time-Out (SMILE)
                          </span>
                        )}
                        {!isYellow && !isRed && !isTimeout && (
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[11px] font-semibold">
                            {event.categoryName || 'Klassenbuch'}
                          </span>
                        )}

                        <span className="text-xs font-bold text-slate-200">
                          {event.studentName || `Schüler #${event.studentId}`}
                        </span>

                        {event.className && (
                          <span className="text-[11px] text-slate-400 bg-slate-800/60 px-1.5 py-0.2 rounded">
                            {event.className}
                          </span>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 leading-relaxed">{event.text}</p>
                    </div>

                    <div className="text-left sm:text-right shrink-0">
                      <span className="text-xs font-mono text-slate-400 block">{formattedDate}</span>
                      {event.teacherName && (
                        <span className="text-[10px] text-slate-500">{event.teacherName}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* MODAL: WebUntis Personal Account Connect Wizard */}
      <WebUntisConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        accountStatus={accountStatus}
        onSuccess={() => {
          loadAccount();
          refreshData();
        }}
        onDisconnected={() => {
          loadAccount();
          refreshData();
        }}
      />

      {/* MODAL: Neuer Klassenbucheintrag */}
      {isNewEventModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2 text-slate-100 font-bold">
                <ShieldAlert className="w-5 h-5 text-sky-400" />
                <span>Neuer Klassenbucheintrag in WebUntis</span>
              </div>
              <button
                onClick={() => setIsNewEventModalOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            {eventError && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                {eventError}
              </div>
            )}

            <form onSubmit={handleCreateEvent} className="space-y-4">
              {/* Pupil Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Schüler*in:</label>
                <select
                  value={modalPupilId}
                  onChange={(e) => setModalPupilId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value={0}>-- Schüler*in auswählen --</option>
                  {pupils.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.fullName}
                    </option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Kategorie:</label>
                <select
                  value={modalCategoryId}
                  onChange={(e) => setModalCategoryId(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-sky-500"
                >
                  <option value={2}>Verhalten (Disziplinar)</option>
                  <option value={3}>Sonstiges</option>
                </select>
              </div>

              {/* Text */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-slate-400">Beschreibung / Vorfall:</label>
                <textarea
                  rows={4}
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  placeholder="Beschreibung des Vorfalls im Unterricht..."
                  className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-sky-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewEventModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
                >
                  Abbrechen
                </button>
                <button
                  type="submit"
                  disabled={submittingEvent}
                  className="px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow transition"
                >
                  {submittingEvent ? (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                  <span>In WebUntis eintragen</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
