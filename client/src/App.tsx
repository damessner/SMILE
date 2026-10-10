import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
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
  HelpCircle,
  LayoutGrid,
  EyeOff,
  BookOpen,
  KeyRound,
  RotateCcw,
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
  SESSION_EXPIRED_EVENT,
} from './services/api';
import { useLiveSync } from './hooks/useLiveSync';
import { LoginModal } from './components/LoginModal';
import { AdminAccountsModal } from './components/AdminAccountsModal';
import { AdminRestoreModal } from './components/AdminRestoreModal';
import { ForcePasswordChange } from './components/ForcePasswordChange';
import { useToast } from './components/Toast';
import { setActiveRubricConfig } from './lib/rubricConfig';
import { ThemeToggle, useTheme } from './components/ThemeToggle';
import { BeobachtungsGrid } from './components/BeobachtungsGrid';
import { Schulalltag } from './components/Schulalltag';
import { CardDrawer } from './components/CardDrawer';
import { KelPdfModal } from './components/KelPdfModal';
import { PupilManagerModal } from './components/PupilManagerModal';
import { SchoolStatistics } from './components/SchoolStatistics';
import { ConferenceVotingModal } from './components/ConferenceVotingModal';
import { TeacherClassReportModal } from './components/TeacherClassReportModal';
import { AllClassesConferenceExportModal } from './components/AllClassesConferenceExportModal';
import { TimeoutEscalationModal } from './components/TimeoutEscalationModal';
import { OnboardingTour } from './components/OnboardingTour';

