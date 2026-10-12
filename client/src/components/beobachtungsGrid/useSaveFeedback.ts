import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingComment } from './types';

export function useSaveFeedback() {
  const pendingCommentRef = useRef<PendingComment | null>(null);

  // Autosave and feedback state
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<Date | null>(null);
  const [ratingSaveError, setRatingSaveError] = useState<string | null>(null);
  const pendingSaveCountRef = useRef(0);
  const saveGenerationRef = useRef(0);
  const saveFailedRef = useRef(false);
  const saveFeedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A comment write can outlive the grid: the flush it belongs to is issued
  // moments before the tree goes away and resolves afterwards.
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const cancelSavedFeedback = useCallback(() => {
    if (saveFeedbackTimerRef.current) clearTimeout(saveFeedbackTimerRef.current);
    saveFeedbackTimerRef.current = null;
    saveGenerationRef.current++;
  }, []);

  const beginSave = useCallback(() => {
    cancelSavedFeedback();
    if (pendingSaveCountRef.current === 0 && pendingCommentRef.current === null) {
      saveFailedRef.current = false;
      if (isMountedRef.current) setRatingSaveError(null);
    }
    pendingSaveCountRef.current++;
    if (isMountedRef.current) {
      setIsSaving(true);
      setLastSavedTime(null);
    }
  }, [cancelSavedFeedback]);

  const markPendingComment = useCallback(() => {
    cancelSavedFeedback();
    if (pendingSaveCountRef.current === 0) {
      saveFailedRef.current = false;
      setRatingSaveError(null);
    }
    setIsSaving(true);
    setLastSavedTime(null);
  }, [cancelSavedFeedback]);

  const clearPendingCommentFeedback = useCallback(() => {
    cancelSavedFeedback();
    if (pendingSaveCountRef.current === 0) setIsSaving(false);
  }, [cancelSavedFeedback]);

  const markSaved = useCallback(() => {
    if (!isMountedRef.current) return;
    if (pendingSaveCountRef.current > 0 || pendingCommentRef.current !== null) {
      setIsSaving(true);
      return;
    }
    if (saveFailedRef.current) {
      setIsSaving(false);
      return;
    }

    cancelSavedFeedback();
    const generation = saveGenerationRef.current;
    setIsSaving(true);
    saveFeedbackTimerRef.current = setTimeout(() => {
      if (
        !isMountedRef.current ||
        generation !== saveGenerationRef.current ||
        pendingSaveCountRef.current > 0 ||
        pendingCommentRef.current !== null
      ) return;
      saveFeedbackTimerRef.current = null;
      setIsSaving(false);
      setLastSavedTime(new Date());
      setRatingSaveError(null);
    }, 350);
  }, []);

  const finishSave = useCallback((error?: unknown) => {
    pendingSaveCountRef.current = Math.max(0, pendingSaveCountRef.current - 1);
    if (error) {
      saveFailedRef.current = true;
      if (isMountedRef.current) {
        setRatingSaveError(error instanceof Error ? error.message : 'Speichern fehlgeschlagen.');
      }
    }
    if (!isMountedRef.current) return;
    if (pendingSaveCountRef.current > 0) {
      setIsSaving(true);
      return;
    }
    if (saveFailedRef.current) {
      setIsSaving(false);
      setLastSavedTime(null);
      return;
    }
    markSaved();
  }, [markSaved]);

  return {
    isSaving,
    lastSavedTime,
    ratingSaveError,
    pendingCommentRef,
    beginSave,
    markPendingComment,
    clearPendingCommentFeedback,
    finishSave,
  };
}

export type SaveFeedback = ReturnType<typeof useSaveFeedback>;
