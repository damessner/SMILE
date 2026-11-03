import { RefreshCw, AlertTriangle } from 'lucide-react';
import type { PupilWithData, RubricCriterion, SchoolClass, User } from '../../types';
import { BeobachtungsGrid } from '../../components/BeobachtungsGrid';
import type { BeobachtungsGridProps } from '../../components/beobachtungsGrid/types';
import { Schulalltag } from '../../components/Schulalltag';
import { SchoolStatistics } from '../../components/SchoolStatistics';
import type { AppModals } from '../hooks/useAppModals';
import type { AppTab } from '../types';

/** Live-sync values and senders the observation grid consumes. */
export type GridLiveProps = Pick<
  BeobachtungsGridProps,
  'softLocks' | 'conflict' | 'onClearConflict' | 'onSendFocus' | 'onSendBlur' | 'onRate'
>;

export interface MainContentProps {
  activeTab: AppTab;
  loadingClass: boolean;
  classes: SchoolClass[];
  currentClass: SchoolClass | null;
  currentUser: User;
  pupils: PupilWithData[];
  criteria: RubricCriterion[];
  selectedClassId: number | null;
  classListError: string | null;
  classLoadError: string | null;
  submissionDeadline: string | null;
  ratingPupilId: number | null;
  isLockedByConference: boolean;
  canRateCurrentClass: boolean;
  grid: GridLiveProps;
  modals: AppModals;
  onSelectClass: (classId: number) => void;
  onReloadClass: () => void;
  onRetryClassList: () => void;
  onRetryClass: () => void;
  onSubmitPupil: BeobachtungsGridProps['onSubmitPupil'];
  onReopenPupil: BeobachtungsGridProps['onReopenPupil'];
  onBatchUpdate: BeobachtungsGridProps['onBatchUpdate'];
}

/** Routes the main area: statistics, Schulalltag, the observation grid, or a state message. */
export function MainContent({
  activeTab,
  loadingClass,
  classes,
  currentClass,
  currentUser,
  pupils,
  criteria,
  selectedClassId,
  classListError,
  classLoadError,
  submissionDeadline,
  ratingPupilId,
  isLockedByConference,
  canRateCurrentClass,
  grid,
  modals,
  onSelectClass,
  onReloadClass,
  onRetryClassList,
  onRetryClass,
  onSubmitPupil,
  onReopenPupil,
  onBatchUpdate,
}: MainContentProps) {
  const { setActiveCardDrawer, setActiveKelPupil, setTeacherReportModalOpen } = modals;

  if (activeTab === 'statistics') {
    return <SchoolStatistics initialClassId={selectedClassId} />;
  }
  if (loadingClass && pupils.length === 0) {
    return (
      <div className="h-64 flex items-center justify-center text-slate-500">
        <RefreshCw className="w-6 h-6 animate-spin text-amber-400 mr-2" />
        <span>Lade Schülerdaten...</span>
      </div>
    );
  }
  if (classLoadError && pupils.length === 0) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="font-bold">Klassendaten nicht verfügbar.</p>
        <p className="text-sm text-center max-w-md">{classLoadError}</p>
        <button
          type="button"
          onClick={onRetryClass}
          className="mt-2 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
        >
          Erneut laden
        </button>
      </div>
    );
  }
  if (classListError && !currentClass) {
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="font-bold">Klassenliste nicht verfügbar.</p>
        <p className="text-sm text-center max-w-md">{classListError}</p>
        <button
          type="button"
          onClick={onRetryClassList}
          className="mt-2 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
        >
          Erneut laden
        </button>
      </div>
    );
  }
  if (activeTab === 'schulalltag') {
    if (currentClass) {
      return (
        <Schulalltag
          currentClass={currentClass}
          classes={classes}
          pupils={pupils}
          currentUser={currentUser}
          onSelectClass={(cid) => onSelectClass(cid)}
          onRefreshClassData={onReloadClass}
          criteria={criteria}
        />
      );
    }
    if (classListError) {
      // A failed class-list load must never be rendered as an empty school: that
      // reads as "you have no classes" and sends the teacher looking for a
      // permissions problem that does not exist.
      return (
        <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
          <AlertTriangle className="w-8 h-8 text-red-400" />
          <p className="font-bold">Klassenliste nicht verfügbar.</p>
          <p className="text-sm text-center max-w-md">{classListError}</p>
          <button
            type="button"
            onClick={onRetryClassList}
            className="mt-2 px-3 py-1.5 rounded bg-slate-700 hover:bg-slate-600 text-sm"
          >
            Erneut laden
          </button>
        </div>
      );
    }
    return (
      <div className="h-64 flex flex-col items-center justify-center text-slate-400 gap-2">
        <AlertTriangle className="w-8 h-8 text-amber-400" />
        <p className="font-bold">Keine Klassen zugewiesen oder verfügbar.</p>
      </div>
    );
  }
  if (currentClass) {
    return (
      <>
        {classLoadError && (
          <div
            role="alert"
            className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200 flex items-center justify-between gap-3"
          >
            <span>{classLoadError}</span>
            <button
              type="button"
              onClick={onRetryClass}
              className="underline underline-offset-2 font-bold shrink-0"
            >
              Erneut laden
            </button>
          </div>
        )}
        <BeobachtungsGrid
        pupils={pupils}
        criteria={criteria}
        softLocks={grid.softLocks}
        conflict={grid.conflict}
        onClearConflict={grid.onClearConflict}
        onSendFocus={grid.onSendFocus}
        onSendBlur={grid.onSendBlur}
        onRate={grid.onRate}
        onOpenCardDrawer={(pupilId, name) => setActiveCardDrawer({ pupilId, name })}
        onOpenKelReport={(pupil) => setActiveKelPupil(pupil)}
        isLockedByConference={isLockedByConference}
        canRate={canRateCurrentClass}
        canAccessRaster={currentClass?.canAccessRaster}
        submissionDeadline={submissionDeadline}
        mySubjects={currentClass?.mySubjects}
        selectedPupilIdProp={ratingPupilId}
        onSubmitPupil={onSubmitPupil}
        onReopenPupil={onReopenPupil}
        onBatchUpdate={onBatchUpdate}
        onOpenReportModal={() => setTeacherReportModalOpen(true)}
        currentTeacherId={currentUser.teacherId}
        />
      </>
    );
  }
  return null;
}
