import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from './guards.js';

/**
 * The Lernwerkstatt duty rule is the authorization boundary for two routes at once:
 * `GET /api/timeouts/active` and `POST /api/timeouts/:id/resolve`. If those two ever
 * disagree, the duty board is broken in the worst possible way — the supervisor sees a
 * pupil in the room and is then refused permission to release them.
 *
 * The duty roster is the timetable itself: exactly one teacher per period has an LW slot
 * in `timetable_lessons` for class 999. `guards.js` is mocked here so this suite pins the
 * *policy* (who is allowed, and why) rather than re-testing SQL.
 */

// `vi.mock` is hoisted above the imports, so the stubs its factory closes over must be
// hoisted with it — a plain top-level `const` is still in the temporal dead zone.
const { hasLwDutySlot, isSchoolLeader, getClassAccess, getGlobalAccess } = vi.hoisted(() => ({
hasLwDutySlot: vi.fn<(teacherId: number, now?: Date) => Promise<boolean>>(async () => false),
isSchoolLeader: vi.fn<(user: unknown) => Promise<boolean>>(async () => false),
getClassAccess: vi.fn<(user: unknown, classId: number) => Promise<{ canRecord: boolean }>>(
async () => ({ canRecord: false }),
),
getGlobalAccess: vi.fn<(user: unknown) => Promise<{ classIds: number[] | null }>>(
async () => ({ classIds: [] }),
),
}));

vi.mock('./guards.js', async (importOriginal) => {
const actual = await importOriginal<typeof import('./guards.js')>();
return {
...actual,
hasLwDutySlot,
isSchoolLeader,
getClassAccess,
getGlobalAccess,
};
});


/** Wednesday, 10:00 — period 3, inside the bell schedule. */
const DURING_SCHOOL = new Date(2026, 9, 7, 10, 0, 0, 0);
/** Wednesday, 22:00 — outside the bell schedule. */
const OUTSIDE_SCHOOL = new Date(2026, 9, 7, 22, 0, 0, 0);

const teacher = (teacherId: number): Identity => ({ role: 'teacher', teacherId });

import {
  canActOnTimeout,
  canSeeLwRoom,
  isLwDutyTeacher,
  timeoutVisibility,
} from './lw-duty.js';

beforeEach(() => {
  vi.clearAllMocks();
  hasLwDutySlot.mockResolvedValue(false);
  isSchoolLeader.mockResolvedValue(false);
  getClassAccess.mockResolvedValue({ canRecord: false });
  getGlobalAccess.mockResolvedValue({ classIds: [] });
});

describe('isLwDutyTeacher', () => {
  it('is true for the teacher holding the LW slot in the running period', async () => {
    hasLwDutySlot.mockResolvedValue(true);
    expect(await isLwDutyTeacher(teacher(42), DURING_SCHOOL)).toBe(true);
expect(hasLwDutySlot).toHaveBeenCalledWith(42, DURING_SCHOOL);
  });

  it('is false for a teacher who holds no LW slot', async () => {
    expect(await isLwDutyTeacher(teacher(42), DURING_SCHOOL)).toBe(false);
  });

  it('refuses outside the bell schedule instead of matching a stale slot', async () => {
    // A read at 22:00 must not grant duty from an earlier period of the same day.
    expect(await isLwDutyTeacher(teacher(42), OUTSIDE_SCHOOL)).toBe(false);
    expect(hasLwDutySlot).not.toHaveBeenCalled();
  });

  it('is false for an account with no linked teacher row, without querying', async () => {
    expect(await isLwDutyTeacher({ role: 'teacher' }, DURING_SCHOOL)).toBe(false);
    expect(hasLwDutySlot).not.toHaveBeenCalled();
  });

  it('is false for a pupil account, without querying', async () => {
    expect(await isLwDutyTeacher({ role: 'pupil', teacherId: 7 }, DURING_SCHOOL)).toBe(false);
    expect(hasLwDutySlot).not.toHaveBeenCalled();
  });
});

