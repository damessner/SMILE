import { useCallback, useState } from 'react';
import type { PupilWithData } from '../../types';
import type { CardDrawerTarget } from '../types';

/** Open/close state for every modal and drawer the shell can show. */
export function useAppModals() {
  const [activeCardDrawer, setActiveCardDrawer] = useState<CardDrawerTarget | null>(null);
  const [activeKelPupil, setActiveKelPupil] = useState<PupilWithData | null>(null);
  const [pupilManagerOpen, setPupilManagerOpen] = useState(false);
  const [conferenceModalOpen, setConferenceModalOpen] = useState(false);
  const [teacherReportModalOpen, setTeacherReportModalOpen] = useState(false);
  const [allClassesExportOpen, setAllClassesExportOpen] = useState(false);
  const [adminAccountsOpen, setAdminAccountsOpen] = useState(false);
  const [adminRestoreOpen, setAdminRestoreOpen] = useState(false);
  const [timeoutEscalationOpen, setTimeoutEscalationOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);
  const [releaseHistoryOpen, setReleaseHistoryOpen] = useState(false);
  const [notificationSettingsOpen, setNotificationSettingsOpen] = useState(false);

  /**
   * Close every modal/drawer. Called when the signed-in identity changes: a
   * modal can hold a full PupilWithData snapshot, so leaving it mounted across
   * logout/login would show the previous user's pupil on a shared staff device.
   */
  const resetModals = useCallback(() => {
    setActiveCardDrawer(null);
    setActiveKelPupil(null);
    setPupilManagerOpen(false);
    setConferenceModalOpen(false);
    setTeacherReportModalOpen(false);
    setAllClassesExportOpen(false);
    setAdminAccountsOpen(false);
    setAdminRestoreOpen(false);
    setTimeoutEscalationOpen(false);
    setOnboardingOpen(false);
    setWhatsNewOpen(false);
    setReleaseHistoryOpen(false);
    setNotificationSettingsOpen(false);
  }, []);

  return {
    resetModals,
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
  };
}

export type AppModals = ReturnType<typeof useAppModals>;
