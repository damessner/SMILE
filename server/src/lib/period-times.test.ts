import { afterEach, describe, expect, it, vi } from 'vitest';
import { PERIOD_TIMES, bellScheduleTimezoneWarning, currentPeriod, timeoutExpiry } from './period-times.js';

/**
 * These tests pin the one clock the whole Lernwerkstatt duty decision rests on: if
 * `currentPeriod` and the timetable disagree about which period is running, the duty
 * teacher is looked up for the wrong slot and the LW board goes empty for a whole lesson.
 *
 * Times are local school time, matching how the bell schedule has always been read.
 */

/**
* Local-time Date for an ISO weekday (1=Mo … 7=Sun) in October 2026, where Oct 1 is a
* Thursday — so Oct 5 is the Monday this suite anchors on.
*/
function at(isoDay: number, hours: number, minutes: number): Date {
return new Date(2026, 9, 4 + isoDay, hours, minutes, 0, 0);
}

describe('PERIOD_TIMES', () => {
  it('covers periods 1..10 with monotonic, non-overlapping windows', () => {
    expect(PERIOD_TIMES.map((p) => p.period)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (let i = 1; i < PERIOD_TIMES.length; i++) {
      expect(PERIOD_TIMES[i]!.startMin).toBeGreaterThan(PERIOD_TIMES[i - 1]!.endMin);
    }
  });

  it('keeps start/end strings consistent with the minute arithmetic', () => {
    for (const p of PERIOD_TIMES) {
      const [sh, sm] = p.start.split(':').map(Number);
      const [eh, em] = p.end.split(':').map(Number);
      expect(sh! * 60 + sm!).toBe(p.startMin);
      expect(eh! * 60 + em!).toBe(p.endMin);
    }
  });
});

describe('currentPeriod', () => {
  it('reports the running period during a lesson', () => {
    // Wednesday, 10:00 → period 3 (09:45–10:35)
    const r = currentPeriod(at(3, 10, 0));
    expect(r.dayOfWeek).toBe(3);
    expect(r.period).toBe(3);
    expect(r.isSchoolHours).toBe(true);
  });

  it('includes the last minute of a lesson', () => {
    expect(currentPeriod(at(3, 10, 35)).period).toBe(3);
  });

  it('looks ahead to the next period during the break between two lessons', () => {
// 09:38 is the 09:30–09:45 break between P2 and P3, so the next lesson is P3.
const r = currentPeriod(at(3, 9, 38));
expect(r.period).toBe(3);
expect(r.isSchoolHours).toBe(true);
// 10:38 is the 10:35–10:40 break between P3 and P4, so the next lesson is P4.
expect(currentPeriod(at(3, 10, 38)).period).toBe(4);
  });

  it('reports the first period before the school day but is not school hours', () => {
    const r = currentPeriod(at(3, 6, 30));
    expect(r.period).toBe(1);
    expect(r.isSchoolHours).toBe(false);
  });

  it('reports the last period after the school day but is not school hours', () => {
    const r = currentPeriod(at(3, 19, 0));
    expect(r.period).toBe(10);
    expect(r.isSchoolHours).toBe(false);
  });

  it('maps Sunday onto Monday and refuses to count it as school hours', () => {
    const r = currentPeriod(at(7, 10, 0));
    expect(r.dayOfWeek).toBe(1);
    expect(r.isSchoolHours).toBe(false);
  });

  it('maps Saturday onto Monday and refuses to count it as school hours', () => {
    const r = currentPeriod(at(6, 10, 0));
    expect(r.dayOfWeek).toBe(1);
    expect(r.isSchoolHours).toBe(false);
  });

  it('uses the ISO weekday numbering the timetable stores (1=Mo … 5=Fr)', () => {
    for (const [day, iso] of [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]] as const) {
      expect(currentPeriod(at(day, 9, 0)).dayOfWeek).toBe(iso);
    }
  });
});

describe('timeoutExpiry', () => {
  it('stamps end of the current period when issued during a lesson', () => {
    // Wed 10:00 is during period 3 (09:45–10:35), so it expires at 10:35 today.
    const exp = timeoutExpiry(at(3, 10, 0));
    expect(exp).not.toBeNull();
    expect(exp!.getHours()).toBe(10);
    expect(exp!.getMinutes()).toBe(35);
  });

  it('stamps end of the next period when issued during a break', () => {
    // Wed 09:38 is during the 09:30–09:45 break before period 3 (ends 10:35).
    const exp = timeoutExpiry(at(3, 9, 38));
    expect(exp).not.toBeNull();
    expect(exp!.getHours()).toBe(10);
    expect(exp!.getMinutes()).toBe(35);
  });

  it('returns null when issued after school hours (manual release)', () => {
    // Wed 19:00 is after period 10 finishes.
    expect(timeoutExpiry(at(3, 19, 0))).toBeNull();
  });

  it('returns null when issued at the weekend', () => {
    // Sunday 10:00
    expect(timeoutExpiry(at(7, 10, 0))).toBeNull();
  });
});

describe('bellScheduleTimezoneWarning', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stays silent when the host runs in the school zone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'Europe/Vienna' }),
    } as never);
    expect(bellScheduleTimezoneWarning()).toBeNull();
  });

  it('warns when the host runs in another zone, naming the fix', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockReturnValue({
      resolvedOptions: () => ({ timeZone: 'UTC' }),
    } as never);
    const warning = bellScheduleTimezoneWarning();
    expect(warning).toContain('UTC');
    expect(warning).toContain('Europe/Vienna');
    expect(warning).toContain('timedatectl set-timezone');
  });
});