describe('canSeeLwRoom', () => {
  it('admits the duty teacher', async () => {
    hasLwDutySlot.mockResolvedValue(true);
    expect(await canSeeLwRoom(teacher(42), DURING_SCHOOL)).toBe(true);
  });

  it('admits the school leadership', async () => {
    isSchoolLeader.mockResolvedValue(true);
    expect(await canSeeLwRoom(teacher(1), DURING_SCHOOL)).toBe(true);
  });

  it('refuses a teacher who is neither on duty nor a leader', async () => {
    expect(await canSeeLwRoom(teacher(42), DURING_SCHOOL)).toBe(false);
  });

  it('refuses a pupil even if a slot lookup would have matched', async () => {
    hasLwDutySlot.mockResolvedValue(true);
    // canSeeLwRoom is only reached behind `authenticate` + the pupil guard on the route;
    // isLwDutyTeacher is the layer that refuses pupils, and it must stay the only entry.
    expect(await isLwDutyTeacher({ role: 'pupil', teacherId: 7 }, DURING_SCHOOL)).toBe(false);
  });
});

describe('canActOnTimeout', () => {
  it('allows the duty teacher to act on a class they do not teach', async () => {
    hasLwDutySlot.mockResolvedValue(true);
    expect(await canActOnTimeout(teacher(42), 3, DURING_SCHOOL)).toBe(true);
    expect(getClassAccess).not.toHaveBeenCalled();
  });

  it('allows the school leadership to act on any class', async () => {
    isSchoolLeader.mockResolvedValue(true);
    expect(await canActOnTimeout(teacher(1), 3, DURING_SCHOOL)).toBe(true);
  });

  it('allows the responsible teacher of the class to act, without being on duty', async () => {
    getClassAccess.mockResolvedValue({ canRecord: true });
    expect(await canActOnTimeout(teacher(42), 3, DURING_SCHOOL)).toBe(true);
    expect(getClassAccess).toHaveBeenCalledWith(teacher(42), 3);
  });

  it('refuses a teacher with no duty and no responsibility for the class', async () => {
    expect(await canActOnTimeout(teacher(42), 3, DURING_SCHOOL)).toBe(false);
  });

  it('refuses a pupil', async () => {
    // Defence in depth: the routes forbid pupils before this is consulted, and a pupil must
    // not acquire class authority by passing a teacherId through a crafted token.
    hasLwDutySlot.mockResolvedValue(true);
    expect(await canActOnTimeout({ role: 'pupil', teacherId: 7 }, 3, DURING_SCHOOL)).toBe(false);
  });
});

describe('timeoutVisibility', () => {
  it('grants an unrestricted view to the duty teacher', async () => {
    hasLwDutySlot.mockResolvedValue(true);
    expect(await timeoutVisibility(teacher(42), DURING_SCHOOL)).toEqual({
      onDuty: true,
      classIds: null,
    });
  });

  it('grants an unrestricted view to the school leadership', async () => {
    isSchoolLeader.mockResolvedValue(true);
    expect(await timeoutVisibility(teacher(1), DURING_SCHOOL)).toEqual({
      onDuty: true,
      classIds: null,
    });
  });

  it('limits an ordinary teacher to their own classes', async () => {
    getGlobalAccess.mockResolvedValue({ classIds: [3, 4] });
    expect(await timeoutVisibility(teacher(42), DURING_SCHOOL)).toEqual({
      onDuty: false,
      classIds: [3, 4],
    });
  });

  it('reports an empty scope for a teacher with no classes, so the route can skip the query', async () => {
    expect(await timeoutVisibility(teacher(42), DURING_SCHOOL)).toEqual({
      onDuty: false,
      classIds: [],
    });
  });

  it('refuses a pupil outright rather than scoping them to nothing', async () => {
    // An empty list would be indistinguishable from "you happen to have no time-outs", which
    // is a misleading answer for an account that may never read the list at all.
    await expect(timeoutVisibility({ role: 'pupil', teacherId: 7 }, DURING_SCHOOL)).resolves.toEqual({
      onDuty: false,
      classIds: null,
      forbidden: true,
    });
  });
});