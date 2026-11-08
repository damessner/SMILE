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
  GraduationCap,
  Sparkles,
  Server,
  Layers,
  ChevronLeft,
  ChevronRight,
  FileEdit,
} from 'lucide-react';
import type { SchoolClass, User, PupilWithData } from '../../types';
import {
  getWebUntisStatus,
  getWebUntisAccount,
  type WebUntisAccountStatus,
  setWebUntisEnvironment,
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

export function WebUntisView({ currentClass, classes, currentUser, pupils }: WebUntisViewProps) {
  const [activeSubTab, setActiveSubTab] = useState<SubTab>('timetable');
  const [selectedClassId, setSelectedClassId] = useState<number | 'all'>(currentClass?.id ?? 'all');
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));

  // Status & Environment
  const [status, setStatus] = useState<WebUntisStatus | null>(null);
  const [loadingStatus, setLoadingStatus] = useState<boolean>(true);
  const [switchingEnv, setSwitchingEnv] = useState<boolean>(false);

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

  // Switch between Production and Playground
  const handleToggleEnvironment = async () => {
    if (!status) return;
    const nextEnv = status.environment === 'production' ? 'playground' : 'production';
    try {
      setSwitchingEnv(true);
      const updated = await setWebUntisEnvironment(nextEnv);
      setStatus(updated);
      refreshData();
    } catch {
      // Keep old status on error
    } finally {
      setSwitchingEnv(false);
    }
  };

  // Load Timetable
  const loadLessons = async () => {
    try {
      setLoadingLessons(true);
      const classIdParam = selectedClassId === 'all' ? undefined : selectedClassId;
      const res = await getWebUntisTimetable(selectedDate, classIdParam);
      setLessons(res.lessons || []);

      // Prepopulate lesson edits from existing Lehrstoff
      const initialEdits: Record<number, string> = {};
      for (const l of res.lessons || []) {
        if (l.lessonText) {
          initialEdits[l.id] = l.lessonText;
        }
      }
      setLessonEdits((prev) => ({ ...initialEdits, ...prev }));
    } catch {
      setLessons([]);
    } finally {
      setLoadingLessons(false);
    }
  };

  // Save Teaching Content (Lehrstoff)
  const handleSaveTeachingContent = async (lessonId: number) => {
    const text = lessonEdits[lessonId]?.trim();
    if (!text) return;
    try {
      setSavingLessonId(lessonId);
      await saveWebUntisTeachingContent(lessonId, text);
      setSavedLessonIds((prev) => ({ ...prev, [lessonId]: true }));
      setTimeout(() => {
        setSavedLessonIds((prev) => ({ ...prev, [lessonId]: false }));
      }, 3000);
    } catch {
      // Error handling
    } finally {
      setSavingLessonId(null);
    }
  };

  // Load Absences
  const loadAbsences = async () => {
    try {
      setLoadingAbsences(true);
      const classIdParam = selectedClassId === 'all' ? undefined : selectedClassId;
      const res = await getWebUntisAbsences(selectedDate, classIdParam);
      setAbsences(res.absences || []);
    } catch {
      setAbsences([]);
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
  }, [selectedDate, selectedClassId]);

  // Date shifting
  const handleShiftDate = (days: number) => {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + days);
    setSelectedDate(d.toISOString().slice(0, 10));
  };

  const isToday = selectedDate === new Date().toISOString().slice(0, 10);

  // Missing counts
  const missingLehrstoffCount = useMemo(
    () => lessons.filter((l) => l.missingTeachingContent).length,
    [lessons]
  );
  const missingAttendanceCount = useMemo(
    () => lessons.filter((l) => l.missingAttendance).length,
    [lessons]
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
            <div className="w-12 h-12 rounded-xl bg-gradient-to-tr from-sky-500/20 to-indigo-500/20 border border-sky-500/30 flex items-center justify-center text-sky-400">
              <BookOpen className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-slate-100">WebUntis-Integration</h1>
                {status && (
                  <span
                    className={`px-2.5 py-0.5 rounded-full text-xs font-semibold flex items-center gap-1.5 ${
                      status.connected
                        ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                        : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${status.connected ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400'}`} />
                    {status.connected ? (status.environment === 'playground' ? 'Spielwiese' : 'MS-Telfs Live') : 'Getrennt'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400">
                Stundenplan, Lehrstoff eintragen, Abwesenheiten & automatische Klassenbucheinträge (Gelb / Rot / Time-Out).
              </p>
            </div>
          </div>

          {/* Top Actions: Personal Account Wizard, Environment Switcher & Refresh */}
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
              onClick={handleToggleEnvironment}
              disabled={switchingEnv || loadingStatus}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition flex items-center gap-2 ${
                status?.environment === 'playground'
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Wechseln zwischen Spielwiese (Playground) und Live-Server"
            >
              <Server className="w-3.5 h-3.5 text-sky-400" />
              <span>{status?.environment === 'playground' ? 'Modus: Spielwiese' : 'Modus: Live (MS-Telfs)'}</span>
              {switchingEnv && <RefreshCw className="w-3 h-3 animate-spin" />}
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

        {/* Filter Bar: Class Selector & Date Navigation */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-400">Klasse:</span>
            <select
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value === 'all' ? 'all' : Number(e.target.value))}
              className="px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700 text-xs font-bold text-slate-100 focus:outline-none focus:border-sky-500"
            >
              <option value="all">Alle Klassen ({classes.length})</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date Picker Bar */}
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
                onClick={() => setSelectedDate(new Date().toISOString().slice(0, 10))}
                className="ml-1 px-2 py-0.5 rounded-md bg-sky-500/20 text-sky-300 text-[11px] font-bold hover:bg-sky-500/30 transition"
              >
                Heute
              </button>
            )}
          </div>
        </div>
      </div>

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
                Verbinden Sie Ihren persönlichen WebUntis-Account, um Ihre Stunden, fehlenden Lehrstoff und offene Anwesenheiten direkt zu sehen.
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
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
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
          {lessons.length > 0 && (
            <span
              className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                activeSubTab === 'timetable' ? 'bg-slate-950 text-sky-400' : 'bg-slate-800 text-slate-400'
              }`}
            >
              {lessons.length}
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

      {/* SUB-TAB 1: Stundenplan & Lehrstoff */}
      {activeSubTab === 'timetable' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                <FileEdit className="w-4 h-4 text-sky-400" />
                <span>Unterrichtsstunden & Lehrstoff ({lessons.length})</span>
              </h2>
              <span className="text-xs text-slate-400">
                Tragen Sie hier direkt ein, was in der Stunde erarbeitet wurde.
              </span>
            </div>

            {/* Timetable status chips */}
            <div className="flex flex-wrap items-center gap-2">
              {missingLehrstoffCount > 0 ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-400" />
                  {missingLehrstoffCount}x Lehrstoff fehlt
                </span>
              ) : lessons.length > 0 ? (
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
              ) : lessons.length > 0 ? (
                <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                  <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
                  Anwesenheiten geprüft
                </span>
              ) : null}
            </div>
          </div>

          {loadingLessons ? (
            <div className="py-16 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
              <RefreshCw className="w-6 h-6 animate-spin text-sky-400" />
              <span>Stundenplan wird aus WebUntis geladen...</span>
            </div>
          ) : lessons.length === 0 ? (
            <div className="py-16 text-center text-slate-500 bg-slate-900/50 rounded-2xl border border-slate-800/80">
              <Calendar className="w-10 h-10 mx-auto mb-2 text-slate-600" />
              <p className="font-semibold text-slate-300">Keine Stunden für dieses Datum gefunden.</p>
              <p className="text-xs text-slate-500 mt-1">
                Wählen Sie einen Schultag oder eine andere Klasse aus.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {lessons.map((lesson) => {
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
                    className="p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2.5 py-1 rounded-lg bg-sky-500/10 text-sky-400 font-bold text-xs border border-sky-500/20">
                          {subject}
                        </span>
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

                    {/* Lehrstoff Input */}
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
                          onClick={() => handleSaveTeachingContent(lesson.id)}
                          disabled={isSaving || !(lessonEdits[lesson.id]?.trim())}
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
              <p className="font-semibold text-slate-300">Keine Abwesenheiten verzeichnet.</p>
              <p className="text-xs text-slate-500 mt-1">Alle Schüler sind anwesend.</p>
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
              <p className="font-semibold text-slate-300">Keine Vorfälle im Klassenbuch verzeichnet.</p>
              <p className="text-xs text-slate-500 mt-1">Keine aktuellen Einträge in den letzten 14 Tagen.</p>
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