export function App() {
  const toast = useToast();
  const { forceDark } = useTheme();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  // Default to 'bewertung'; Schulalltag & Schulstatistik are hidden by default
  const [activeTab, setActiveTab] = useState<'schulalltag' | 'bewertung' | 'statistics'>('bewertung');
  const [showAllModules, setShowAllModules] = useState<boolean>(() => {
    return localStorage.getItem('smile_show_all_modules') === 'true';
  });

  const toggleAllModules = () => {
    setShowAllModules((prev) => {
      const next = !prev;
      localStorage.setItem('smile_show_all_modules', String(next));
      if (!next && (activeTab === 'schulalltag' || activeTab === 'statistics')) {
        setActiveTab('bewertung');
      }
      return next;
    });
  };

  const [ratingPupilId, setRatingPupilId] = useState<number | null>(null);

  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classListError, setClassListError] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [pupils, setPupils] = useState<PupilWithData[]>([]);
  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);
  const [loadingClass, setLoadingClass] = useState(false);

  // Yellow card alerts
  const [yellowAlerts, setYellowAlerts] = useState<any[]>([]);
  const [yellowAlertError, setYellowAlertError] = useState<string | null>(null);

  const refreshYellowCardAlerts = useCallback(async () => {
    setYellowAlertError(null);
    try {
      setYellowAlerts(await getYellowCardAlerts());
    } catch (error) {
      setYellowAlertError(error instanceof Error ? error.message : 'Warnhinweise konnten nicht geladen werden.');
    }
  }, []);

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
  const [allClassesExportOpen, setAllClassesExportOpen] = useState(false);
  const [adminAccountsOpen, setAdminAccountsOpen] = useState(false);
  const [adminRestoreOpen, setAdminRestoreOpen] = useState(false);
  const [timeoutEscalationOpen, setTimeoutEscalationOpen] = useState(false);
  const [pendingTimeoutCount, setPendingTimeoutCount] = useState(0);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  // 1. Check Auth on mount
  //
  // The session lives in an httpOnly cookie, so there is no token in localStorage to
  // read. A single /auth/me call is the liveness probe.
  useEffect(() => {
    getMe()
      .then((user) => {
        setCurrentUser(user);
        if (!user.mustChangePassword) {
          loadClasses(user);
        }
      })
      .catch(() => setCurrentUser(null))
      .finally(() => setLoadingAuth(false));
  }, []);

  const handleSessionExpired = useCallback(() => {
    if (currentUser) toast.error('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    setCurrentUser(null);
    setClasses([]);
    setSelectedClassId(null);
    setPupils([]);
    setCriteria([]);
    setSubmissionDeadline(null);
    setYellowAlerts([]);
    setYellowAlertError(null);
    setLoadingAuth(false);
    setLoadingClass(false);
  }, [currentUser, toast]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [handleSessionExpired]);

  const loadClasses = async (user: User) => {
    try {
      setClassListError(null);
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

      // Alert failures are tracked separately from the class-list request so an
      // unavailable alert endpoint is never presented as an empty alert list.
      void refreshYellowCardAlerts();
    } catch (e) {
      // Do not present a failed class-list load as an empty school. `refreshYellowCardAlerts`
      // already models this explicitly; the class list has to as well.
      console.error(e);
      setClassListError(
        'Die Klassenliste konnte nicht geladen werden. Bitte die Verbindung prüfen und neu laden.',
      );
    }
  };

  // Guards against out-of-order class loads.
  //
  // `loadClassData` is fired from two places that can overlap: the class-change effect,
  // and eleven WebSocket broadcast types that each trigger a full refetch. Without this
  // guard two in-flight loads can resolve in the opposite order to their start order, and
  // the slower one overwrites the pupils/criteria/deadline of the class the user actually
  // selected. The guard is a monotonically increasing generation rather than an
  // AbortController so that a *coalesced* refetch of the class already on screen is still
  // allowed to replace stale local state.
  const classLoadGenerationRef = useRef(0);

  const loadClassData = async (cid: number) => {
    const generation = ++classLoadGenerationRef.current;
    const isCurrent = () => classLoadGenerationRef.current === generation;

    setLoadingClass(true);
    setSubmissionDeadline(null);
    try {
      const [pupilData, rubricData] = await Promise.all([
        getClassPupils(cid),
        getClassRubric(cid),
      ]);
      if (!isCurrent()) return;
      setPupils(pupilData.pupils);
      setCriteria(rubricData.criteria);
      setSubmissionDeadline(
        typeof pupilData.submissionDeadline === 'string' ? pupilData.submissionDeadline : null,
      );
      // The roster also carries the rubric thresholds and item count the server
      // ranked with. Installing them here means every raster computation below
      // agrees with `lib/ranking.ts` instead of with a second, copied constant.
      setActiveRubricConfig(pupilData.rubricConfig);
      // Seed the sync state from the roster so a locked (or non-ratable) class
      // never shows a writable grid during the round trip until the first SYNCED.
      setClassSyncState(cid, {
        isLocked: Boolean(pupilData.isLockedByConference),
        canRate: typeof pupilData.canRate === 'boolean' ? pupilData.canRate : null,
      });
    } catch (e) {
      // A superseded load must not surface an error or clear the visible class.
      if (!isCurrent()) return;
      console.error(e);
    } finally {
      if (isCurrent()) setLoadingClass(false);
    }
  };

  useEffect(() => {
    if (selectedClassId) {
      loadClassData(selectedClassId);
    }
  }, [selectedClassId]);

  // Live Sync Callback
  const handleRatingUpdated = useCallback((data: any) => {
    if (
      data.type === 'CARD_ISSUED' ||
      data.type === 'CARD_REVOKED' ||
      data.type === 'BATCH_ITEMS_UPDATED' ||
      data.type === 'BATCH_DEFAULTS_APPLIED' ||
      data.type === 'PUPIL_RANKING_SUBMITTED' ||
      data.type === 'PUPIL_RANKING_REOPENED' ||
      data.type === 'STATUS_UPDATED' ||
      data.type === 'TIMEOUT_ISSUED' ||
      data.type === 'TIMEOUT_RESOLVED' ||
      data.type === 'FINAL_RANK_CONFIRMED' ||
      data.type === 'FINAL_RANK_REVOKED'
    ) {
      if (selectedClassId) loadClassData(selectedClassId);
      if (data.type === 'CARD_ISSUED' || data.type === 'CARD_REVOKED') {
        void refreshYellowCardAlerts();
      }
      if (data.type === 'TIMEOUT_ISSUED' || data.type === 'TIMEOUT_RESOLVED') {
        window.dispatchEvent(new CustomEvent('smile:timeouts-updated'));
      }
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
            subjectCode: data.subjectCode || 'D',
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
  }, [selectedClassId, refreshYellowCardAlerts]);

  const liveSyncClassIds = useMemo(() => {
    return selectedClassId ? [selectedClassId, 999] : null;
  }, [selectedClassId]);

  const {
    isConnected,
    canRate: liveCanRate,
    connectionError,
    softLocks,
    conflict,
    clearConflict,
    classSyncState,
    classRoundLocks,
    isLockedByConference: liveLockedByConference,
    sendFocus,
    sendBlur,
    sendRating,
    setClassSyncState,
  } = useLiveSync(liveSyncClassIds, currentUser, handleRatingUpdated);

  const isLockedByConference = selectedClassId != null
    ? (classRoundLocks?.get(selectedClassId) ?? false)
    : liveLockedByConference;

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
    setSubmissionDeadline(null);
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

  const getActiveSubjectCode = () => {
    return currentClass?.mySubjects?.[0]?.code || 'D';
  };

  const handleSubmitPupil = async (
    pupilId: number,
    proposedStatus?: string,
    comment?: string,
    subjectCode?: string
  ) => {
    if (!selectedClassId) return;
    const activeSub = subjectCode || getActiveSubjectCode();
    if (!canWriteSubject(activeSub)) {
      toast.error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
      throw new Error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
    }
    await submitEvaluation(pupilId, selectedClassId, activeSub, proposedStatus, undefined, comment);
    await loadClassData(selectedClassId);
  };

  const handleReopenEvaluation = async (pupilId: number, subjectCode?: string) => {
    if (!selectedClassId) return;
    const activeSub = subjectCode || getActiveSubjectCode();
    if (!canWriteSubject(activeSub)) {
      toast.error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
      throw new Error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
    }
    await reopenEvaluation(pupilId, selectedClassId, activeSub);
    await loadClassData(selectedClassId);
    toast.success('Bewertung wieder geöffnet');
  };

  const handleBatchUpdate = async (
    pupilId: number,
    items: Array<{ criterionId: string; itemKey: string; rating: string; version: number }>,
    subjectCode?: string
  ) => {
    if (!selectedClassId) return;
    const activeSub = subjectCode || getActiveSubjectCode();
    if (!canWriteSubject(activeSub)) {
      toast.error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
      throw new Error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
    }
    try {
      await batchUpdateItems(pupilId, selectedClassId, activeSub, items);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'CONFLICT') {
        await loadClassData(selectedClassId);
      }
      throw error;
    }
    await loadClassData(selectedClassId);
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

  /**
   * Credential handover is an administrator capability, not a leadership one. MED and SLC
   * get school-wide read/record rights, but issuing login credentials is reserved for the
   * `admin` role so the audit trail has exactly one accountable group.
   */
  const isAccountAdministrator = currentUser?.role === 'admin';

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
  // `liveCanRate === null` means "no verdict yet" — treat it as read-only, not
  // writable: the server has not confirmed the caller may write this class, and
  // the SYNCED that carries the verdict arrives one round trip after the class
  // switch. Fail closed here, or the teacher gets 423s instead of disabled inputs.
  const canRateCurrentClass = currentClass?.canRate === true && liveCanRate === true;
  const canWriteSubject = (subjectCode?: string) => {
    if (!canRateCurrentClass) return false;
    if (isHeadmaster) return true;
    const requestedSubject = subjectCode || getActiveSubjectCode();
    return currentClass?.mySubjects?.some((subject) => subject.code === requestedSubject) === true;
  };

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
          if (!user.mustChangePassword) {
            loadClasses(user);
          }
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
          <div data-tour="welcome-logo" className="flex items-center gap-2 text-slate-50 font-semibold text-base tracking-tight shrink-0">
            <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
              <GraduationCap className="w-4.5 h-4.5" />
            </div>
            <span className="hidden sm:inline">SMILE</span>
          </div>

          {/* Segmented control or Compact 'Bewertungen' badge with toggle */}
          <div data-tour="nav-tabs" className="flex items-center gap-1.5 shrink-0">
            {showAllModules ? (
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
            ) : (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-800/80 border border-slate-700/60 text-slate-100 font-bold text-xs shadow-sm">
                <ClipboardList className="w-4 h-4 text-amber-400" />
                <span>Bewertungen</span>
              </div>
            )}

            {/* 1-Click Toggle to Show / Hide Schulalltag and Schulstatistik */}
            <button
              onClick={toggleAllModules}
              className={`p-2 rounded-xl transition border text-xs flex items-center gap-1.5 ${
                showAllModules
                  ? 'bg-slate-800 text-amber-400 border-amber-500/40 hover:bg-slate-700'
                  : 'bg-slate-800/70 text-slate-400 hover:text-slate-200 hover:bg-slate-700 border-slate-700/60'
              }`}
              title={
                showAllModules
                  ? 'Module wieder ausblenden (Fokus auf Bewertung)'
                  : 'Weitere Module (Schulalltag & Schulstatistik) einblenden'
              }
              aria-label={showAllModules ? 'Module ausblenden' : 'Module einblenden'}
            >
              {showAllModules ? (
                <>
                  <EyeOff className="w-4 h-4" />
                  <span className="hidden xl:inline text-[11px] font-semibold text-slate-300">Ausblenden</span>
                </>
              ) : (
                <>
                  <LayoutGrid className="w-4 h-4" />
                  <span className="hidden xl:inline text-[11px] font-semibold text-slate-300">Module</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Action Controls & User Profile */}
        <div className="flex items-center gap-2.5">
          {/* Live Status Pill */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-xs">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionError ? 'bg-rose-400' : isConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400 animate-pulse'
              }`}
            />
            <span className="text-[11px] text-slate-400" title={connectionError || undefined}>
              {connectionError ? 'Live Sync gestört' : isConnected ? 'Live Sync' : 'Verbinde...'}
            </span>
          </div>

          {/* Conference Button (For Headmasters MED, SLC, Admin AND Class KVs) */}
          {canAccessConference && (
            <button
              data-tour="conference-button"
              onClick={() => setConferenceModalOpen(true)}
              className="px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-sm transition active:scale-95"
              title="Klassenkonferenz & Notenbeschluss im Vollbildmodus (Schulleitung & Klassenvorstände)"
            >
              <Scale className="w-3.5 h-3.5" />
              <span>Konferenz-Modus</span>
            </button>
          )}

          {/* All Classes PDF Export (Schulleitung SLC/MED + Admin) */}
          {isSchoolLeadership && (
            <button
              onClick={() => setAllClassesExportOpen(true)}
              className="pressable focus-ring min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-800 text-slate-200 hover:text-slate-50 hover:bg-slate-700 font-bold text-xs flex items-center gap-1.5 transition border border-slate-700 shadow-sm"
              title="Gesamtexport aller Klassen (1 Seite pro Klasse) vor und nach der Konferenz als PDF"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden xl:inline">Gesamtexport (PDF)</span>
              <span className="xl:hidden">Alle PDF</span>
            </button>
          )}

          {/* Time-Out Escalation Button (Schulleitung SLC/MED + Admin: Mahnstufen 3, 6, 9...) */}
          {isAccountAdministrator && (
            <button
              onClick={() => setAdminAccountsOpen(true)}
              className="pressable focus-ring min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:text-slate-50 hover:bg-slate-700 font-bold text-xs flex items-center gap-1.5 transition border border-slate-700"
              title="Konten ansehen und einmalige Zugangsdaten übergeben"
            >
              <KeyRound className="w-3.5 h-3.5 text-accent" />
              <span className="hidden lg:inline">Konten</span>
            </button>
          )}

          {isAccountAdministrator && (
            <button
              onClick={() => setAdminRestoreOpen(true)}
              className="pressable focus-ring min-h-[44px] px-3 py-2 rounded-lg bg-slate-800 text-slate-200 hover:text-rose-400 hover:bg-slate-700 font-bold text-xs flex items-center gap-1.5 transition border border-slate-700"
              title="System-Wiederherstellung (Backup einspielen)"
            >
              <RotateCcw className="w-3.5 h-3.5 text-rose-400" />
              <span className="hidden lg:inline">Wiederherstellen</span>
            </button>
          )}

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

          {/* Light / dark theme */}
          <ThemeToggle />

          {/* Help & Onboarding Tour Button */}
          <button
            data-tour="help-button"
            onClick={() => setOnboardingOpen(true)}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-amber-400 hover:bg-slate-700 transition border border-slate-700/60"
            title="Einführung & Hilfe (Tour) öffnen"
            aria-label="Einführung und Tour"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

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

      {/* Dedicated Class Navigation Sub-Header for Bewertung */}
      {activeTab === 'bewertung' && classes.length > 0 && (
        <nav
          aria-label="Klassenauswahl"
          data-tour="rating-classes"
          className="bg-slate-900/95 backdrop-blur-md border-b border-slate-800 sticky top-[53px] md:top-[61px] z-30 px-4 md:px-6 py-2.5 flex items-center justify-between gap-3 shadow-xs"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1 overflow-x-auto py-0.5 no-scrollbar">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider shrink-0 mr-1 hidden sm:inline">
              Klassen:
            </span>
            {classes.map((cls) => {
              const isSelected = selectedClassId === cls.id;
              const subs = cls.mySubjects || [];
              return (
                <button
                  key={cls.id}
                  onClick={() => setSelectedClassId(cls.id)}
                  aria-current={isSelected ? 'true' : undefined}
                  className={`min-h-[40px] px-3.5 py-1.5 rounded-xl font-bold text-xs transition flex items-center gap-2 shrink-0 ${
                    isSelected
                      ? 'bg-amber-500 text-slate-950 font-bold shadow-md ring-2 ring-amber-400/50'
                      : 'bg-slate-800/80 hover:bg-slate-700 text-slate-200 border border-slate-700/60'
                  }`}
                >
                  <span className="font-bold text-sm tracking-tight">{cls.name}</span>
                  {subs.length > 0 ? (
                    <div className="flex items-center gap-1">
                      {subs.map((s) => (
                        <span
                          key={s.code}
                          title={s.name}
                          className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold tracking-wide transition ${
                            isSelected
                              ? 'bg-slate-950/20 text-slate-950'
                              : s.isCoreSmile
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                              : 'bg-sky-500/20 text-sky-300 border border-sky-500/30'
                          }`}
                        >
                          {s.code}
                        </span>
                      ))}
                    </div>
                  ) : cls.isKv ? (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded-md font-bold ${
                        isSelected ? 'bg-slate-950/20 text-slate-950' : 'bg-purple-500/20 text-purple-300'
                      }`}
                    >
                      KV
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          {currentClass && (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-slate-400 font-medium">
                {pupils.length} Schüler*innen
              </span>
            </div>
          )}
        </nav>
      )}

      {/* Alert Load Error Banner */}
      {yellowAlertError && (
        <div
          role="alert"
          className="bg-rose-500/15 border-b border-rose-500/30 px-6 py-2 text-xs text-rose-200 flex items-center justify-between gap-3"
        >
          <span>Gelbe-Karten-Alarm konnte nicht geladen werden: {yellowAlertError}</span>
          <button
            type="button"
            onClick={() => void refreshYellowCardAlerts()}
            className="underline underline-offset-2 font-bold shrink-0"
          >
            Erneut versuchen
          </button>
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
              criteria={criteria}
            />
          ) : classListError ? (
            // A failed class-list load must never be rendered as an empty school: that
            // reads as "you have no classes" and sends the teacher looking for a
            // permissions problem that does not exist.
            <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="font-bold">Klassenliste nicht verfügbar.</p>
              <p className="text-sm text-center max-w-md">{classListError}</p>
              <button
                type="button"
                onClick={() => currentUser && void loadClasses(currentUser)}
                className="mt-2 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
              >
                Erneut laden
              </button>
            </div>
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
            canRate={canRateCurrentClass}
            canAccessRaster={currentClass?.canAccessRaster}
            submissionDeadline={submissionDeadline}
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
          onOpenAllClassesExport={() => setAllClassesExportOpen(true)}
          onVotesUpdated={() => {
            if (selectedClassId) loadClassData(selectedClassId);
          }}
        />
      )}

      {allClassesExportOpen && currentUser && (
        <AllClassesConferenceExportModal
          classes={classes}
          currentUser={currentUser}
          onClose={() => setAllClassesExportOpen(false)}
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

      {adminAccountsOpen && isAccountAdministrator && (
        <AdminAccountsModal onClose={() => setAdminAccountsOpen(false)} />
      )}

      {adminRestoreOpen && isAccountAdministrator && (
        <AdminRestoreModal onClose={() => setAdminRestoreOpen(false)} />
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
          subjects={currentClass.mySubjects}
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

      {/* Interactive Spotlight Onboarding Tour */}
      <OnboardingTour
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    </div>
  );
}
