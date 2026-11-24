import { useEffect, useRef, useState } from 'react';
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
  KeyRound,
  RotateCcw,
  Bell,
  BookOpen,
  ChevronDown,
} from 'lucide-react';
import type { SchoolClass, User } from '../../types';
import { ThemeToggle } from '../../components/ThemeToggle';
import { withViewTransition } from '../../lib/viewTransition';
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
    setReleaseHistoryOpen,
    setNotificationSettingsOpen,
  } = modals;
  const isHeadmaster = isSchoolLeadership;
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
      /*
        Top bar. `material-bar` gives the iOS translucent-material look;
        `safe-top` insets it below the status bar when installed to the Home
        Screen with viewport-fit=cover. Sticky positioning is owned by the
        parent stack wrapper so ClassNavBar never overlaps a wrapped header.
      */
      <header className="material-bar relative z-40 safe-top px-4 md:px-6 py-2.5 md:py-3 flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div data-tour="welcome-logo" className="flex items-center gap-2 text-slate-50 font-semibold text-base tracking-tight shrink-0">
            <div className="w-8 h-8 rounded-lg bg-accent/15 text-accent flex items-center justify-center">
              <GraduationCap className="w-4.5 h-4.5" />
            </div>
            <span className="hidden sm:inline">SMILE</span>
          </div>

          {/* Navigation tabs: [Schulalltag] [WebUntis] [Schulstatistik] (hidden: [Einstufung]) */}
          <div data-tour="nav-tabs" className="flex items-center gap-1.5 shrink-0">
            <div className="segmented shrink-0">
              {(
                [
                  ['schulalltag', 'Schulalltag', Calendar],
                  ['webuntis', 'WebUntis', BookOpen],
                  ['statistics', 'Schulstatistik', BarChart3],
                  ...(showAllModules ? [['bewertung', 'Einstufung', ClipboardList] as const] : []),
                ] as const
              ).map(([key, label, Icon]) => (
                <button
                  key={key}
                  onClick={() => withViewTransition(() => setActiveTab(key))}
                  aria-current={activeTab === key ? 'true' : undefined}
                  title={label}
                  className="segmented-item pressable focus-ring md:px-3.5"
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {/* 1-Click Toggle to Show / Hide Einstufung for Conferences */}
            <button
              onClick={toggleAllModules}
              className={`min-h-[40px] px-2.5 py-1.5 rounded-xl transition border text-sm flex items-center gap-1.5 ${
                showAllModules
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : 'bg-slate-800/70 text-slate-300 hover:text-slate-100 hover:bg-slate-700 border-slate-700/60'
              }`}
              title={
                showAllModules
                  ? 'Einstufungsmodul wieder ausblenden (Schulalltag-Fokus)'
                  : 'Einstufungsmodul für Konferenz einblenden'
              }
              aria-label={showAllModules ? 'Einstufungsmodul ausblenden' : 'Einstufungsmodul einblenden'}
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              <span className="hidden lg:inline text-2xs font-semibold whitespace-nowrap">
                {showAllModules ? 'Einstufung aktiv' : 'Einstufung'}
              </span>
            </button>
          </div>
        </div>

        {/* Action Controls & Consolidated User Menu */}
        <div className="flex items-center justify-end gap-2">
          {/* Live Status Pill */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-800 border border-slate-700 text-sm">
            <span
              className={`w-2 h-2 rounded-full ${
                connectionError ? 'bg-rose-400' : isConnected ? 'bg-emerald-400 animate-pulse-soft' : 'bg-amber-400 animate-pulse-soft'
              }`}
            />
            <span className="text-2xs text-slate-400 whitespace-nowrap" title={connectionError || undefined}>
              {connectionError ? 'Live Sync gestört' : isConnected ? 'Live Sync' : 'Verbinde...'}
            </span>
          </div>

          {/* Conference Button (school leadership only: MED, SLC, admin — matches server canRunConference) */}
          {canAccessConference && (
            <button
              data-tour="conference-button"
              onClick={() => setConferenceModalOpen(true)}
              className="min-h-[40px] px-3 py-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-bold text-sm flex items-center gap-1.5 shadow-sm transition active:scale-95"
              title="Klassenkonferenz & Notenbeschluss im Vollbildmodus (Schulleitung & Administrator)"
            >
              <Scale className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xl:inline whitespace-nowrap">Konferenz-Modus</span>
            </button>
          )}

          {isSchoolLeadership && (
            <button
              onClick={() => setTimeoutEscalationOpen(true)}
              className="pressable focus-ring min-h-[40px] px-3 py-1.5 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-slate-50 font-bold text-sm flex items-center gap-1.5 shadow-sm transition"
              title="Time-Out Eskalationen & Elternvereinbarungen (Mahnstufen 3, 6, 9...)"
            >
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden xl:inline whitespace-nowrap">Time-Out</span>
              {pendingTimeoutCount > 0 && (
                <span className="w-4 h-4 rounded-full bg-white text-rose-600 text-2xs font-bold flex items-center justify-center animate-pulse">
                  {pendingTimeoutCount}
                </span>
              )}
            </button>
          )}

          {/* Light / dark theme */}
          <ThemeToggle />

          {/* Help, changes & version history */}
          <button
            data-tour="help-button"
            onClick={() => setReleaseHistoryOpen(true)}
            className="icon-button pressable focus-ring hover:text-amber-400"
            title="Hilfe, Änderungen & Versionsverlauf öffnen"
            aria-label="Hilfe, Änderungen und Versionsverlauf"
          >
            <HelpCircle className="w-4 h-4" />
          </button>

          {/* Consolidated User & Tools Menu */}
          <div className="relative pl-1.5 border-l border-slate-800" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-label="Konto und Werkzeuge"
              className="min-h-[40px] px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 border border-slate-700/60 flex items-center gap-2 transition"
            >
              <div className="text-right hidden sm:block">
                <span className="text-sm font-bold text-slate-50 block leading-tight">
                  {currentUser.teacher?.shortName || currentUser.teacher?.fullName || currentUser.username}
                </span>
                <span className="text-2xs text-slate-400 uppercase tracking-wider block leading-tight">
                  {isHeadmaster ? 'Schulleitung' : currentUser.role}
                </span>
              </div>
              <span className="sm:hidden text-sm font-bold text-slate-100">
                {currentUser.teacher?.shortName || currentUser.username}
              </span>
              <ChevronDown className={`w-3.5 h-3.5 text-slate-400 transition-transform ${menuOpen ? 'rotate-180' : ''}`} />
            </button>

            {menuOpen && (
              <div
                role="menu"
                aria-label="Konto- und Systemwerkzeuge"
                className="absolute right-0 mt-2 w-64 rounded-2xl surface-3 shadow-xl py-2 z-50 border border-hairline"
              >
                <div className="px-3.5 py-2 border-b border-hairline mb-1">
                  <p className="text-sm font-bold text-slate-100 truncate">
                    {currentUser.teacher?.fullName || currentUser.username}
                  </p>
                  <p className="text-2xs text-slate-400 truncate">
                    {currentUser.teacher?.shortName ? `${currentUser.teacher.shortName} · ` : ''}
                    {isHeadmaster ? 'Schulleitung' : currentUser.role}
                  </p>
                </div>

                {currentClass && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setPupilManagerOpen(true);
                    }}
                    className="menu-item"
                  >
                    <Users className="w-4 h-4 text-slate-400" />
                    <span>Schülerverwaltung ({currentClass.name})</span>
                  </button>
                )}

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setNotificationSettingsOpen(true);
                  }}
                  className="menu-item"
                >
                  <Bell className="w-4 h-4 text-sky-400" />
                  <span>E-Mail-Benachrichtigungen</span>
                </button>

                {isSchoolLeadership && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setAllClassesExportOpen(true);
                    }}
                    className="menu-item"
                  >
                    <FileText className="w-4 h-4 text-emerald-400" />
                    <span>Gesamtexport aller Klassen (PDF)</span>
                  </button>
                )}

                {isAccountAdministrator && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setAdminAccountsOpen(true);
                    }}
                    className="menu-item"
                  >
                    <KeyRound className="w-4 h-4 text-accent" />
                    <span>Konten verwalten</span>
                  </button>
                )}

                {(currentUser.role === 'admin' || currentUser.role === 'head_teacher') && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      onDownloadBackup();
                    }}
                    className="menu-item"
                  >
                    <Download className="w-4 h-4 text-amber-400" />
                    <span>1-Klick Backup herunterladen</span>
                  </button>
                )}

                {isSystemAdministrator && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(false);
                      setAdminRestoreOpen(true);
                    }}
                    className="menu-item" data-tone="danger"
                  >
                    <RotateCcw className="w-4 h-4 text-rose-400" />
                    <span>System-Wiederherstellung</span>
                  </button>
                )}

                <div className="my-1 border-t border-hairline" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    onLogout();
                  }}
                  className="menu-item" data-tone="danger"
                >
                  <LogOut className="w-4 h-4 text-rose-400" />
                  <span>Abmelden</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
  );
}
