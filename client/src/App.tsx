import React, { useEffect, useState, useCallback } from 'react';
import {
  GraduationCap,
  Users,
  Download,
  AlertTriangle,
  LogOut,
  RefreshCw,
  BarChart3,
  ClipboardList,
  Scale,
  Calendar,
  FileText,
  Printer,
  Clock,
} from 'lucide-react';
import { User, SchoolClass, PupilWithData, RubricCriterion } from './types';
import {
  getMe,
  getClasses,
  getClassPupils,
  getClassRubric,
  getYellowCardAlerts,
  submitEvaluation,
  reopenEvaluation,
  batchUpdateItems,
  getCurrentTimetable,
  getTimeoutEscalations,
  logout,
  exportBackup,
} from './services/api';
import { useLiveSync } from './hooks/useLiveSync';
import { LoginModal } from './components/LoginModal';
import { ForcePasswordChange } from './components/ForcePasswordChange';
import { useToast } from './components/Toast';
import { ThemeToggle, useTheme } from './components/ThemeToggle';
import { BeobachtungsGrid } from './components/BeobachtungsGrid';
import { Schulalltag } from './components/Schulalltag';
import { CardDrawer } from './components/CardDrawer';
import { KelPdfModal } from './components/KelPdfModal';
import { PupilManagerModal } from './components/PupilManagerModal';
import { SchoolStatistics } from './components/SchoolStatistics';
import { ConferenceVotingModal } from './components/ConferenceVotingModal';
import { TeacherClassReportModal } from './components/TeacherClassReportModal';
import { TimeoutEscalationModal } from './components/TimeoutEscalationModal';

