import { useState } from 'react';
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

  return {
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
  };
}

export type AppModals = ReturnType<typeof useAppModals>;
