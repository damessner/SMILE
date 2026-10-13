import { useCallback, useEffect, useRef, useState } from 'react';
import type { PupilWithData, RubricCriterion, SchoolClass, User } from '../../types';
import { getClasses, getClassPupils, getClassRubric, getCurrentTimetable } from '../../services/api';
import { setActiveRubricConfig } from '../../lib/rubricConfig';
import type { ClassSyncState } from '../../hooks/useLiveSync';
import { isOpenableClass, pickTimetableClassId } from '../helpers';

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

  const loadClassData = async (cid: number) => {
    const generation = ++classLoadGenerationRef.current;
    const isCurrent = () => classLoadGenerationRef.current === generation;

    setLoadingClass(true);
    setSubmissionDeadline(null);
    try {
      const [pupilData, rubricData] = await Promise.all([
        getClassPupils(cid),
        getClassRubric(cid),
      ]);
      if (!isCurrent()) return;
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
      seedClassSyncState(cid, {
        isLocked: Boolean(pupilData.isLockedByConference),
        canRate: typeof pupilData.canRate === 'boolean' ? pupilData.canRate : null,
      });
    } catch (e) {
      // A superseded load must not surface an error or clear the visible class.
      if (!isCurrent()) return;
      console.error(e);
    } finally {
      if (isCurrent()) setLoadingClass(false);
    }
  };

  useEffect(() => {
    if (selectedClassId) {
      loadClassData(selectedClassId);
    }
  }, [selectedClassId]);

  const loadClasses = async (user: User) => {
    try {
      setClassListError(null);
      const cls = await getClasses();
      const validClasses = cls.filter((c: any) => isOpenableClass(c));
      setClasses(validClasses);

      let targetClassId = validClasses[0]?.id || null;

      // Auto-detect class based on current timetable
      try {
        const tt = await getCurrentTimetable();
        targetClassId = pickTimetableClassId(validClasses, tt, targetClassId);
      } catch (ttErr) {
        console.error('Timetable auto-detect error:', ttErr);
      }

      if (validClasses.length > 0 && targetClassId) {
        setSelectedClassId(targetClassId);
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
    setClasses([]);
    setSelectedClassId(null);
    setPupils([]);
    setCriteria([]);
    setSubmissionDeadline(null);
  }, []);

  return {
    classes,
    classListError,
    selectedClassId,
    setSelectedClassId,
    pupils,
    setPupils,
    criteria,
    submissionDeadline,
    loadingClass,
    setLoadingClass,
    loadClassData,
    loadClasses,
    clearClassState,
  };
}
