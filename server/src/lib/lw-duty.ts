import {
  getClassAccess,
  getGlobalAccess,
  hasLwDutySlot,
  isSchoolLeader,
  LW_CLASS_ID,
  type Identity,
} from './guards.js';
import { currentPeriod } from './period-times.js';

export { LW_CLASS_ID };

/**
 * Lernwerkstatt duty: who may see the live list of pupils in the room, and who may release
 * them.
 *
 * The room is not a class. A pupil is sent there from whichever class the teacher who
 * clicked was standing in, so the supervisor is almost never the homeroom teacher of the
 * offending class. Scoping these routes by `teaching_assignments` — the obvious "just use
 * the normal class access" fix — therefore produces the worst possible failure for the duty
 * board: the teacher physically in the room is shown "Aktuell keine Schüler im Time-Out!"
 * while pupils from other classes are sitting right there. Authority comes from being on
 * duty, and the duty roster is the timetable.
 *
 * Both routes in `routes/timeouts.ts` consult these helpers, so read and resolve cannot
 * drift apart.
 */

/** True for the teacher holding the LW slot in the running period. */
export async function isLwDutyTeacher(user: Identity, now: Date = new Date()): Promise<boolean> {
  // Pupils are refused here rather than only at the call sites: this is the single entry
  // point to duty, and a crafted token carrying a teacherId must not buy school-wide
  // authority over other classes' pupils.
  if (user.role === 'pupil') return false;
  if (!user.teacherId) return false;
  // Outside the bell schedule nobody is on duty. Checked here so no slot lookup is issued
  // with a stale period in the first place.
  if (!currentPeriod(now).isSchoolHours) return false;
  return hasLwDutySlot(user.teacherId, now);
}

/**
 * May this account hold the Lernwerkstatt WebSocket room (class 999)?
 *
 * Without this, `onSubscribe` refuses room 999 for every teacher *and disconnects the
 * socket*, because no teacher has a `teaching_assignments` row for the LW pseudo-class —
 * which is why the room the time-out routes broadcast to has never reached anyone.
 */
export async function canSeeLwRoom(user: Identity, now: Date = new Date()): Promise<boolean> {
  if (await isSchoolLeader(user)) return true;
  return isLwDutyTeacher(user, now);
}

/**
 * The single rule for both reading a time-out and closing one.
 *
 * A time-out is visible to the duty teacher (whatever class the pupil came from), to the
 * school leadership, and to the teachers responsible for the pupil's own class.
 */
export async function canActOnTimeout(
  user: Identity,
  classId: number,
  now: Date = new Date(),
): Promise<boolean> {
  if (user.role === 'pupil') return false;
  if (await isSchoolLeader(user)) return true;
  if (await isLwDutyTeacher(user, now)) return true;
  return (await getClassAccess(user, classId)).canRecord;
}

export interface TimeoutVisibility {
  /** true → the caller sees the whole school; `classIds` is then null and unused. */
  onDuty: boolean;
  /** null → unrestricted; otherwise the explicit class allowlist. */
  classIds: number[] | null;
  /** true → the account may not read the list at all (pupils). */
  forbidden?: boolean;
}

/**
 * The scope for `GET /api/timeouts/active`, shaped for a SQL predicate.
 *
 * `classIds: []` with `onDuty: false` means "genuinely nothing to see", which lets the
 * route answer without querying. A short-circuit and a real empty result are
 * indistinguishable to the client, which is exactly right here.
 */
export async function timeoutVisibility(
  user: Identity,
  now: Date = new Date(),
): Promise<TimeoutVisibility> {
  if (user.role === 'pupil') return { onDuty: false, classIds: null, forbidden: true };

  if ((await isSchoolLeader(user)) || (await isLwDutyTeacher(user, now))) {
    return { onDuty: true, classIds: null };
  }

  const global = await getGlobalAccess(user);
  return { onDuty: false, classIds: global.classIds };
}