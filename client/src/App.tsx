import React, { useEffect, useRef } from 'react';
import { RefreshCw } from 'lucide-react';
import type { ClassSyncState } from './hooks/useLiveSync';
import { LoginModal } from './components/LoginModal';
import { ForcePasswordChange } from './components/ForcePasswordChange';
import { useToast } from './components/Toast';
import { useTheme } from './components/ThemeToggle';
import { useModuleVisibility } from './app/hooks/useModuleVisibility';
import { useYellowCardAlerts } from './app/hooks/useYellowCardAlerts';
import { useClassData } from './app/hooks/useClassData';
import { useAuthSession } from './app/hooks/useAuthSession';
import { useAppLiveSync } from './app/hooks/useAppLiveSync';
import { useAppModals } from './app/hooks/useAppModals';
import { hasSeenLatestRelease, markLatestReleaseSeen } from './lib/releases';
import { useTimeoutEscalations } from './app/hooks/useTimeoutEscalations';
import { canWriteSubjectInClass, isSchoolLeadershipUser } from './app/helpers';
import { createRatingWriteHandlers, downloadBackup } from './app/actions';
import { stopViewAs } from './services/api';
import { AppHeader } from './app/components/AppHeader';
import { ClassNavBar } from './app/components/ClassNavBar';
import { AppBanners } from './app/components/AppBanners';
import { MainContent } from './app/components/MainContent';
import { AppModals } from './app/components/AppModals';

