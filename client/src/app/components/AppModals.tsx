import type { PupilWithData, RubricCriterion, SchoolClass, User } from '../../types';
import { AdminAccountsModal } from '../../components/AdminAccountsModal';
import { AdminRestoreModal } from '../../components/AdminRestoreModal';
import { CardDrawer } from '../../components/CardDrawer';
import { KelPdfModal } from '../../components/KelPdfModal';
import { PupilManagerModal } from '../../components/PupilManagerModal';
import { ConferenceVotingModal } from '../../components/ConferenceVotingModal';
import { TeacherClassReportModal } from '../../components/TeacherClassReportModal';
import { AllClassesConferenceExportModal } from '../../components/AllClassesConferenceExportModal';
import { TimeoutEscalationModal } from '../../components/TimeoutEscalationModal';
import { OnboardingTour } from '../../components/OnboardingTour';
import type { AppModals } from '../hooks/useAppModals';
import type { AppTab } from '../types';

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
  } = modals;

  return (
    <>
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

      {/* Interactive Spotlight Onboarding Tour */}
      <OnboardingTour
        isOpen={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        currentUser={currentUser}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    </>
  );
}
