import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from './App';
import * as api from './services/api';
import { ConfirmProvider } from './components/ConfirmDialog';
import { ThemeProvider } from './components/ThemeToggle';
import { ToastProvider } from './components/Toast';
import { resetActiveRubricConfig } from './lib/rubricConfig';
import { scoreSubject } from './lib/pupilItems';

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

const liveSyncMock = {
  canRate: true as boolean | null,
  setClassSyncState: vi.fn(),
};

vi.mock('./hooks/useLiveSync', () => ({
  useLiveSync: () => ({
    isConnected: true,
    canRate: liveSyncMock.canRate,
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
    setClassSyncState: liveSyncMock.setClassSyncState,
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

  afterEach(() => resetActiveRubricConfig());

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

  it('seeds the live-sync lock state from the roster so a locked class never shows a writable grid', async () => {
    const schoolClass = {
      id: 1,
      name: '1A',
      grade: 1,
      canRate: true,
      canAccessRaster: true,
      mySubjects: [{ code: 'D', name: 'Deutsch', isCoreSmile: true }],
    };
    vi.mocked(api.getClasses).mockResolvedValue([schoolClass] as any);
    vi.mocked(api.getClassPupils).mockResolvedValue({
      pupils: [],
      submissionDeadline: '2099-01-01T00:00:00.000Z',
      roundId: 'round-42',
      isLockedByConference: true,
      canRate: false,
      rubricConfig: { meister: 14, geselle: 8, itemCount: 18, aggregation: 'total' },
    } as any);
    vi.mocked(api.getClassRubric).mockResolvedValue({
      criteria: [{ id: 'org', name: 'Organisation', position: 1, items: [{ key: 'org_1' }] }],
    } as any);

    renderApp();

    // Only the two values the live-sync state actually carries: the lock and the
    // caller's write permission. `roundId` used to be mirrored here as well; it
    // was never read, so it is no longer part of the contract even though the
    // roster payload still sends it.
    await waitFor(() =>
      expect(liveSyncMock.setClassSyncState).toHaveBeenCalledWith(
        1,
        expect.objectContaining({ isLocked: true, canRate: false }),
      ),
    );
  });

  it('installs the rubric thresholds the roster delivers so the grid ranks like the server', async () => {
    // The thresholds are server configuration. Installing them on arrival is what
    // keeps `scoreSubject` from ranking with its own copy of the numbers, which
    // is how a deployment that raised RANK_THRESHOLD_MEISTER would show Meister
    // on screen while `lib/ranking.ts` stores Lehrling.
    const schoolClass = {
      id: 1,
      name: '1A',
      grade: 1,
      canRate: true,
      canAccessRaster: true,
      mySubjects: [{ code: 'D', name: 'Deutsch', isCoreSmile: true }],
    };
    vi.mocked(api.getClasses).mockResolvedValue([schoolClass] as any);
    vi.mocked(api.getClassPupils).mockResolvedValue({
      pupils: [],
      submissionDeadline: '2099-01-01T00:00:00.000Z',
      isLockedByConference: false,
      canRate: true,
      rubricConfig: { meister: 20, geselle: 12, itemCount: 24, aggregation: 'normalized' },
    } as any);
    vi.mocked(api.getClassRubric).mockResolvedValue({ criteria: [] } as any);

    renderApp();

    await waitFor(() => {
      // 16 positives clears the shipped Meister threshold of 14 but not the
      // delivered one of 20, so only a live config install changes the answer.
      const positives = Array.from({ length: 16 }, (_, i) => ({
        itemKey: `k${i + 1}`,
        rating: 'smile',
        updatedAt: '2026-10-07T06:00:00.000Z',
      }));
      const scored = scoreSubject(
        [{ id: 'e1', subjectCode: 'D', items: positives } as never],
        'D',
        positives.map((i) => i.itemKey),
      );
      expect(scored.rank).toBe('Geselle');
    });
  });

  it('treats an unknown canRate as read-only instead of writable', async () => {
    liveSyncMock.canRate = null;
    const schoolClass = {
      id: 1,
      name: '1A',
      grade: 1,
      canRate: true,
      canAccessRaster: true,
      mySubjects: [{ code: 'D', name: 'Deutsch', isCoreSmile: true }],
    };
    vi.mocked(api.getClasses).mockResolvedValue([schoolClass] as any);
    vi.mocked(api.getClassPupils).mockResolvedValue({
      pupils: [{
        id: 7,
        classId: 1,
        fullName: 'Anna Muster',
        isArchived: false,
        evaluations: [],
        cards: [],
        greenCardCount: 0,
        yellowCardCount: 0,
        redCardCount: 0,
      }],
      submissionDeadline: '2099-01-01T00:00:00.000Z',
      roundId: 'round-1',
      isLockedByConference: false,
      canRate: true,
    } as any);
    vi.mocked(api.getClassRubric).mockResolvedValue({
      criteria: [{ id: 'org', name: 'Organisation', position: 1, items: [{ key: 'org_1' }] }],
    } as any);

    renderApp();

    const quickFill = await screen.findByTitle(/Alle Merkmale dieser Kategorie mit Krone/);
    expect(quickFill).toBeDisabled();
    liveSyncMock.canRate = true;
  });
});
