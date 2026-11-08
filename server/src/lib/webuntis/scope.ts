import { getGlobalAccess, type Identity } from '../guards.js';

/**
 * The classes a user may see in WebUntis.
 *
 * The WebUntis endpoints used to accept any `classId`, so a teacher could read
 * another class's absences, events and timetable by typing a different id. The
 * scope is the single place that maps SMILE's class-access matrix onto the
 * WebUntis filter.
 */
export interface WebUntisScope {
  /** `classIds === null` means school-wide (administrator / headmaster). */
  unrestricted: boolean;
  classIds: number[] | null;
  teacherId?: number;
}

export async function buildWebUntisScope(user: Identity): Promise<WebUntisScope> {
  const access = await getGlobalAccess(user);
  return {
    unrestricted: access.classIds === null,
    classIds: access.classIds,
    teacherId: access.teacherId,
  };
}

export function scopeAllowsClass(scope: WebUntisScope, classId: number): boolean {
  return scope.classIds === null || scope.classIds.includes(classId);
}

/**
 * Turn an optional requested class into the list of class ids to query.
 *
 * Returns `null` for "no class filter" (school-wide), an empty array when the
 * caller asked for a class outside their scope, and otherwise the concrete
 * list. Callers must treat an empty array as "return nothing".
 */
export function scopeClassIds(
  scope: WebUntisScope,
  requestedClassId?: number,
): number[] | null {
  if (requestedClassId !== undefined) {
    return scopeAllowsClass(scope, requestedClassId) ? [requestedClassId] : [];
  }
  return scope.classIds;
}
