import { useCallback, useMemo } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { PupilWithData, User } from '../../types';
import { useLiveSync, type LiveSyncEvent } from '../../hooks/useLiveSync';

export interface UseAppLiveSyncOptions {
  selectedClassId: number | null;
  currentUser: User | null;
  loadClassData: (cid: number) => Promise<void>;
  refreshYellowCardAlerts: () => Promise<void>;
  setPupils: Dispatch<SetStateAction<PupilWithData[]>>;
}

/**
 * Wires the live-sync socket to the class roster. Passthrough broadcasts reload the
 * class; rating broadcasts patch the one affected item in place.
 */
export function useAppLiveSync({
  selectedClassId,
  currentUser,
  loadClassData,
  refreshYellowCardAlerts,
  setPupils,
}: UseAppLiveSyncOptions) {
  // Live Sync Callback
  const handleRatingUpdated = useCallback((data: LiveSyncEvent) => {
    if (
      data.type === 'CARD_ISSUED' ||
      data.type === 'CARD_REVOKED' ||
      data.type === 'BATCH_ITEMS_UPDATED' ||
      data.type === 'BATCH_DEFAULTS_APPLIED' ||
      data.type === 'PUPIL_RANKING_SUBMITTED' ||
      data.type === 'PUPIL_RANKING_REOPENED' ||
      data.type === 'STATUS_UPDATED' ||
      data.type === 'TIMEOUT_ISSUED' ||
      data.type === 'TIMEOUT_RESOLVED' ||
      data.type === 'FINAL_RANK_CONFIRMED' ||
      data.type === 'FINAL_RANK_REVOKED'
    ) {
      if (selectedClassId) loadClassData(selectedClassId);
      if (data.type === 'CARD_ISSUED' || data.type === 'CARD_REVOKED') {
        void refreshYellowCardAlerts();
      }
      if (data.type === 'TIMEOUT_ISSUED' || data.type === 'TIMEOUT_RESOLVED') {
        window.dispatchEvent(new CustomEvent('smile:timeouts-updated'));
      }
      return;
    }

    setPupils((prevPupils) => {
      return prevPupils.map((p) => {
        if (p.id !== data.pupilId) return p;

        // update evaluation item
        const updatedEvals = [...p.evaluations];
        let targetEval = updatedEvals.find((e) => e.id === data.evaluationId);
        if (!targetEval) {
          targetEval = {
            id: data.evaluationId,
            roundId: '',
            pupilId: data.pupilId,
            classId: selectedClassId || 0,
            subjectCode: data.subjectCode || 'D',
            teacherId: 0,
            items: [],
          };
          updatedEvals.push(targetEval);
        }

        const updatedItems = [...(targetEval.items || [])];
        const existingIdx = updatedItems.findIndex((it) => it.itemKey === data.itemKey);
        // An HTTP fallback response can arrive after a newer WebSocket event.
        // Never let the older version overwrite the newer cell.
        if (
          existingIdx >= 0 &&
          typeof updatedItems[existingIdx]?.version === 'number' &&
          typeof data.version === 'number' &&
          updatedItems[existingIdx]!.version > data.version
        ) {
          return p;
        }
        const newItem = {
          id: data.itemId || Math.random().toString(),
          evaluationId: data.evaluationId,
          criterionId: '',
          itemKey: data.itemKey,
          rating: data.rating,
          version: data.version,
          updatedAt: data.updatedAt,
        };

        if (existingIdx >= 0) {
          updatedItems[existingIdx] = newItem as any;
        } else {
          updatedItems.push(newItem as any);
        }
        targetEval.items = updatedItems;

        return { ...p, evaluations: updatedEvals };
      });
    });
  }, [selectedClassId, refreshYellowCardAlerts]);

  const liveSyncClassIds = useMemo(() => {
    return selectedClassId ? [selectedClassId, 999] : null;
  }, [selectedClassId]);

  const {
    isConnected,
    canRate: liveCanRate,
    connectionError,
    softLocks,
    conflict,
    clearConflict,
    classRoundLocks,
    isLockedByConference: liveLockedByConference,
    sendFocus,
    sendBlur,
    sendRating,
    setClassSyncState,
  } = useLiveSync(liveSyncClassIds, currentUser, handleRatingUpdated);

  const isLockedByConference = selectedClassId != null
    ? (classRoundLocks?.get(selectedClassId) ?? false)
    : liveLockedByConference;

  return {
    isConnected,
    canRate: liveCanRate,
    connectionError,
    softLocks,
    conflict,
    clearConflict,
    isLockedByConference,
    sendFocus,
    sendBlur,
    sendRating,
    setClassSyncState,
  };
}
