import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { teachingAssignments, timetableLessons } from '../db/schema.js';
import { badRequest, getTeacher, parseIdParam, requireAuth, isHeadmasterUser } from '../lib/guards.js';

interface PeriodTime {
  period: number;
  start: string;
  end: string;
  startMin: number;
  endMin: number;
}

const PERIOD_TIMES: PeriodTime[] = [
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

export function determinePeriodAndDay(customDay?: number, customPeriod?: number) {
  if (customDay && customPeriod) {
    const pInfo = PERIOD_TIMES.find((p) => p.period === customPeriod) || PERIOD_TIMES[0]!;
    return { dayOfWeek: customDay, period: customPeriod, periodInfo: pInfo, isSchoolHours: true };
  }

  const now = new Date();
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

export const timetableRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/timetable/current — the caller's own lesson right now. */
  fastify.get('/current', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const query = request.query as { day?: string; period?: string };

    const customDay = query.day ? Number.parseInt(query.day, 10) : undefined;
    const customPeriod = query.period ? Number.parseInt(query.period, 10) : undefined;

    const { dayOfWeek, period, periodInfo, isSchoolHours } = determinePeriodAndDay(customDay, customPeriod);

    if (!user.teacherId) {
      return reply.send({
        isTeacher: false,
        dayOfWeek,
        period,
        periodInfo,
        isSchoolHours,
        currentLesson: null,
        nextLesson: null,
        todayLessons: [],
        weekLessonsCount: 0,
      });
    }

    const todayLessons = await db
      .select()
      .from(timetableLessons)
      .where(and(eq(timetableLessons.teacherId, user.teacherId), eq(timetableLessons.dayOfWeek, dayOfWeek)))
      .orderBy(timetableLessons.period);

    const currentLesson = todayLessons.find((l) => l.period === period) ?? null;
    const nextLesson = todayLessons.find((l) => l.period > period) ?? null;

    const weekLessons = await db
      .select()
      .from(timetableLessons)
      .where(eq(timetableLessons.teacherId, user.teacherId))
      .orderBy(timetableLessons.dayOfWeek, timetableLessons.period);

    return reply.send({
      isTeacher: true,
      dayOfWeek,
      period,
      periodInfo,
      isSchoolHours,
      currentLesson,
      nextLesson,
      todayLessons,
      weekLessonsCount: weekLessons.length,
    });
  });

  /**
   * GET /api/timetable/teacher/:teacherId — another teacher's weekly schedule.
   *
   * Previously any authenticated user could read anyone's timetable, and
   * `parseInt` of a non-numeric value produced NaN which was passed straight into a
   * parameterised query. Now scoped to self, colleagues in shared classes, and
   * school leadership.
   */
  fastify.get('/teacher/:teacherId', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { teacherId } = request.params as { teacherId: string };
    const tid = parseIdParam(teacherId, 'teacherId');
    if (!tid) return badRequest(reply, 'Ungültige Lehrpersonen-ID.');

    const isSelf = user.teacherId === tid;
    const targetTeacher = await getTeacher(tid);
    if (!targetTeacher) return reply.status(404).send({ error: 'Lehrperson nicht gefunden' });

    if (!isSelf) {
      const allowed =
        user.role === 'admin' ||
        isHeadmasterUser(user, user.teacherId ? await getTeacher(user.teacherId) : null);

      if (!allowed) {
        // A regular teacher may only see a colleague's timetable if they share a class.
        if (!user.teacherId) {
          return reply.status(403).send({
            error: 'Sie dürfen den Stundenplan dieser Lehrperson nicht einsehen.',
          });
        }

        const [mine] = await db
          .select({ classId: teachingAssignments.classId })
          .from(teachingAssignments)
          .where(eq(teachingAssignments.teacherId, user.teacherId));
        if (!mine) {
          return reply.status(403).send({
            error: 'Sie dürfen den Stundenplan dieser Lehrperson nicht einsehen.',
          });
        }

        const [shared] = await db
          .select({ classId: teachingAssignments.classId })
          .from(teachingAssignments)
          .where(
            and(
              eq(teachingAssignments.teacherId, tid),
              eq(teachingAssignments.classId, mine.classId),
            ),
          );

        if (!shared) {
          return reply.status(403).send({
            error: 'Sie dürfen den Stundenplan dieser Lehrperson nicht einsehen.',
          });
        }
      }
    }

    const lessons = await db
      .select()
      .from(timetableLessons)
      .where(eq(timetableLessons.teacherId, tid))
      .orderBy(timetableLessons.dayOfWeek, timetableLessons.period);

    return reply.send(lessons);
  });
};