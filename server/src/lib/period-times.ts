/**
 * The school's bell schedule, and the one clock that answers "which lesson is running
 * right now?".
 *
 * This used to live inside `routes/timetable.ts` as a module-private constant. It cannot
 * stay there: the Lernwerkstatt duty lookup has to ask the same question ("which period is
 * it?") to find the teacher on duty, and a second copy of the bell schedule is a second
 * answer waiting to drift. Both callers now read this file.
 *
 * All times are local school time, which is how the timetable, the duty roster and the
 * bell have always been reasoned about in this school.
 */

export interface PeriodTime {
  period: number;
  start: string;
  end: string;
  startMin: number;
  endMin: number;
}

export const PERIOD_TIMES: PeriodTime[] = [
  { period: 1, start: '07:45', end: '08:35', startMin: 7 * 60 + 45, endMin: 8 * 60 + 35 },
  { period: 2, start: '08:40', end: '09:30', startMin: 8 * 60 + 40, endMin: 9 * 60 + 30 },
  { period: 3, start: '09:45', end: '10:35', startMin: 9 * 60 + 45, endMin: 10 * 60 + 35 },
  { period: 4, start: '10:40', end: '11:30', startMin: 10 * 60 + 40, endMin: 11 * 60 + 30 },
  { period: 5, start: '11:35', end: '12:25', startMin: 11 * 60 + 35, endMin: 12 * 60 + 25 },
  { period: 6, start: '12:30', end: '13:20', startMin: 12 * 60 + 30, endMin: 13 * 60 + 20 },
  { period: 7, start: '13:25', end: '14:15', startMin: 13 * 60 + 25, endMin: 14 * 60 + 15 },
  { period: 8, start: '14:20', end: '15:10', startMin: 14 * 60 + 20, endMin: 15 * 60 + 10 },
  { period: 9, start: '15:15', end: '16:05', startMin: 15 * 60 + 15, endMin: 16 * 60 + 5 },
  { period: 10, start: '16:10', end: '17:00', startMin: 16 * 60 + 10, endMin: 17 * 60 },
];

export interface CurrentPeriod {
  /** ISO weekday as `timetable_lessons.day_of_week` stores it: 1=Mo … 5=Fr. */
  dayOfWeek: number;
  period: number;
  periodInfo: PeriodTime;
  /**
   * False outside the bell schedule and at weekends. Callers that grant school-wide
   * authority (Lernwerkstatt duty) must refuse when this is false — a duty roster read at
   * 22:00 must not match Monday's period 10.
   */
  isSchoolHours: boolean;
}

/**
 * Which lesson is running right now.
 *
 * During a break the *next* period is reported, because that is the lesson whose teacher
 * is about to need the room. Outside the school day the nearest period is reported with
 * `isSchoolHours: false` so callers can refuse rather than guess.
 */
export function currentPeriod(now: Date): CurrentPeriod {
  let dayOfWeek = now.getDay();
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
  if (isWeekend) dayOfWeek = 1;

  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  let matchedPeriod: PeriodTime | null = null;
  let isSchoolHours = false;

  for (let i = 0; i < PERIOD_TIMES.length; i++) {
    const p = PERIOD_TIMES[i]!;
    if (nowMinutes >= p.startMin && nowMinutes <= p.endMin) {
      matchedPeriod = p;
      isSchoolHours = !isWeekend;
      break;
    }
    const next = PERIOD_TIMES[i + 1];
    if (next && nowMinutes > p.endMin && nowMinutes < next.startMin) {
      matchedPeriod = next;
      isSchoolHours = !isWeekend;
      break;
    }
  }

  if (!matchedPeriod) {
    matchedPeriod = nowMinutes < PERIOD_TIMES[0]!.startMin ? PERIOD_TIMES[0]! : PERIOD_TIMES[PERIOD_TIMES.length - 1]!;
  }

  return { dayOfWeek, period: matchedPeriod.period, periodInfo: matchedPeriod, isSchoolHours };
}

/**
 * The bell end of a given period on a given day, as a Date — the moment a pupil sent to
 * Lernwerkstatt is released automatically. Returns `null` when the period is outside the
 * timetable's range, which the caller must treat as "needs manual release", never as
 * "expire immediately".
 */
export function endOfPeriod(period: number, now: Date): Date | null {
  const info = PERIOD_TIMES.find((p) => p.period === period);
  if (!info) return null;
  const end = new Date(now);
  end.setHours(Math.floor(info.endMin / 60), info.endMin % 60, 0, 0);
  // A break already reported the next period, so its end can be earlier today only if the
  // caller passed a period that has already finished; pushing to tomorrow is the safe read.
  if (end.getTime() <= now.getTime()) end.setDate(end.getDate() + 1);
  return end;
}

/**
 * When a time-out created at `now` should expire.
 * - During a lesson -> end of the current period.
 * - During a break -> end of the next period.
 * - Outside school hours or on weekends -> null (requires manual release).
 */
export function timeoutExpiry(now: Date = new Date()): Date | null {
  const cur = currentPeriod(now);
  if (!cur.isSchoolHours) return null;
  const expiry = new Date(now);
  expiry.setHours(Math.floor(cur.periodInfo.endMin / 60), cur.periodInfo.endMin % 60, 0, 0);
  return expiry;
}