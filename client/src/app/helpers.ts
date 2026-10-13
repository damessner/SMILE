import type { getCurrentTimetable } from '../services/api';
import type { SchoolClass, User } from '../types';

export type TimetableSnapshot = Awaited<ReturnType<typeof getCurrentTimetable>>;

/** Hides the 'LW' placeholder class and classes with a non-positive grade. */
export function isOpenableClass(cls: any): boolean {
  return cls.name !== 'LW' && (cls.grade === undefined || cls.grade > 0);
}

/**
 * Picks the class to open from the current/next lesson. Falls back to `fallbackId`
 * when the timetable names no usable class; the core-class fallback applies only when
 * neither the current nor the next lesson names one.
 */
export function pickTimetableClassId(
  validClasses: SchoolClass[],
  tt: TimetableSnapshot,
  fallbackId: number | null,
): number | null {
  const currentClassName = tt.currentLesson?.className || tt.currentLesson?.class_name;
  const nextClassName = tt.nextLesson?.className || tt.nextLesson?.class_name;

  if (currentClassName && currentClassName !== 'LW') {
    const matched = validClasses.find((c: any) => c.name === currentClassName);
    return matched ? matched.id : fallbackId;
  }
  if (nextClassName && nextClassName !== 'LW') {
    const matched = validClasses.find((c: any) => c.name === nextClassName);
    return matched ? matched.id : fallbackId;
  }
  const coreClass = validClasses.find((c: any) => c.canAccessRaster);
  return coreClass ? coreClass.id : fallbackId;
}

/**
 * School leadership = Schulleitung (SLC, MED) plus the system administrator.
 *
 * This is the gate for the conference mode and the escalation dashboard. Both
 * must derive from this single definition so the badge and the modal agree.
 */
export function isSchoolLeadershipUser(user: User | null): boolean {
  const teacherShort = user?.teacher?.shortName?.toUpperCase();
  return (
    user?.role === 'admin' ||
    teacherShort === 'MED' ||
    teacherShort === 'SLC' ||
    user?.username?.toUpperCase() === 'MED' ||
    user?.username?.toUpperCase() === 'SLC'
  );
}

export function getActiveSubjectCode(currentClass: SchoolClass | null): string {
  return currentClass?.mySubjects?.[0]?.code || 'D';
}

/**
 * Whether the caller may write `subjectCode` (or the active subject) in the current class.
 * `canRateCurrentClass` must already combine the roster and live-sync verdicts.
 */
export function canWriteSubjectInClass(
  currentClass: SchoolClass | null,
  canRateCurrentClass: boolean,
  isHeadmaster: boolean,
  subjectCode?: string,
): boolean {
  if (!canRateCurrentClass) return false;
  if (isHeadmaster) return true;
  const requestedSubject = subjectCode || getActiveSubjectCode(currentClass);
  return currentClass?.mySubjects?.some((subject) => subject.code === requestedSubject) === true;
}

export function buildBackupFileName(now: Date): string {
  return `smile-backup-${now.toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
}
