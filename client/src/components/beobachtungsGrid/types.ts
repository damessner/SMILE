import type { PupilWithData, RubricCriterion } from '../../types';
import type { ConflictEvent, SoftLock } from '../../hooks/useLiveSync';

export type GridSubject = { code: string; name: string; isCoreSmile: boolean; hours?: number };

export interface BeobachtungsGridProps {
  pupils: PupilWithData[];
  criteria: RubricCriterion[];
  softLocks: Map<string, SoftLock>;
  conflict: ConflictEvent | null;
  onClearConflict: () => void;
  onSendFocus: (pupilId: number, itemKey: string, subjectCode: string) => void;
  onSendBlur: (pupilId: number, itemKey: string, subjectCode: string) => void;
  onRate: (
    pupilId: number,
    criterionId: string,
    itemKey: string,
    rating: string,
    expectedVersion: number,
    subjectCode: string
  ) => void | Promise<void>;
  onOpenCardDrawer: (pupilId: number, name: string) => void;
  onOpenKelReport: (pupil: PupilWithData) => void;
  isLockedByConference: boolean;
  canRate?: boolean;
  canAccessRaster?: boolean;
  submissionDeadline?: string | null;
  mySubjects?: GridSubject[];
  selectedPupilIdProp?: number | null;
  onSubmitPupil?: (pupilId: number, proposedStatus?: string, comment?: string, subjectCode?: string) => Promise<void>;
  onReopenPupil?: (pupilId: number, subjectCode?: string) => Promise<void>;
  onBatchUpdate?: (pupilId: number, items: Array<{ criterionId: string; itemKey: string; rating: string; version: number }>, subjectCode?: string) => Promise<void>;
  onOpenReportModal?: () => void;
}

/**
 * A conference comment waiting to be persisted, captured against the pupil and
 * subjects it was typed for - not against the pupil currently on screen.
 */
export interface PendingComment {
  pupilId: number;
  classId: number;
  subjectCodes: string[];
  /**
   * The `commentScopeKey` this pending was typed under. The write outlives the
   * render that issued it, so this is what says whose ref a successful write may
   * update - see the `commentScopeKeyRef` guard in `flushComment`.
   */
  scopeKey: string;
  /** What the box holds right now. Empty only when `clearRequested` is set. */
  comment: string;
  /**
   * The teacher emptied the box. At a flush boundary this deletes the stored
   * justification; on a keystroke it does nothing, so a half-finished
   * Ctrl+A cannot wipe data the server still holds.
   */
  clearRequested: boolean;
}

export interface SubmitNotice {
  pupilName: string;
  nextPupilName: string | null;
  allDone: boolean;
  pendingSubjects?: string[];
  submittedAny?: boolean;
}

export type FolderTab = 'offen' | 'bewertet';
