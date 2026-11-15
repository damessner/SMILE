import { lazy, Suspense } from 'react';
import type { PupilWithData, RubricCriterion, SchoolClass, User } from '../../types';
import type { AppModals } from '../hooks/useAppModals';
import type { AppTab } from '../types';

const AdminAccountsModal = lazy(() =>
  import('../../components/AdminAccountsModal').then((m) => ({ default: m.AdminAccountsModal })),
);
const AdminRestoreModal = lazy(() =>
  import('../../components/AdminRestoreModal').then((m) => ({ default: m.AdminRestoreModal })),
);
const CardDrawer = lazy(() =>
  import('../../components/CardDrawer').then((m) => ({ default: m.CardDrawer })),
);
const KelPdfModal = lazy(() =>
  import('../../components/KelPdfModal').then((m) => ({ default: m.KelPdfModal })),
);
const PupilManagerModal = lazy(() =>
  import('../../components/PupilManagerModal').then((m) => ({ default: m.PupilManagerModal })),
);
const ConferenceVotingModal = lazy(() =>
  import('../../components/ConferenceVotingModal').then((m) => ({ default: m.ConferenceVotingModal })),
);
const TeacherClassReportModal = lazy(() =>
  import('../../components/TeacherClassReportModal').then((m) => ({ default: m.TeacherClassReportModal })),
);
const AllClassesConferenceExportModal = lazy(() =>
  import('../../components/AllClassesConferenceExportModal').then((m) => ({
    default: m.AllClassesConferenceExportModal,
  })),
);
const TimeoutEscalationModal = lazy(() =>
  import('../../components/TimeoutEscalationModal').then((m) => ({ default: m.TimeoutEscalationModal })),
);
const OnboardingTour = lazy(() =>
  import('../../components/OnboardingTour').then((m) => ({ default: m.OnboardingTour })),
);
const ReleaseHistoryModal = lazy(() =>
  import('../../components/ReleaseNotes').then((m) => ({ default: m.ReleaseHistoryModal })),
);
const WhatsNewDialog = lazy(() =>
  import('../../components/ReleaseNotes').then((m) => ({ default: m.WhatsNewDialog })),
);
const NotificationSettingsModal = lazy(() =>
  import('../../components/NotificationSettingsModal').then((m) => ({
    default: m.NotificationSettingsModal,
  })),
);

export interface AppModalsProps {
  modals: AppModals;
  currentUser: User;
  currentClass: SchoolClass | null;
  classes: SchoolClass[];
  selectedClassId: number | null;
  pupils: PupilWithData[];
  criteria: RubricCriterion[];
  isAccountAdministrator: boolean;
  isSystemAdministrator: boolean;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  loadClassData: (classId: number) => Promise<void>;
  refreshPendingTimeoutCount: () => void;
  onReloadSelectedClass: () => void;
}

/** Every modal, drawer and the onboarding tour, each mounted only while open. */
export function AppModals({
  modals,
  currentUser,
  currentClass,
  classes,
  selectedClassId,
  pupils,
  criteria,
  isAccountAdministrator,
  isSystemAdministrator,
  activeTab,
  setActiveTab,
  loadClassData,
  refreshPendingTimeoutCount,
  onReloadSelectedClass,
}: AppModalsProps) {
  const {
    activeCardDrawer,
    setActiveCardDrawer,
    activeKelPupil,
    setActiveKelPupil,
    pupilManagerOpen,
    setPupilManagerOpen,
    conferenceModalOpen,
    setConferenceModalOpen,
    teacherReportModalOpen,
    setTeacherReportModalOpen,
    allClassesExportOpen,
    setAllClassesExportOpen,
    adminAccountsOpen,
    setAdminAccountsOpen,
    adminRestoreOpen,
    setAdminRestoreOpen,
    timeoutEscalationOpen,
    setTimeoutEscalationOpen,
    onboardingOpen,
    setOnboardingOpen,
    whatsNewOpen,
    setWhatsNewOpen,
    releaseHistoryOpen,
    setReleaseHistoryOpen,
    notificationSettingsOpen,
    setNotificationSettingsOpen,
  } = modals;

  return (
    <Suspense fallback={null}>
      {conferenceModalOpen && classes.length > 0 && (
        <ConferenceVotingModal
          classes={classes}
          initialClassId={selectedClassId || classes[0].id}
          currentUser={currentUser}
          onClose={() => setConferenceModalOpen(false)}
          onOpenAllClassesExport={() => setAllClassesExportOpen(true)}
          onVotesUpdated={onReloadSelectedClass}
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

      {adminRestoreOpen && isSystemAdministrator && (
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
            onReloadSelectedClass();
          }}
          onUpdated={refreshPendingTimeoutCount}
        />
      )}

      {notificationSettingsOpen && (
        <NotificationSettingsModal onClose={() => setNotificationSettingsOpen(false)} />
      )}

      {/* One-time "Was ist neu?" notice for the current release */}
      {whatsNewOpen && (
        <WhatsNewDialog
          currentUser={currentUser}
          onClose={() => setWhatsNewOpen(false)}
          onOpenHistory={() => {
            setWhatsNewOpen(false);
            setReleaseHistoryOpen(true);
          }}
        />
      )}

      {/* Help menu content: full release history plus tour entry point */}
      {releaseHistoryOpen && (
        <ReleaseHistoryModal
          onClose={() => setReleaseHistoryOpen(false)}
          onStartTour={() => {
            setReleaseHistoryOpen(false);
            setOnboardingOpen(true);
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
    </Suspense>
  );
}
