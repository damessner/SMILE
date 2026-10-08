import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import * as api from './services/api';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ThemeProvider } from './components/ThemeToggle';
import { ToastProvider } from './components/Toast';

vi.mock('./services/api', () => ({
  SESSION_EXPIRED_EVENT: 'smile-session-expired',
  getMe: vi.fn(),
  getClasses: vi.fn(),
  getClassPupils: vi.fn(),
  getClassRubric: vi.fn(),
  getYellowCardAlerts: vi.fn(),
  saveStatus: vi.fn(),
  submitEvaluation: vi.fn(),
  reopenEvaluation: vi.fn(),
  batchUpdateItems: vi.fn(),
  getCurrentTimetable: vi.fn(),
  getTimeoutEscalations: vi.fn(),
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
    isLockedByConference: false,
    sendFocus: vi.fn(),
    sendBlur: vi.fn(),
    sendRating: vi.fn(),
  }),
}));

vi.mock('./components/LoginModal', () => ({
  LoginModal: () => <div role="dialog">Login zur erneuten Anmeldung</div>,
}));

vi.mock('./components/OnboardingTour', () => ({
  OnboardingTour: () => null,
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

describe('App session and alert recovery', () => {
  beforeEach(() => {
    vi.mocked(api.getMe).mockResolvedValue(user as any);
    vi.mocked(api.getClasses).mockResolvedValue([] as any);
    vi.mocked(api.getCurrentTimetable).mockResolvedValue({} as any);
    vi.mocked(api.getYellowCardAlerts).mockResolvedValue([] as any);
    vi.mocked(api.getTimeoutEscalations).mockResolvedValue({ totalPendingCount: 0 } as any);
  });

  afterEach(() => vi.clearAllMocks());

  it('shows an alert-load error and a retry action instead of an empty-state silence', async () => {
    vi.mocked(api.getYellowCardAlerts).mockRejectedValue(new Error('Alerts unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderApp();

    expect(await screen.findByRole('alert')).toHaveTextContent('Alerts unavailable');
    expect(screen.getByRole('button', { name: 'Erneut versuchen' })).toBeInTheDocument();
    errorSpy.mockRestore();
  });

  it('returns to the login dialog when a protected API call reports session expiry', async () => {
    renderApp();
    await waitFor(() => expect(api.getClasses).toHaveBeenCalled());

    act(() => window.dispatchEvent(new Event('smile-session-expired')));

    expect(await screen.findByRole('dialog')).toHaveTextContent('Login zur erneuten Anmeldung');
  });

  it('reloads authoritative pupil data after a batch OCC conflict before another rating write', async () => {
    const schoolClass = {
      id: 1,
      name: '1A',
      grade: 1,
      canRate: true,
      canAccessRaster: true,
      mySubjects: [{ code: 'D', name: 'Deutsch', isCoreSmile: true }],
    };
    const initialPupils = [{
      id: 7,
      classId: 1,
      fullName: 'Anna Muster',
      isArchived: false,
      evaluations: [{
        id: 'eval-d', roundId: 'round-1', pupilId: 7, classId: 1, subjectCode: 'D',
        teacherId: 1, isSubmitted: false, items: [{ itemKey: 'org_1', rating: 'sad', version: 1 }],
      }],
      cards: [],
      greenCardCount: 0,
      yellowCardCount: 0,
      redCardCount: 0,
    }];
    const refreshedPupils = [{
      ...initialPupils[0],
      evaluations: [{
        ...initialPupils[0].evaluations[0],
        items: [{ itemKey: 'org_1', rating: 'smile', version: 2 }],
      }],
    }];
    vi.mocked(api.getClasses).mockResolvedValue([schoolClass] as any);
    vi.mocked(api.getClassPupils)
      .mockResolvedValueOnce({ pupils: initialPupils, submissionDeadline: '2099-01-01T00:00:00.000Z' } as any)
      .mockResolvedValueOnce({ pupils: refreshedPupils, submissionDeadline: '2099-01-01T00:00:00.000Z' } as any)
      .mockResolvedValue({ pupils: refreshedPupils, submissionDeadline: '2099-01-01T00:00:00.000Z' } as any);
    vi.mocked(api.getClassRubric).mockResolvedValue({
      criteria: [{ id: 'org', name: 'Organisation', position: 1, items: [{ key: 'org_1' }] }],
    } as any);
    vi.mocked(api.batchUpdateItems)
      .mockRejectedValueOnce(Object.assign(new Error('Konflikt'), { code: 'CONFLICT' }))
      .mockResolvedValue({ success: true, items: [] } as any);

    renderApp();
    await screen.findByTitle('Gut (😊)');
    fireEvent.click(screen.getByTitle(/Alle Merkmale dieser Kategorie mit Krone/));
    await waitFor(() => expect(api.getClassPupils).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByTitle(/Alle Merkmale dieser Kategorie mit Krone/));
    await waitFor(() => expect(api.batchUpdateItems).toHaveBeenCalledTimes(2));

    expect(api.batchUpdateItems).toHaveBeenNthCalledWith(2, 7, 1, 'D', [
      { criterionId: 'org', itemKey: 'org_1', rating: 'crown', version: 2 },
    ]);
  });
});
