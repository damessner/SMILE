import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useClassData } from './useClassData';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  getClasses: vi.fn(),
  getClassPupils: vi.fn(),
  getClassRubric: vi.fn(),
  getCurrentTimetable: vi.fn(),
}));

const testUser = {
  id: 'u1',
  username: 'teacher',
  role: 'teacher' as const,
  teacherId: 10,
};

describe('useClassData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    vi.mocked(api.getClassPupils).mockResolvedValue({
      pupils: [],
      submissionDeadline: null,
      isLockedByConference: false,
      canRate: true,
    });
    vi.mocked(api.getClassRubric).mockResolvedValue({ criteria: [] });
  });

  it('does not let a delayed timetable auto-detect overwrite a manual class selection', async () => {
    vi.mocked(api.getClasses).mockResolvedValue([
      { id: 1, name: '1A', grade: 1, canRate: true },
      { id: 2, name: '2B', grade: 2, canRate: true },
      { id: 3, name: '3C', grade: 3, canRate: true },
    ]);

    let resolveTimetable!: (v: any) => void;
    vi.mocked(api.getCurrentTimetable).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveTimetable = resolve;
        }),
    );

    const refreshYellowCardAlerts = vi.fn().mockResolvedValue(undefined);
    const seedClassSyncState = vi.fn();

    const { result } = renderHook(() =>
      useClassData({ refreshYellowCardAlerts, seedClassSyncState }),
    );

    let loadPromise!: Promise<void>;
    act(() => {
      loadPromise = result.current.loadClasses(testUser);
    });

    await waitFor(() => {
      expect(result.current.selectedClassId).toBe(1);
    });

    const firstLoadClassDataRef = result.current.loadClassData;

    // User manually selects 3C before timetable responds with 2B.
    act(() => {
      result.current.setSelectedClassId(3);
    });
    expect(result.current.selectedClassId).toBe(3);

    await act(async () => {
      resolveTimetable({
        currentSlot: { classes: [{ id: 2, name: '2B' }] },
      });
      await loadPromise;
    });

    expect(result.current.selectedClassId).toBe(3);
    expect(result.current.loadClassData).toBe(firstLoadClassDataRef);
  });

  it('initializes selectedClassId from ?class= URL param, resists timetable override, and syncs updates', async () => {
    window.history.replaceState(null, '', '/?class=2');
    vi.mocked(api.getClasses).mockResolvedValue([
      { id: 1, name: '1A', grade: 1, canRate: true },
      { id: 2, name: '2B', grade: 2, canRate: true },
      { id: 3, name: '3C', grade: 3, canRate: true },
    ]);
    vi.mocked(api.getCurrentTimetable).mockResolvedValue({
      currentSlot: { classes: [{ id: 1, name: '1A' }] },
    });

    const { result } = renderHook(() =>
      useClassData({
        refreshYellowCardAlerts: vi.fn().mockResolvedValue(undefined),
        seedClassSyncState: vi.fn(),
      }),
    );

    await act(async () => {
      await result.current.loadClasses(testUser);
    });

    expect(result.current.selectedClassId).toBe(2);
    expect(window.location.search).toBe('?class=2');

    act(() => {
      result.current.setSelectedClassId(3);
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?class=3');
    });

    act(() => {
      result.current.clearClassState();
    });

    expect(window.location.search).toBe('');
  });
});
