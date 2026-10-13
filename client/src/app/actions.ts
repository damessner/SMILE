import {
  batchUpdateItems,
  exportBackup,
  reopenEvaluation,
  submitEvaluation,
} from '../services/api';
import type { SchoolClass } from '../types';
import type { useToast } from '../components/Toast';
import { buildBackupFileName, getActiveSubjectCode } from './helpers';

type ToastApi = ReturnType<typeof useToast>;

/** Downloads the full JSON backup bundle as a timestamped file. */
export async function downloadBackup(toast: ToastApi): Promise<void> {
  try {
    const bundle = await exportBackup();
    const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = buildBackupFileName(new Date());
    a.click();
    URL.revokeObjectURL(url);
  } catch (e: any) {
    toast.error(e.message || 'Backup konnte nicht erstellt werden');
  }
}

export interface RatingWriteOptions {
  selectedClassId: number | null;
  currentClass: SchoolClass | null;
  canWriteSubject: (subjectCode?: string) => boolean;
  loadClassData: (cid: number) => Promise<void>;
  toast: ToastApi;
}

/**
 * Pupil-level write actions (submit, reopen, batch update). Each one checks the
 * subject-scoped write permission before calling the API, then reloads the class.
 */
export function createRatingWriteHandlers({
  selectedClassId,
  currentClass,
  canWriteSubject,
  loadClassData,
  toast,
}: RatingWriteOptions) {
  const handleSubmitPupil = async (
    pupilId: number,
    proposedStatus?: string,
    comment?: string,
    subjectCode?: string
  ) => {
    if (!selectedClassId) return;
    const activeSub = subjectCode || getActiveSubjectCode(currentClass);
    if (!canWriteSubject(activeSub)) {
      toast.error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
      throw new Error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
    }
    await submitEvaluation(pupilId, selectedClassId, activeSub, proposedStatus, undefined, comment);
    await loadClassData(selectedClassId);
  };

  const handleReopenEvaluation = async (pupilId: number, subjectCode?: string) => {
    if (!selectedClassId) return;
    const activeSub = subjectCode || getActiveSubjectCode(currentClass);
    if (!canWriteSubject(activeSub)) {
      toast.error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
      throw new Error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
    }
    await reopenEvaluation(pupilId, selectedClassId, activeSub);
    await loadClassData(selectedClassId);
    toast.success('Bewertung wieder geöffnet');
  };

  const handleBatchUpdate = async (
    pupilId: number,
    items: Array<{ criterionId: string; itemKey: string; rating: string; version: number }>,
    subjectCode?: string
  ) => {
    if (!selectedClassId) return;
    const activeSub = subjectCode || getActiveSubjectCode(currentClass);
    if (!canWriteSubject(activeSub)) {
      toast.error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
      throw new Error('Sie dürfen dieses Fach in dieser Klasse nicht bewerten.');
    }
    try {
      await batchUpdateItems(pupilId, selectedClassId, activeSub, items);
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code === 'CONFLICT') {
        await loadClassData(selectedClassId);
      }
      throw error;
    }
    await loadClassData(selectedClassId);
  };

  return { handleSubmitPupil, handleReopenEvaluation, handleBatchUpdate };
}
