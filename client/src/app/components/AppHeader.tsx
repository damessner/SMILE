import { useEffect, useRef, useState } from 'react';
import {
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
  User as UserIcon,
  Check,
} from 'lucide-react';
import type { SchoolClass, User } from '../../types';
import { ThemeToggle } from '../../components/ThemeToggle';
import { withViewTransition } from '../../lib/viewTransition';
import type { AppModals } from '../hooks/useAppModals';
import type { AppTab } from '../types';

export interface AppHeaderProps {
  currentUser: User;
  currentClass: SchoolClass | null;
  classes?: SchoolClass[];
  selectedClassId?: number | null;
  onSelectClass?: (classId: number) => void;
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  schulalltagView?: 'class' | 'lw' | 'all';
  onSelectSchulalltagView?: (view: 'class' | 'lw' | 'all') => void;
  lwActiveCount?: number;
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
  classes = [],
  selectedClassId,
  onSelectClass,
  activeTab,
  setActiveTab,
  schulalltagView = 'class',
  onSelectSchulalltagView,
  lwActiveCount = 0,
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
  const [classMenuOpen, setClassMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const classMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen && !classMenuOpen) return;
    const handleMouseDown = (event: MouseEvent) => {
      if (menuOpen && menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
      if (classMenuOpen && classMenuRef.current && !classMenuRef.current.contains(event.target as Node)) {
        setClassMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setClassMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen, classMenuOpen]);

  const classOptions = classes.filter((c) => c.name !== 'LW');
  const activeClassLabel =
    activeTab === 'schulalltag' && schulalltagView === 'lw'
      ? 'LW'
      : activeTab === 'schulalltag' && schulalltagView === 'all'
      ? 'Alle'
      : currentClass?.name || 'Klasse';

  const userShort =
    currentUser.teacher?.shortName ||
    currentUser.teacher?.fullName?.split(' ').map((w) => w[0]).join('').slice(0, 3) ||
    currentUser.username;

  const navigateModule = (tab: AppTab, subView?: 'class' | 'lw') => {
    withViewTransition(() => {
      if (tab === 'schulalltag' && subView) {
        onSelectSchulalltagView?.(subView);
      } else if (tab === 'schulalltag' && schulalltagView === 'lw') {
        onSelectSchulalltagView?.('class');
      }
      setActiveTab(tab);
    });
  };

  return (
    <header className="material-bar relative z-40 safe-top px-3 sm:px-6 h-16 flex items-center justify-between gap-2 sm:gap-3">
      {/* Left: Brand Logo + Class Dropdown Pill */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <div
          data-tour="welcome-logo"
          className="inline-flex items-center rounded-xl bg-white/95 px-2.5 py-1 shadow-sm border border-hairline/40 shrink-0"
        >
          <img src="/smile-logo.svg" alt="SMILE" className="h-6 w-auto" />
        </div>

        {classes.length > 0 && (
          <div className="relative" ref={classMenuRef}>
            <button
              type="button"
              data-tour="class-selector"
              onClick={() => setClassMenuOpen((prev) => !prev)}
              aria-haspopup="listbox"
              aria-expanded={classMenuOpen}
              aria-label={`Klasse wählen: ${activeClassLabel}`}
              className="pressable focus-ring flex items-center gap-1 px-2.5 py-1.5 min-h-[36px] rounded-full bg-surface-3 hover:bg-surface-bright text-on-surface text-sm font-semibold transition-colors border border-hairline/60"
            >
              <span className="truncate max-w-[72px]">{activeClassLabel}</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-on-surface-variant transition-transform ${classMenuOpen ? 'rotate-180' : ''}`}
                aria-hidden="true"
              />
            </button>

            {classMenuOpen && (
              <div
                role="listbox"
                aria-label="Klassen und Bereiche"
                className="absolute left-0 mt-2 w-60 max-h-[70vh] overflow-y-auto rounded-2xl surface-3 shadow-xl py-1.5 z-50 border border-hairline"
              >
                <div className="px-3 py-1.5 text-2xs font-bold uppercase tracking-wider text-on-surface-variant">
                  Klassen &amp; Bereiche
                </div>

                {onSelectSchulalltagView && (
                  <button
                    type="button"
                    onClick={() => {
                      setClassMenuOpen(false);
                      navigateModule('schulalltag', 'lw');
                    }}
                    className="menu-item justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-critical" aria-hidden="true" />
                      <span>Lernwerkstatt (LW)</span>
                    </span>
                    {lwActiveCount > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full bg-critical/20 text-critical-soft text-2xs font-bold tabular">
                        {lwActiveCount}
                      </span>
                    )}
                  </button>
                )}

                {currentUser.schoolWideBehaviour && onSelectSchulalltagView && (
                  <button
                    type="button"
                    onClick={() => {
                      setClassMenuOpen(false);
                      withViewTransition(() => {
                        onSelectSchulalltagView('all');
                        setActiveTab('schulalltag');
                      });
                    }}
                    className="menu-item justify-between"
                  >
                    <span className="flex items-center gap-2">
                      <Users className="w-4 h-4 text-info" aria-hidden="true" />
                      <span>Alle Klassen</span>
                    </span>
                    {activeTab === 'schulalltag' && schulalltagView === 'all' && (
                      <Check className="w-4 h-4 text-accent" aria-hidden="true" />
                    )}
                  </button>
                )}

                {(onSelectSchulalltagView || currentUser.schoolWideBehaviour) && classOptions.length > 0 && (
                  <div className="my-1 border-t border-hairline" />
                )}

                {classOptions.map((cls) => {
                  const isSelected =
                    cls.id === (selectedClassId ?? currentClass?.id) &&
                    !(activeTab === 'schulalltag' && schulalltagView !== 'class');
                  return (
                    <button
                      key={cls.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        setClassMenuOpen(false);
                        withViewTransition(() => {
                          onSelectClass?.(cls.id);
                          if (activeTab === 'schulalltag' && schulalltagView !== 'class') {
                            onSelectSchulalltagView?.('class');
                          }
                        });
                      }}
                      className="menu-item justify-between"
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`font-bold ${isSelected ? 'text-accent' : 'text-on-surface'}`}>
                          Klasse {cls.name}
                        </span>
                        {cls.isKv && (
                          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-2xs font-bold">
                            KV
                          </span>
                        )}
                      </span>
                      {isSelected && <Check className="w-4 h-4 text-accent shrink-0" aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Center: Desktop / Tablet Segmented Navigation (5 real SMILE modules) */}
      <nav
        aria-label="Hauptnavigation"
        data-tour="nav-tabs"
        className="hidden md:flex items-center justify-center min-w-0"
      >
        <div className="segmented shrink-0">
          <button
            type="button"
            onClick={() => navigateModule('schulalltag', 'class')}
            aria-current={activeTab === 'schulalltag' && schulalltagView !== 'lw' ? 'true' : undefined}
            title="Schulalltag"
            className="segmented-item pressable focus-ring lg:px-3.5"
          >
            <Calendar className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Schulalltag</span>
          </button>

          <button
            type="button"
            onClick={() => navigateModule('schulalltag', 'lw')}
            aria-current={activeTab === 'schulalltag' && schulalltagView === 'lw' ? 'true' : undefined}
            title="Lernwerkstatt (LW)"
            className="segmented-item pressable focus-ring lg:px-3.5"
          >
            <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Lernwerkstatt</span>
            {lwActiveCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-critical/25 text-critical-soft text-2xs font-bold tabular leading-none">
                {lwActiveCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => navigateModule('bewertung')}
            aria-current={activeTab === 'bewertung' ? 'true' : undefined}
            title="Einstufung"
            className="segmented-item pressable focus-ring lg:px-3.5"
          >
            <ClipboardList className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Einstufung</span>
          </button>

          <button
            type="button"
            onClick={() => navigateModule('webuntis')}
            aria-current={activeTab === 'webuntis' ? 'true' : undefined}
            title="WebUntis"
            className="segmented-item pressable focus-ring lg:px-3.5"
          >
            <BookOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>WebUntis</span>
          </button>

          <button
            type="button"
            onClick={() => navigateModule('statistics')}
            aria-current={activeTab === 'statistics' ? 'true' : undefined}
            title="Schulstatistik"
            className="segmented-item pressable focus-ring lg:px-3.5"
          >
            <BarChart3 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Statistik</span>
          </button>
        </div>
      </nav>

      {/* Right: LIVE Pill + Leadership Shortcuts + Theme + Help + User Avatar */}
      <div className="flex items-center justify-end gap-1.5 sm:gap-2 shrink-0">
        {/* Live Sync Status Pill (always compact & legible) */}
        <div
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-2xs font-semibold uppercase tracking-wider ${
            connectionError
              ? 'bg-critical/20 text-critical-soft'
              : isConnected
              ? 'bg-positive-dim/20 text-positive'
              : 'bg-accent-dim/20 text-accent'
          }`}
          title={connectionError || (isConnected ? 'Live Sync aktiv' : 'Verbinde...')}
        >
          <span
            className={`w-2 h-2 rounded-full ${
              connectionError
                ? 'bg-critical'
                : isConnected
                ? 'bg-positive animate-pulse-soft'
                : 'bg-accent animate-pulse-soft'
            }`}
          />
          <span>{connectionError ? 'Störung' : isConnected ? 'Live' : 'Sync'}</span>
        </div>

        {/* Conference Button (school leadership only) */}
        {canAccessConference && (
          <button
            type="button"
            data-tour="conference-button"
            onClick={() => setConferenceModalOpen(true)}
            className="hidden sm:inline-flex pressable focus-ring min-h-[36px] px-2.5 py-1.5 rounded-xl bg-accent hover:brightness-105 text-on-accent font-bold text-sm items-center gap-1.5 shadow-sm transition"
            title="Klassenkonferenz & Notenbeschluss im Vollbildmodus (Schulleitung & Administrator)"
          >
            <Scale className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline whitespace-nowrap">Konferenz</span>
          </button>
        )}

        {/* Leadership Escalations Button */}
        {isSchoolLeadership && (
          <button
            type="button"
            onClick={() => setTimeoutEscalationOpen(true)}
            className="hidden sm:inline-flex pressable focus-ring min-h-[36px] px-2.5 py-1.5 rounded-xl bg-critical/20 hover:bg-critical/30 text-critical-soft border border-critical/30 font-bold text-sm items-center gap-1.5 transition"
            title="Time-Out Eskalationen & Elternvereinbarungen (Mahnstufen 3, 6, 9...)"
          >
            <Clock className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xl:inline whitespace-nowrap">Mahnungen</span>
            {pendingTimeoutCount > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-critical text-surface-lowest text-2xs font-bold leading-none animate-pulse">
                {pendingTimeoutCount}
              </span>
            )}
          </button>
        )}

        <div className="hidden sm:flex items-center gap-1.5">
          <ThemeToggle />
          <button
            type="button"
            data-tour="help-button"
            onClick={() => setReleaseHistoryOpen(true)}
            className="icon-button pressable focus-ring hover:text-accent"
            title="Hilfe, Änderungen & Versionsverlauf öffnen"
            aria-label="Hilfe, Änderungen und Versionsverlauf"
          >
            <HelpCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Consolidated User Avatar & Tools Menu */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Konto und Werkzeuge"
            className="pressable focus-ring flex items-center gap-2 rounded-full p-0.5 lg:pr-2.5 bg-surface-3/80 hover:bg-surface-bright border border-hairline/60 transition"
          >
            <span className="w-8 h-8 rounded-full bg-accent text-on-accent flex items-center justify-center font-bold text-2xs shrink-0">
              {currentUser.teacher?.shortName ? (
                <span className="uppercase">{currentUser.teacher.shortName.slice(0, 3)}</span>
              ) : (
                <UserIcon className="w-4 h-4" aria-hidden="true" />
              )}
            </span>
            <span className="hidden lg:inline text-sm font-semibold text-on-surface truncate max-w-[110px]">
              {userShort}
            </span>
            <ChevronDown
              className={`hidden lg:inline w-3.5 h-3.5 text-on-surface-variant transition-transform ${menuOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>

          {menuOpen && (
            <div
              role="menu"
              aria-label="Konto- und Systemwerkzeuge"
              className="absolute right-0 mt-2 w-64 rounded-2xl surface-3 shadow-xl py-2 z-50 border border-hairline"
            >
              <div className="px-3.5 py-2 border-b border-hairline mb-1">
                <p className="text-sm font-bold text-on-surface truncate">
                  {currentUser.teacher?.fullName || currentUser.username}
                </p>
                <p className="text-2xs text-on-surface-variant truncate">
                  {currentUser.teacher?.shortName ? `${currentUser.teacher.shortName} · ` : ''}
                  {isHeadmaster ? 'Schulleitung' : currentUser.role}
                </p>
              </div>

              {canAccessConference && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setConferenceModalOpen(true);
                  }}
                  className="menu-item sm:hidden"
                >
                  <Scale className="w-4 h-4 text-accent" />
                  <span>Konferenz-Modus</span>
                </button>
              )}

              {isSchoolLeadership && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    setTimeoutEscalationOpen(true);
                  }}
                  className="menu-item sm:hidden justify-between"
                >
                  <span className="flex items-center gap-2.5">
                    <Clock className="w-4 h-4 text-critical" />
                    <span>Time-Out Eskalationen</span>
                  </span>
                  {pendingTimeoutCount > 0 && (
                    <span className="px-1.5 py-0.5 rounded-full bg-critical text-surface-lowest text-2xs font-bold">
                      {pendingTimeoutCount}
                    </span>
                  )}
                </button>
              )}

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
                  <Users className="w-4 h-4 text-on-surface-variant" />
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
                <Bell className="w-4 h-4 text-info" />
                <span>E-Mail-Benachrichtigungen</span>
              </button>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setReleaseHistoryOpen(true);
                }}
                className="menu-item sm:hidden"
              >
                <HelpCircle className="w-4 h-4 text-accent" />
                <span>Hilfe &amp; Änderungen</span>
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
                  <FileText className="w-4 h-4 text-positive" />
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
                  <Download className="w-4 h-4 text-accent" />
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
                  className="menu-item"
                  data-tone="danger"
                >
                  <RotateCcw className="w-4 h-4 text-critical" />
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
                className="menu-item"
                data-tone="danger"
              >
                <LogOut className="w-4 h-4 text-critical" />
                <span>Abmelden</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
