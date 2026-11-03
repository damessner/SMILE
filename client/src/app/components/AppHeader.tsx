import {
  GraduationCap,
  Users,
  Download,
  LogOut,
  BarChart3,
  ClipboardList,
  Scale,
  Calendar,
  FileText,
  Clock,
  HelpCircle,
  LayoutGrid,
  EyeOff,
  KeyRound,
  RotateCcw,
  Bell,
} from 'lucide-react';
import type { SchoolClass, User } from '../../types';
import { ThemeToggle } from '../../components/ThemeToggle';
import type { AppModals } from '../hooks/useAppModals';
import type { AppTab } from '../types';

export interface AppHeaderProps {
  currentUser: User;
  currentClass: SchoolClass | null;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  showAllModules: boolean;
  toggleAllModules: () => void;
  isConnected: boolean;
  connectionError: string | null;
  canAccessConference: boolean;
  isSchoolLeadership: boolean;
  isAccountAdministrator: boolean;
  isSystemAdministrator: boolean;
  pendingTimeoutCount: number;
  modals: AppModals;
  onDownloadBackup: () => void;
  onLogout: () => void;
}

export function AppHeader({
  currentUser,
  currentClass,
  activeTab,
  setActiveTab,
  showAllModules,
  toggleAllModules,
  isConnected,
  connectionError,
  canAccessConference,
  isSchoolLeadership,
  isAccountAdministrator,
  isSystemAdministrator,
  pendingTimeoutCount,
  modals,
  onDownloadBackup,
  onLogout,
}: AppHeaderProps) {
  const {
    setConferenceModalOpen,
    setPupilManagerOpen,
    setAllClassesExportOpen,
    setAdminAccountsOpen,
    setAdminRestoreOpen,
    setTimeoutEscalationOpen,
    setOnboardingOpen,
    setNotificationSettingsOpen,
  } = modals;
  const isHeadmaster = isSchoolLeadership;

  return (
      /*
        Top bar. `material-bar` gives the iOS translucent-material look;
        `safe-top` insets it below the status bar when installed to the Home
        Screen with viewport-fit=cover.
      */
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

          {isSystemAdministrator && (
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

          {/* E-mail notification subscriptions */}
          <button
            onClick={() => setNotificationSettingsOpen(true)}
            className="p-2 rounded-xl bg-slate-800 text-slate-300 hover:text-sky-300 hover:bg-slate-700 transition border border-slate-700/60"
            title="E-Mail-Benachrichtigungen einstellen"
            aria-label="E-Mail-Benachrichtigungen einstellen"
          >
            <Bell className="w-4 h-4" />
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
              onClick={onDownloadBackup}
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
              onClick={onLogout}
              title="Abmelden"
              className="p-2 rounded-xl text-slate-400 hover:text-red-400 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>
  );
}
