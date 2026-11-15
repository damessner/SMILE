import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';
import type { PupilWithData, RubricCriterion, SchoolClass, User } from '../../types';
import { getClasses, getClassPupils, getClassRubric, getCurrentTimetable } from '../../services/api';
import { setActiveRubricConfig } from '../../lib/rubricConfig';
import type { ClassSyncState } from '../../hooks/useLiveSync';
import { isOpenableClass, pickTimetableClassId } from '../helpers';

function readClassIdFromUrl(): number | null {
  if (typeof window === 'undefined') return null;
  const raw = new URLSearchParams(window.location.search).get('class');
  if (!raw || !/^\d+$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function writeClassIdToUrl(classId: number | null): void {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  if (classId && classId > 0) {
    url.searchParams.set('class', String(classId));
  } else {
    url.searchParams.delete('class');
  }
  const nextRelative = `${url.pathname}${url.search}${url.hash}`;
  const currentRelative = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextRelative !== currentRelative) {
    window.history.replaceState(window.history.state, '', nextRelative);
  }
}

export interface UseClassDataOptions {
  refreshYellowCardAlerts: () => Promise<void>;
  /** Seeds the live-sync lock/permission state for a class from the roster. */
  seedClassSyncState: (classId: number, patch: Partial<ClassSyncState>) => void;
}

/**
 * Class list, selected class and the class roster (pupils, criteria, deadline).
 */
export function useClassData({ refreshYellowCardAlerts, seedClassSyncState }: UseClassDataOptions) {
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classListError, setClassListError] = useState<string | null>(null);
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [pupils, setPupils] = useState<PupilWithData[]>([]);
  const [criteria, setCriteria] = useState<RubricCriterion[]>([]);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);
  const [loadingClass, setLoadingClass] = useState(false);
  const [classLoadError, setClassLoadError] = useState<string | null>(null);
  const loadedClassIdRef = useRef<number | null>(null);
  const seedClassSyncStateRef = useRef(seedClassSyncState);
  seedClassSyncStateRef.current = seedClassSyncState;
  const userSelectedClassRef = useRef(false);

  const selectClass = useCallback((next: SetStateAction<number | null>) => {
    userSelectedClassRef.current = true;
    setSelectedClassId(next);
  }, []);

  // Guards against out-of-order class loads.
  //
  // `loadClassData` is fired from two places that can overlap: the class-change effect,
  // and eleven WebSocket broadcast types that each trigger a full refetch. Without this
  // guard two in-flight loads can resolve in the opposite order to their start order, and
  // the slower one overwrites the pupils/criteria/deadline of the class the user actually
  // selected. The guard is a monotonically increasing generation rather than an
  // AbortController so that a *coalesced* refetch of the class already on screen is still
  // allowed to replace stale local state.
  const classLoadGenerationRef = useRef(0);

  const loadClassData = useCallback(async (cid: number) => {
    const generation = ++classLoadGenerationRef.current;
    const isCurrent = () => classLoadGenerationRef.current === generation;

    // Never render class A's roster under class B's header while B is loading.
    // A live-sync refresh of the same class keeps the grid visible; a switch to a
    // different class clears it immediately.
    if (loadedClassIdRef.current !== cid) {
      setPupils([]);
      setCriteria([]);
      setSubmissionDeadline(null);
      setClassLoadError(null);
    }

    setLoadingClass(true);
    try {
      const [pupilData, rubricData] = await Promise.all([
        getClassPupils(cid),
        getClassRubric(cid),
      ]);
      if (!isCurrent()) return;
      loadedClassIdRef.current = cid;
      setClassLoadError(null);
      setPupils(pupilData.pupils);
      setCriteria(rubricData.criteria);
      setSubmissionDeadline(
        typeof pupilData.submissionDeadline === 'string' ? pupilData.submissionDeadline : null,
      );
      // The roster also carries the rubric thresholds and item count the server
      // ranked with. Installing them here means every raster computation below
      // agrees with `lib/ranking.ts` instead of with a second, copied constant.
      setActiveRubricConfig(pupilData.rubricConfig);
      // Seed the sync state from the roster so a locked (or non-ratable) class
      // never shows a writable grid during the round trip until the first SYNCED.
      seedClassSyncStateRef.current(cid, {
        isLocked: Boolean(pupilData.isLockedByConference),
        canRate: typeof pupilData.canRate === 'boolean' ? pupilData.canRate : null,
      });
    } catch (e) {
      // A superseded load must not surface an error or clear the visible class.
      if (!isCurrent()) return;
      console.error(e);
      setClassLoadError(
        'Die Klassendaten konnten nicht geladen werden. Bitte die Verbindung prüfen und erneut versuchen.',
      );
    } finally {
      if (isCurrent()) setLoadingClass(false);
    }
  }, []);

  useEffect(() => {
    if (selectedClassId) {
      loadClassData(selectedClassId);
      writeClassIdToUrl(selectedClassId);
    }
  }, [selectedClassId, loadClassData]);

  const loadClasses = async (user: User) => {
    try {
      setClassListError(null);
      const cls = await getClasses();
      const validClasses = cls.filter((c: any) => isOpenableClass(c));
      setClasses(validClasses);

      const urlClassId = readClassIdFromUrl();
      const hasUrlClass = urlClassId !== null && validClasses.some((c: any) => c.id === urlClassId);
      let targetClassId = hasUrlClass ? urlClassId : (validClasses[0]?.id || null);
      userSelectedClassRef.current = hasUrlClass;

      // Select the fallback class first: a slow or hung timetable endpoint must
      // not leave the user with a class header and no roster request.
      if (validClasses.length > 0 && targetClassId) {
        setSelectedClassId(targetClassId);
      }

      // Auto-detect class based on current timetable. If it names another class,
      // move there once the answer arrives (unless the user already picked one).
      try {
        const tt = await getCurrentTimetable();
        const detected = pickTimetableClassId(validClasses, tt, targetClassId);
        if (!userSelectedClassRef.current && detected && detected !== targetClassId) {
          targetClassId = detected;
          setSelectedClassId(detected);
        }
      } catch (ttErr) {
        console.error('Timetable auto-detect error:', ttErr);
      }

      // Alert failures are tracked separately from the class-list request so an
      // unavailable alert endpoint is never presented as an empty alert list.
      void refreshYellowCardAlerts();
    } catch (e) {
      // Do not present a failed class-list load as an empty school. `refreshYellowCardAlerts`
      // already models this explicitly; the class list has to as well.
      console.error(e);
      setClassListError(
        'Die Klassenliste konnte nicht geladen werden. Bitte die Verbindung prüfen und neu laden.',
      );
    }
  };

  /** Empties the class context. Shared by logout and session expiry. */
  const clearClassState = useCallback(() => {
    classLoadGenerationRef.current += 1;
    loadedClassIdRef.current = null;
    userSelectedClassRef.current = false;
    setClasses([]);
    setSelectedClassId(null);
    writeClassIdToUrl(null);
    setPupils([]);
    setCriteria([]);
    setSubmissionDeadline(null);
    setClassLoadError(null);
    setLoadingClass(false);
  }, []);

  return {
    classes,
    classListError,
    selectedClassId,
    setSelectedClassId: selectClass,
    pupils,
    setPupils,
    criteria,
    submissionDeadline,
    loadingClass,
    classLoadError,
    setLoadingClass,
    loadClassData,
    loadClasses,
    clearClassState,
  };
}
