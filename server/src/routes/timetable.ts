import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/index.js';
import { teachingAssignments, timetableLessons } from '../db/schema.js';
import { badRequest, getTeacher, parseIdParam, requireAuth, isHeadmasterUser } from '../lib/guards.js';
import { parsePageParams } from '../lib/pagination.js';
// The bell schedule lives in lib/period-times.ts: the Lernwerkstatt duty lookup needs the
// same clock, and two copies of the timetable would eventually disagree about the period.
import { PERIOD_TIMES, currentPeriod } from '../lib/period-times.js';

export function determinePeriodAndDay(customDay?: number, customPeriod?: number) {
if (customDay && customPeriod) {
const pInfo = PERIOD_TIMES.find((p) => p.period === customPeriod) || PERIOD_TIMES[0]!;
return { dayOfWeek: customDay, period: customPeriod, periodInfo: pInfo, isSchoolHours: true };
}

return currentPeriod(new Date());
}

export const timetableRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/timetable/current — the caller's own lesson right now. */
  fastify.get('/current', { preValidation: [fastify.authenticate] }, async (request, reply) => {
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
  fastify.get('/teacher/:teacherId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { teacherId } = request.params as { teacherId: string };
    const tid = parseIdParam(teacherId, 'teacherId');
    if (!tid) return badRequest(reply, 'Ungültige Lehrpersonen-ID.');

    const parsed = parsePageParams(request.query);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });

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

    // `id` breaks ties so pages do not reshuffle when two rows share a slot (team teaching).
    const lessons = await db
      .select()
      .from(timetableLessons)
      .where(eq(timetableLessons.teacherId, tid))
      .orderBy(timetableLessons.dayOfWeek, timetableLessons.period, timetableLessons.id)
      .limit(parsed.page.limit)
      .offset(parsed.page.offset);

    return reply.send(lessons);
  });
};
