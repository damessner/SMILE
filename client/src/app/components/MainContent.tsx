import { lazy, Suspense } from 'react';
import { AlertTriangle, Users } from 'lucide-react';
import { Button, EmptyState, Skeleton } from '../../components/ui';
import type { PupilWithData, RubricCriterion, SchoolClass, User } from '../../types';
import { BeobachtungsGrid } from '../../components/BeobachtungsGrid';
import type { BeobachtungsGridProps } from '../../components/beobachtungsGrid/types';
import { Schulalltag } from '../../components/Schulalltag';
import type { AppModals } from '../hooks/useAppModals';
import type { AppTab } from '../types';

const SchoolStatistics = lazy(() =>
  import('../../components/SchoolStatistics').then((m) => ({ default: m.SchoolStatistics })),
);
const WebUntisView = lazy(() =>
  import('../../features/webuntis/WebUntisView').then((m) => ({ default: m.WebUntisView })),
);

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
  schulalltagView?: 'class' | 'lw' | 'all';
  onSchulalltagViewChange?: (view: 'class' | 'lw' | 'all') => void;
  onLwActiveCountChange?: (count: number) => void;
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
  schulalltagView,
  onSchulalltagViewChange,
  onLwActiveCountChange,
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
    return (
      <Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">Statistik wird geladen...</div>}>
        <SchoolStatistics currentUser={currentUser} />
      </Suspense>
    );
  }
  if (activeTab === 'webuntis') {
    return (
      <Suspense fallback={<div className="p-8 text-center text-sm text-slate-400">WebUntis wird geladen...</div>}>
        <WebUntisView
          currentClass={currentClass}
          classes={classes}
          currentUser={currentUser}
          pupils={pupils}
        />
      </Suspense>
    );
  }
  if (loadingClass && pupils.length === 0) {
    // Layout-matched skeleton: the grid's shape appears immediately, so the table
    // does not jump when the roster lands.
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Klassendaten werden geladen">
        <div className="surface-1 rounded-2xl p-4 flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-2xl" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
        </div>
        <div className="surface-1 rounded-2xl overflow-hidden">
          {Array.from({ length: 6 }).map((_, row) => (
            <div
              key={row}
              className="flex items-center gap-3 px-4 py-3 border-b border-hairline last:border-b-0"
            >
              <Skeleton className="h-9 w-9 rounded-xl" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-1/3" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="hidden sm:flex gap-1.5">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="h-9 w-9 rounded-xl" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (classLoadError && pupils.length === 0) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6 text-rose-400" />}
        title="Klassendaten nicht verfügbar."
        description={classLoadError}
        action={<Button variant="secondary" onClick={onRetryClass}>Erneut laden</Button>}
      />
    );
  }
  if (classListError && !currentClass) {
    return (
      <EmptyState
        icon={<AlertTriangle className="h-6 w-6 text-rose-400" />}
        title="Klassenliste nicht verfügbar."
        description={classListError}
        action={<Button variant="secondary" onClick={onRetryClassList}>Erneut laden</Button>}
      />
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
          viewMode={schulalltagView}
          onViewModeChange={onSchulalltagViewChange}
          onActiveTimeoutCountChange={onLwActiveCountChange}
        />
      );
    }
    if (classListError) {
      // A failed class-list load must never be rendered as an empty school: that
      // reads as "you have no classes" and sends the teacher looking for a
      // permissions problem that does not exist.
      return (
        <EmptyState
          icon={<AlertTriangle className="h-6 w-6 text-rose-400" />}
          title="Klassenliste nicht verfügbar."
          description={classListError}
          action={<Button variant="secondary" onClick={onRetryClassList}>Erneut laden</Button>}
        />
      );
    }
    return (
      <EmptyState
        icon={<Users className="h-6 w-6" aria-hidden="true" />}
        title="Keine Klassen zugewiesen oder verfügbar."
        description="Sobald Ihrem Konto Klassen zugeordnet sind, erscheinen sie hier."
      />
    );
  }
  if (currentClass) {
    return (
      <div aria-busy={loadingClass}>
        {loadingClass && (
          // A live-sync refresh keeps the grid readable; this strip says the data on
          // screen is being replaced, instead of silently swapping it out.
          <div
            role="status"
            aria-label="Klassendaten werden aktualisiert"
            className="mb-2 h-1 overflow-hidden rounded-full bg-slate-800"
          >
            <div className="h-full w-1/3 animate-loading-bar rounded-full bg-amber-400" />
          </div>
        )}
        {classLoadError && (
          <div
            role="alert"
            className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 flex items-center justify-between gap-3"
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
      </div>
    );
  }
  return null;
}