export function App() {
  const toast = useToast();
  const { forceDark } = useTheme();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState<'schulalltag' | 'bewertung' | 'statistics'>('schulalltag');
  const [ratingPupilId, setRatingPupilId] = useState<number | null>(null);

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [pupils, setPupils] = useState<PupilWithData[]>([]);
  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [loadingClass, setLoadingClass] = useState(false);

  // Yellow card alerts
  const [yellowAlerts, setYellowAlerts] = useState<any[]>([]);

  // Modals
  const [activeCardDrawer, setActiveCardDrawer] = useState<{ pupilId: number; name: string } | null>(null);
  const [activeKelPupil, setActiveKelPupil] = useState<PupilWithData | null>(null);
  const [pupilManagerOpen, setPupilManagerOpen] = useState(false);
  const [conferenceModalOpen, setConferenceModalOpen] = useState(false);

  /*
    The conference view is projected in a darkened room, where washed-out colours
    are harder to read rather than easier. Force it dark regardless of the user's
    light/dark preference, and restore their theme on exit.
  */
  useEffect(() => {
    forceDark(conferenceModalOpen);
    return () => forceDark(false);
  }, [conferenceModalOpen, forceDark]);
  const [teacherReportModalOpen, setTeacherReportModalOpen] = useState(false);
  const [timeoutEscalationOpen, setTimeoutEscalationOpen] = useState(false);
  const [pendingTimeoutCount, setPendingTimeoutCount] = useState(0);

  // 1. Check Auth on mount
  //
  // The session lives in an httpOnly cookie, so there is no token in localStorage to
  // read. A single /auth/me call is the liveness probe.
  useEffect(() => {
    getMe()
      .then((user) => {
        setCurrentUser(user);
        if (!user.mustChangePassword) loadClasses(user);
      })
      .catch(() => setCurrentUser(null))
      .finally(() => setLoadingAuth(false));
  }, []);

  const loadClasses = async (user: User) => {
    try {
      const cls = await getClasses();
      const validClasses = cls.filter((c: any) => c.name !== 'LW' && (c.grade === undefined || c.grade > 0));
      setClasses(validClasses);

      let targetClassId = validClasses[0]?.id || null;

      // Auto-detect class based on current timetable
      try {
        const tt = await getCurrentTimetable();
        const currentClassName = tt.currentLesson?.className || tt.currentLesson?.class_name;
        const nextClassName = tt.nextLesson?.className || tt.nextLesson?.class_name;

        if (currentClassName && currentClassName !== 'LW') {
          const matched = validClasses.find((c: any) => c.name === currentClassName);
          if (matched) targetClassId = matched.id;
        } else if (nextClassName && nextClassName !== 'LW') {
          const matched = validClasses.find((c: any) => c.name === nextClassName);
          if (matched) targetClassId = matched.id;
        } else {
          const coreClass = validClasses.find((c: any) => c.canAccessRaster);
          if (coreClass) targetClassId = coreClass.id;
        }
      } catch (ttErr) {
        console.error('Timetable auto-detect error:', ttErr);
      }

      if (validClasses.length > 0 && targetClassId) {
        setSelectedClassId(targetClassId);
      }

      // Check yellow card alerts
      const alerts = await getYellowCardAlerts();
      setYellowAlerts(alerts);
    } catch (e) {
      console.error(e);
    }
  };

  const loadClassData = async (cid: number) => {
    setLoadingClass(true);
    try {
      const [pupilData, rubricData] = await Promise.all([
        getClassPupils(cid),
        getClassRubric(cid),
      ]);
      setPupils(pupilData.pupils);
      setCriteria(rubricData.criteria);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingClass(false);
    }
  };

  useEffect(() => {
    if (selectedClassId) {
      loadClassData(selectedClassId);
    }
  }, [selectedClassId]);

  // Live Sync Callback
  const handleRatingUpdated = useCallback((data: any) => {
    if (data.type === 'CARD_ISSUED' || data.type === 'CARD_REVOKED') {
      if (selectedClassId) loadClassData(selectedClassId);
      return;
    }

    setPupils((prevPupils) => {
      return prevPupils.map((p) => {
        if (p.id !== data.pupilId) return p;

        // update evaluation item
        const updatedEvals = [...p.evaluations];
        let targetEval = updatedEvals.find((e) => e.id === data.evaluationId);
        if (!targetEval) {
          targetEval = {
            id: data.evaluationId,
            roundId: '',
            pupilId: data.pupilId,
            classId: selectedClassId || 0,
            subjectCode: 'SD',
            teacherId: 0,
            items: [],
          };
          updatedEvals.push(targetEval);
        }

        const updatedItems = [...(targetEval.items || [])];
        const existingIdx = updatedItems.findIndex((it) => it.itemKey === data.itemKey);
        const newItem = {
          id: data.itemId || Math.random().toString(),
          evaluationId: data.evaluationId,
          criterionId: '',
          itemKey: data.itemKey,
          rating: data.rating,
          version: data.version,
          updatedAt: data.updatedAt,
        };

        if (existingIdx >= 0) {
          updatedItems[existingIdx] = newItem as any;
        } else {
          updatedItems.push(newItem as any);
        }
        targetEval.items = updatedItems;

        return { ...p, evaluations: updatedEvals };
      });
    });
  }, [selectedClassId]);

  const {
    isConnected,
    softLocks,
    conflict,
    clearConflict,
    isLockedByConference,
    sendFocus,
    sendBlur,
    sendRating,
  } = useLiveSync(selectedClassId, currentUser, handleRatingUpdated);

  const handleLogout = async () => {
    try {
      await logout();
    } catch {
      // Even if the server call fails, drop local state so the UI locks.
    }
    setCurrentUser(null);
    setClasses([]);
    setPupils([]);
    setCriteria([]);
    setYellowAlerts([]);
    setSelectedClassId(null);
  };

  const handleDownloadBackup = async () => {
    try {
      const bundle = await exportBackup();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `smile-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e.message || 'Backup konnte nicht erstellt werden');
    }
  };

  /** Called by the forced-change-password form once the user sets a new password. */
  const handlePasswordChanged = (user: User) => {
    setCurrentUser(user);
    loadClasses(user);
  };

  const handleSubmitPupil = async (pupilId: number) => {
    if (!selectedClassId) return;
    try {
      await submitEvaluation(pupilId, selectedClassId, 'SD');
      await loadClassData(selectedClassId);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Einreichen');
    }
  };

  const handleReopenEvaluation = async (pupilId: number) => {
    if (!selectedClassId) return;
    try {
      await reopenEvaluation(pupilId, selectedClassId, 'SD');
      await loadClassData(selectedClassId);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Öffnen');
    }
  };

  const handleBatchUpdate = async (
    pupilId: number,
    items: Array<{ criterionId: string; itemKey: string; rating: string }>
  ) => {
    if (!selectedClassId) return;
    try {
      await batchUpdateItems(pupilId, selectedClassId, 'SD', items);
      await loadClassData(selectedClassId);
    } catch (e: any) {
      toast.error(e.message || 'Fehler beim Speichern');
    }
  };

  // Conference authorization check:
  // Headmasters (MED, SLC, admin) AND Klassenvorstände (KVs) of the classes
  const teacherShort = currentUser?.teacher?.shortName?.toUpperCase();

  /**
   * School leadership = Schulleitung (SLC, MED) plus the system administrator.
   *
   * This is the gate for the conference mode and the escalation dashboard. It was
   * previously spelled twice and inconsistently: `isHeadmaster` covered MED, while
   * `isSlcOrAdmin` checked only SLC, so MED silently lost the escalation badge.
   * Both now derive from this single definition.
   */
  const isSchoolLeadership =
    currentUser?.role === 'admin' ||
    teacherShort === 'MED' ||
    teacherShort === 'SLC' ||
    currentUser?.username?.toUpperCase() === 'MED' ||
    currentUser?.username?.toUpperCase() === 'SLC';

  const isHeadmaster = isSchoolLeadership;

  const isAnyKv = classes.some((cls) => {
    const kv1 = (cls.headTeacher1 || '').toUpperCase();
    const kv2 = (cls.headTeacher2 || '').toUpperCase();
    return (
      (teacherShort &&
        (kv1.includes(`(${teacherShort})`) ||
          kv1.includes(teacherShort) ||
          kv2.includes(`(${teacherShort})`) ||
          kv2.includes(teacherShort))) ||
      (currentUser?.username &&
        (kv1.includes(currentUser.username.toUpperCase()) ||
          kv2.includes(currentUser.username.toUpperCase())))
    );
  });
  void isAnyKv; // retained for the pupil-management gate, not for conference access

  // Load pending timeout escalations for the school leadership
  useEffect(() => {
    if (currentUser && isSchoolLeadership) {
      getTimeoutEscalations()
        .then((res) => setPendingTimeoutCount(res.totalPendingCount || 0))
        .catch(() => {});
    }
  }, [currentUser, isSchoolLeadership]);

  /*
    Conference mode: Schulleitung only.

    The button was previously shown to homeroom heads as well (`isHeadmaster || isAnyKv`).
    Hiding the button is not the same as removing the permission — the server enforced
    KV access too, so a KV could still have called the endpoints directly. Both are now
    restricted to SLC, MED and the administrator.
  */
  const canAccessConference = isSchoolLeadership;
  const currentClass = classes.find((c) => c.id === selectedClassId) || classes[0] || null;

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
        <RefreshCw className="w-8 h-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (!currentUser) {
    return (
      <LoginModal
        onSuccess={(user) => {
          setCurrentUser(user);
          if (!user.mustChangePassword) loadClasses(user);
        }}
      />
    );
  }

  // A freshly seeded account is on the shared bootstrap password. Until it is
  // changed, the server rejects every mutating endpoint, so block the whole UI here
  // rather than letting the user trigger a wall of 403s.
  if (currentUser.mustChangePassword) {
    return (
      <ForcePasswordChange
        user={currentUser}
        onChanged={handlePasswordChanged}
        onLogout={handleLogout}
      />
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-surface-0 text-slate-200">
      {/*
        Top bar. `material-bar` gives the iOS translucent-material look;
        `safe-top` insets it below the status bar when installed to the Home
        Screen with viewport-fit=cover.
      */}
      <header className="material-bar sticky top-0 z-40 safe-top px-4 md:px-6 py-2.5 md:py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div className="flex items-center gap-2 text-slate-50 font-semibold text-base tracking-tight shrink-0">
            <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
              <GraduationCap className="w-4.5 h-4.5" />
            </div>
            <span className="hidden sm:inline">SMILE</span>
          </div>

          {/* Segmented control, iOS style: one inset container, selected segment lifts. */}
          <div className="flex items-center p-1 rounded-lg bg-slate-800/60 border border-hairline shrink-0">
            {(
              [
                ['schulalltag', 'Schulalltag', Calendar],
                ['bewertung', 'Bewertung', ClipboardList],
                ['statistics', 'Schulstatistik', BarChart3],
              ] as const
            ).map(([key, label, Icon]) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                aria-current={activeTab === key}
                className={`pressable focus-ring min-h-[40px] px-3 md:px-3.5 py-1.5 rounded-md text-xs font-semibold
                  flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    activeTab === key
                      ? 'bg-accent text-slate-950 font-bold shadow-sm'
                      : 'text-slate-400 hover:text-slate-100'
                  }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden md:inline">{label}</span>
                <span className="md:hidden">{label.split(' ')[0]}</span>
              </button>
            ))}
          </div>

          {/*
            Class selector for the evaluation tab.

            Previously `hidden lg:flex`, which removed class switching entirely on
            an iPad in portrait (768px) — the main tablet orientation for a teacher
            holding it to mark work. Now a horizontally scrollable strip on small
            screens, with 44px targets.
          */}
          {activeTab === 'bewertung' && (
            <div className="flex lg:max-w-xl items-center gap-1.5 overflow-x-auto py-1
                            -mx-1 px-1 max-w-full">
              {classes.map((cls) => {
                const coreSubject = cls.mySubjects?.find((s) => s.isCoreSmile);
                return (
                  <button
                    key={cls.id}
                    onClick={() => {
                      setSelectedClassId(cls.id);
                    }}
                    className={`min-h-[44px] px-3 py-2 rounded-xl font-bold text-xs transition flex items-center gap-1.5 flex-shrink-0 ${
                      selectedClassId === cls.id
                        ? 'bg-amber-500 text-slate-950 shadow-md shadow-sm font-bold'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <span>{cls.name}</span>
                    {coreSubject && (
                      <span
                        className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                          selectedClassId === cls.id
                            ? 'bg-slate-950/25 text-slate-950'
                            : 'bg-amber-500/20 text-amber-400'
                        }`}
                      >
                        {coreSubject.code}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Action Controls & User Profile */}
        <div className="flex items-center gap-2.5">
          {/* Live Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'
              }`}
            />
            <span className="text-[11px] text-slate-400">
              {isConnected ? 'Live Sync' : 'Verbinde...'}
            </span>
          </div>

          {/* Conference Button (For Headmasters MED, SLC, Admin AND Class KVs) */}
          {canAccessConference && (
            <button
              onClick={() => setConferenceModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-sm transition active:scale-95"
              title="Klassenkonferenz & Notenbeschluss im Vollbildmodus (Schulleitung & Klassenvorstände)"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Konferenz-Modus</span>
            </button>
          )}

          {/* Time-Out Escalation Button (Schulleitung SLC/MED + Admin: Mahnstufen 3, 6, 9...) */}
          {isSchoolLeadership && (
            <button
              onClick={() => setTimeoutEscalationOpen(true)}
              className="pressable focus-ring min-h-[44px] px-3.5 py-2 rounded-lg bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-slate-50 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-sm transition"
              title="Time-Out Eskalationen & Elternvereinbarungen (Mahnstufen 3, 6, 9...)"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Time-Out</span>
              {pendingTimeoutCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-white text-rose-600 text-[10px] font-bold flex items-center justify-center animate-pulse">
                  {pendingTimeoutCount}
                </span>
              )}
            </button>
          )}

          {/* 1-Page Class Export Report Button (In Bewertung mode) */}
          {activeTab === 'bewertung' && currentClass && (
            <button
              onClick={() => setTeacherReportModalOpen(true)}
              className="pressable focus-ring min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:text-slate-50 hover:bg-slate-700 font-bold text-xs flex items-center gap-1.5 transition border border-slate-700"
              title="1-Seiten Klassenbericht für Lehrpersonen drucken"
            >
              <Printer className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden lg:inline">1-Seiten Export</span>
              <span className="lg:hidden">Export</span>
            </button>
          )}

          {/* Light / dark theme */}
          <ThemeToggle />

          {/* Pupil Manager Button */}
          {currentClass && (
            <button
              onClick={() => setPupilManagerOpen(true)}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-slate-50 hover:bg-slate-700 transition border border-slate-700/60"
              title="Schülerverwaltung"
            >
              <Users className="w-4 h-4" />
            </button>
          )}

          {/* Backup Button */}
          {(currentUser.role === 'admin' || currentUser.role === 'head_teacher') && (
            <button
              onClick={handleDownloadBackup}
              className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-amber-400 hover:bg-slate-700 transition border border-slate-700/60"
              title="1-Klick Backup herunterladen"
            >
              <Download className="w-4 h-4" />
            </button>
          )}

          {/* User Badge */}
          <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
            <div className="text-right hidden sm:block">
              <span className="text-xs font-bold text-slate-50 block leading-tight">
                {currentUser.teacher?.fullName || currentUser.username}
              </span>
              <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                {currentUser.teacher?.shortName ? `${currentUser.teacher.shortName} · ` : ''}{isHeadmaster ? 'Schulleitung' : currentUser.role}
              </span>
            </div>
            <button
              onClick={handleLogout}
              title="Abmelden"
              className="p-2 rounded-xl text-slate-400 hover:text-red-400 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Homeroom Yellow Card Alert Banner */}
      {yellowAlerts.length > 0 && (
        <div className="bg-amber-500/15 border-b border-amber-500/30 px-6 py-2 text-xs text-amber-300 flex items-center justify-between">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span>
              Mahnstufen-Alarm (Klassenvorstand):{' '}
              {yellowAlerts.map((a) => `${a.pupil_name} (${a.class_name}: ${a.yellow_count} Gelbe Karten)`).join(' · ')}
            </span>
          </div>
        </div>
      )}

      {/* Conference Locked Banner */}
      {isLockedByConference && (
        <div className="bg-red-500/20 border-b border-red-500/40 px-6 py-2 text-xs text-red-300 text-center font-bold">
          🔒 Die Notenabstimmung für diese Klasse ist durch die Konferenzleitung gesperrt. Änderungen sind deaktiviert.
        </div>
      )}

      {/* Main Body */}
      {/* safe-bottom keeps content clear of the home indicator in a Home Screen app. */}
      <main className="flex-1 px-4 md:px-6 py-4 md:py-6 max-w-[1600px] w-full mx-auto safe-bottom">
        {activeTab === 'statistics' ? (
          <SchoolStatistics initialClassId={selectedClassId} />
        ) : loadingClass && pupils.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-500">
            <RefreshCw className="w-6 h-6 animate-spin text-amber-400 mr-2" />
            <span>Lade Schülerdaten...</span>
          </div>
        ) : activeTab === 'schulalltag' ? (
          currentClass ? (
            <Schulalltag
              currentClass={currentClass}
              classes={classes}
              pupils={pupils}
              currentUser={currentUser}
              onSelectClass={(cid) => setSelectedClassId(cid)}
              onRefreshClassData={() => {
                if (selectedClassId) loadClassData(selectedClassId);
              }}
            />
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
              <AlertTriangle className="w-8 h-8 text-amber-400" />
              <p className="font-bold">Keine Klassen zugewiesen oder verfügbar.</p>
            </div>
          )
        ) : currentClass ? (
          <BeobachtungsGrid
            pupils={pupils}
            criteria={criteria}
            softLocks={softLocks}
            conflict={conflict}
            onClearConflict={clearConflict}
            onSendFocus={sendFocus}
            onSendBlur={sendBlur}
            onRate={sendRating}
            onOpenCardDrawer={(pupilId, name) => setActiveCardDrawer({ pupilId, name })}
            onOpenKelReport={(pupil) => setActiveKelPupil(pupil)}
            isLockedByConference={isLockedByConference}
            canAccessRaster={currentClass?.canAccessRaster}
            mySubjects={currentClass?.mySubjects}
            selectedPupilIdProp={ratingPupilId}
            onSubmitPupil={handleSubmitPupil}
            onReopenPupil={handleReopenEvaluation}
            onBatchUpdate={handleBatchUpdate}
            onOpenReportModal={() => setTeacherReportModalOpen(true)}
          />
        ) : null}
      </main>

      {/* Modals */}
      {conferenceModalOpen && classes.length > 0 && (
        <ConferenceVotingModal
          classes={classes}
          initialClassId={selectedClassId || classes[0].id}
          currentUser={currentUser}
          onClose={() => setConferenceModalOpen(false)}
          onVotesUpdated={() => {
            if (selectedClassId) loadClassData(selectedClassId);
          }}
        />
      )}

      {teacherReportModalOpen && currentClass && currentUser && (
        <TeacherClassReportModal
          currentClass={currentClass}
          pupils={pupils}
          criteria={criteria}
          currentUser={currentUser}
          onClose={() => setTeacherReportModalOpen(false)}
        />
      )}

      {activeCardDrawer && selectedClassId && (
        <CardDrawer
          pupilId={activeCardDrawer.pupilId}
          pupilName={activeCardDrawer.name}
          classId={selectedClassId}
          onCardUpdated={() => loadClassData(selectedClassId)}
          onClose={() => setActiveCardDrawer(null)}
        />
      )}

      {activeKelPupil && currentClass && (
        <KelPdfModal
          pupil={activeKelPupil}
          className={currentClass.name}
          criteria={criteria}
          onClose={() => setActiveKelPupil(null)}
        />
      )}

      {pupilManagerOpen && currentClass && (
        <PupilManagerModal
          currentClass={currentClass}
          classes={classes}
          pupils={pupils}
          onPupilsChanged={() => loadClassData(currentClass.id)}
          onClose={() => setPupilManagerOpen(false)}
        />
      )}

      {timeoutEscalationOpen && (
        <TimeoutEscalationModal
          onClose={() => {
            setTimeoutEscalationOpen(false);
            if (selectedClassId) loadClassData(selectedClassId);
          }}
          onUpdated={() => {
            getTimeoutEscalations()
              .then((res) => setPendingTimeoutCount(res.totalPendingCount || 0))
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