export function App() {
  const toast = useToast();
  const { forceDark } = useTheme();
  const { activeTab, setActiveTab, showAllModules, toggleAllModules } = useModuleVisibility();
  const modals = useAppModals();
  const { conferenceModalOpen } = modals;

  /*
    The conference view is projected in a darkened room, where washed-out colours
    are harder to read rather than easier. Force it dark regardless of the user's
    light/dark preference, and restore their theme on exit.
  */
  useEffect(() => {
    forceDark(conferenceModalOpen);
    return () => forceDark(false);
  }, [conferenceModalOpen, forceDark]);

  const {
    yellowAlerts,
    yellowAlertError,
    setYellowAlerts,
    setYellowAlertError,
    refreshYellowCardAlerts,
  } = useYellowCardAlerts();

  // useLiveSync needs the class loader's callbacks, and the class loader must seed the
  // live-sync state that useLiveSync owns. The ref breaks that cycle: it is refreshed on
  // every render, before any effect or load can call it.
  const syncSeedRef = useRef<(classId: number, patch: Partial<ClassSyncState>) => void>(() => {});
  const classData = useClassData({
    refreshYellowCardAlerts,
    seedClassSyncState: (classId, patch) => syncSeedRef.current(classId, patch),
  });
  const {
    classes,
    classListError,
    selectedClassId,
    pupils,
    criteria,
    submissionDeadline,
    loadingClass,
    classLoadError,
    loadClassData,
    loadClasses,
  } = classData;

  const { currentUser, loadingAuth, handleLoginSuccess, handleLogout, handlePasswordChanged } =
    useAuthSession({
      toast,
      loadClasses,
      clearClassState: classData.clearClassState,
      setLoadingClass: classData.setLoadingClass,
      setYellowAlerts,
      setYellowAlertError,
    });

  // Modal state can hold a full pupil snapshot. Never carry it across a login,
  // logout or session-expiry transition on a shared device.
  const resetModals = modals.resetModals;
  useEffect(() => {
    resetModals();
  }, [currentUser?.id, resetModals]);

  /*
    The "Was ist neu?" notice is a one-shot: it appears once per teacher and
    release, then it is gone for good. The seen flag is written as soon as it
    opens, so a reload while it is on screen cannot bring it back. A read-only
    "view as" session must not consume the shown teacher's notice.
  */
  useEffect(() => {
    if (!currentUser || currentUser.viewAs) return;
    if (hasSeenLatestRelease(currentUser.username)) return;
    markLatestReleaseSeen(currentUser.username);
    modals.setWhatsNewOpen(true);
  }, [currentUser?.username, currentUser?.viewAs]);

  const live = useAppLiveSync({
    selectedClassId,
    currentUser,
    loadClassData,
    refreshYellowCardAlerts,
    setPupils: classData.setPupils,
  });
  syncSeedRef.current = live.setClassSyncState;

  // Schulleitung (SLC, MED) plus the system administrator. Conference mode and the
  // escalation dashboard use this gate; account administration uses the same one.
  const isSchoolLeadership = isSchoolLeadershipUser(currentUser);
  const isAccountAdministrator = isSchoolLeadership;
  const isSystemAdministrator = currentUser?.role === 'admin';
  const canAccessConference = isSchoolLeadership;
  const { pendingTimeoutCount, refreshPendingTimeoutCount } = useTimeoutEscalations(
    currentUser,
    isSchoolLeadership,
  );

  const currentClass = classes.find((c) => c.id === selectedClassId) || classes[0] || null;
  // `live.canRate === null` means "no verdict yet" — treat it as read-only, not
  // writable: the server has not confirmed the caller may write this class, and
  // the SYNCED that carries the verdict arrives one round trip after the class
  // switch. Fail closed here, or the teacher gets 423s instead of disabled inputs.
  const canRateCurrentClass = currentClass?.canRate === true && live.canRate === true;
  const canWriteSubject = (subjectCode?: string) =>
    canWriteSubjectInClass(currentClass, canRateCurrentClass, isSchoolLeadership, subjectCode);
  const { handleSubmitPupil, handleReopenEvaluation, handleBatchUpdate } = createRatingWriteHandlers({
    selectedClassId,
    currentClass,
    canWriteSubject,
    loadClassData,
    toast,
  });

  const reloadSelectedClass = () => {
    if (selectedClassId) loadClassData(selectedClassId);
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-950 text-slate-50">
        <RefreshCw className="w-8 h-8 animate-spin text-amber-400" />
      </div>
    );
  }

  if (!currentUser) {
    return <LoginModal onSuccess={handleLoginSuccess} />;
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
      {currentUser.viewAs && (
        <div className="flex flex-wrap items-center justify-between gap-2 bg-amber-400 px-4 py-2 text-xs font-bold text-amber-950 shadow-sm">
          <span>
            👁 Ansicht als <strong>{currentUser.username}</strong> — schreibgeschützt
          </span>
          <button
            type="button"
            onClick={() => {
              void stopViewAs()
                .then(() => window.location.reload())
                .catch(() => toast.error('Zurückwechseln fehlgeschlagen. Bitte neu anmelden.'));
            }}
            className="rounded-md border border-amber-950/30 bg-amber-950/10 px-3 py-1 font-bold hover:bg-amber-950/20"
          >
            Zurück zu meinem Konto
          </button>
        </div>
      )}
      <div className="sticky top-0 z-40">
        <AppHeader
          currentUser={currentUser}
          currentClass={currentClass}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          showAllModules={showAllModules}
          toggleAllModules={toggleAllModules}
          isConnected={live.isConnected}
          connectionError={live.connectionError}
          canAccessConference={canAccessConference}
          isSchoolLeadership={isSchoolLeadership}
          isAccountAdministrator={isAccountAdministrator}
          isSystemAdministrator={isSystemAdministrator}
          pendingTimeoutCount={pendingTimeoutCount}
          modals={modals}
          onDownloadBackup={() => downloadBackup(toast)}
          onLogout={handleLogout}
        />

        {/* Dedicated Class Navigation Sub-Header for Bewertung */}
        {activeTab === 'bewertung' && classes.length > 0 && (
          <ClassNavBar
            classes={classes}
            selectedClassId={selectedClassId}
            currentClass={currentClass}
            pupilCount={pupils.length}
            onSelectClass={classData.setSelectedClassId}
          />
        )}
      </div>

      <AppBanners
        yellowAlertError={yellowAlertError}
        yellowAlerts={yellowAlerts as Array<{
          pupil_id: number;
          pupil_name: string;
          class_name: string;
          yellow_count: number;
        }>}
        onRetryAlerts={() => void refreshYellowCardAlerts()}
        isLockedByConference={live.isLockedByConference}
      />

      {/* Main Body */}
      {/* safe-bottom keeps content clear of the home indicator in a Home Screen app. */}
      <main className="flex-1 px-4 md:px-6 py-4 md:py-6 max-w-[1600px] w-full mx-auto safe-bottom">
        <MainContent
          activeTab={activeTab}
          loadingClass={loadingClass}
          classes={classes}
          currentClass={currentClass}
          currentUser={currentUser}
          pupils={pupils}
          criteria={criteria}
          selectedClassId={selectedClassId}
          classListError={classListError}
          classLoadError={classLoadError}
          submissionDeadline={submissionDeadline}
          ratingPupilId={null}
          isLockedByConference={live.isLockedByConference}
          canRateCurrentClass={canRateCurrentClass}
          grid={{
            softLocks: live.softLocks,
            conflict: live.conflict,
            onClearConflict: live.clearConflict,
            onSendFocus: live.sendFocus,
            onSendBlur: live.sendBlur,
            onRate: live.sendRating,
          }}
          modals={modals}
          onSelectClass={classData.setSelectedClassId}
          onReloadClass={reloadSelectedClass}
          onRetryClassList={() => currentUser && void loadClasses(currentUser)}
          onRetryClass={() => {
            if (selectedClassId) void loadClassData(selectedClassId);
            else if (currentUser) void loadClasses(currentUser);
          }}
          onSubmitPupil={handleSubmitPupil}
          onReopenPupil={handleReopenEvaluation}
          onBatchUpdate={handleBatchUpdate}
        />
      </main>

      <AppModals
        modals={modals}
        currentUser={currentUser}
        currentClass={currentClass}
        classes={classes}
        selectedClassId={selectedClassId}
        pupils={pupils}
        criteria={criteria}
        isAccountAdministrator={isAccountAdministrator}
        isSystemAdministrator={isSystemAdministrator}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        loadClassData={loadClassData}
        refreshPendingTimeoutCount={refreshPendingTimeoutCount}
        onReloadSelectedClass={reloadSelectedClass}
      />
    </div>
  );
}
