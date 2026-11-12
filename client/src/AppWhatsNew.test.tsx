import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';
import * as api from './services/api';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ThemeProvider } from './components/ThemeToggle';
import { ToastProvider } from './components/Toast';
import { LATEST_RELEASE, whatsNewStorageKey } from './lib/releases';

vi.mock('./services/api', () => ({
  SESSION_EXPIRED_EVENT: 'smile-session-expired',
  getMe: vi.fn(),
  getClasses: vi.fn(),
  getClassPupils: vi.fn(),
  getClassRubric: vi.fn(),
  getYellowCardAlerts: vi.fn(),
  getCurrentTimetable: vi.fn(),
  getTimeoutEscalations: vi.fn(),
  getNotificationPreferences: vi.fn(),
  saveNotificationPreferences: vi.fn(),
  logout: vi.fn(),
  exportBackup: vi.fn(),
}));

vi.mock('./hooks/useLiveSync', () => ({
  useLiveSync: () => ({
    isConnected: true,
    canRate: true,
    connectionError: null,
    softLocks: new Map(),
    conflict: null,
    clearConflict: vi.fn(),
    classSyncState: new Map(),
    classRoundLocks: new Map(),
    isLockedByConference: false,
    sendFocus: vi.fn(),
    sendBlur: vi.fn(),
    sendRating: vi.fn(),
    setClassSyncState: vi.fn(),
  }),
}));

vi.mock('./components/LoginModal', () => ({
  LoginModal: () => <div role="dialog">Login</div>,
}));

vi.mock('./components/OnboardingTour', () => ({
  OnboardingTour: () => null,
}));

// The real dialogs have their own suite; here only "did the notice open?" matters.
vi.mock('./components/ReleaseNotes', () => ({
  WhatsNewDialog: () => <div data-testid="whats-new-stub" />,
  ReleaseHistoryModal: () => null,
}));

const user = {
  id: 'user-1',
  username: 'teacher',
  role: 'teacher' as const,
  mustChangePassword: false,
};

function renderApp() {
  return render(
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <App />
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>,
  );
}

describe('one-time "Was ist neu?" notice', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.mocked(api.getMe).mockResolvedValue(user as any);
    vi.mocked(api.getClasses).mockResolvedValue([] as any);
    vi.mocked(api.getCurrentTimetable).mockResolvedValue({} as any);
    vi.mocked(api.getYellowCardAlerts).mockResolvedValue([] as any);
    vi.mocked(api.getTimeoutEscalations).mockResolvedValue({ totalPendingCount: 0 } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
  });

  it('opens on the first login and records the release as seen', async () => {
    renderApp();

    expect(await screen.findByTestId('whats-new-stub')).toBeInTheDocument();
    expect(window.localStorage.getItem(whatsNewStorageKey('teacher'))).toBe('true');
    expect(whatsNewStorageKey('teacher')).toContain(LATEST_RELEASE.version);
  });

  it('stays closed for a teacher who has already seen this release', async () => {
    window.localStorage.setItem(whatsNewStorageKey('teacher'), 'true');

    renderApp();

    // The banner only renders after auth; the notice effect has run by then.
    await screen.findByRole('banner');
    expect(screen.queryByTestId('whats-new-stub')).toBeNull();
  });
});
