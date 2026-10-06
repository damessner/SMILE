import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import {
  assessmentRubrics,
  behaviorCards,
  evaluationItems,
  evaluations,
  observationRounds,
  pupils,
  rubricCriteria,
  schoolClasses,
  teachingAssignments,
} from '../db/schema.js';
import {
  badRequest,
  getClassAccess,
  getGlobalAccess,
  parseIdParam,
  requireAuth,
  type ClassAccess,
} from '../lib/guards.js';
import { normalizeSubject } from '../utils/subject.js';

/**
 * Per-class permission results, filled in as classes are opened, so GET /api/classes
 * can report the raster permission for each class without re-resolving every guard.
 */
const accessCache = new Map<number, ClassAccess>();

function normaliseSubjects(raw: string[]) {
  return Array.from(
    new Map(
      raw.map((r) => {
        const n = normalizeSubject(r);
        return [n.code, n];
      }),
    ).values(),
  );
}

export const classRoutes: FastifyPluginAsync = async (fastify) => {
  /** GET /api/classes — the classes this user may open. */
  fastify.get('/', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const global = await getGlobalAccess(user);

    const realClasses = await db
      .select()
      .from(schoolClasses)
      .where(and(ne(schoolClasses.name, 'LW'), gt(schoolClasses.grade, 0)))
      .orderBy(schoolClasses.grade, schoolClasses.name);

    // Look up teacher's timetable lesson hours across classes and subjects
    const teacherHoursMap = new Map<string, number>();
    if (user.teacherId) {
      try {
        const hoursRes = await getPool().query<{
          class_id: number;
          subject_code: string;
          hours: number;
        }>(
          `SELECT class_id, UPPER(TRIM(subject_code)) as subject_code, COUNT(*)::int as hours
             FROM timetable_lessons
            WHERE teacher_id = $1
            GROUP BY class_id, UPPER(TRIM(subject_code))`,
          [user.teacherId],
        );
        for (const h of hoursRes.rows) {
          const norm = normalizeSubject(h.subject_code).code;
          const key = `${h.class_id}_${norm}`;
          teacherHoursMap.set(key, (teacherHoursMap.get(key) || 0) + h.hours);
        }
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to query timetable lessons for classes');
      }
    }

    const attachHours = (classId: number, subs: ReturnType<typeof normaliseSubjects>) => {
      return subs.map((s) => ({
        ...s,
        hours: teacherHoursMap.get(`${classId}_${s.code}`) || 0,
      }));
    };

    // Admin and headmasters see every class.
    if (global.classIds === null) {
      const mine = user.teacherId
        ? await db
            .select()
            .from(teachingAssignments)
            .where(eq(teachingAssignments.teacherId, user.teacherId))
        : [];

      return reply.send(
        realClasses.map((c) => {
          const subs = normaliseSubjects(
            mine.filter((a) => a.classId === c.id).map((a) => a.subjectCode || a.subjectName),
          );
          return {
            ...c,
            mySubjects: attachHours(c.id, subs),
            canAccessRaster: true,
            isCoreTeacher: true,
            canRate: true,
            isKv: false,
          };
        }),
      );
    }

    if (global.classIds.length === 0) return reply.send([]);

    const classes = realClasses.filter((c) => global.classIds!.includes(c.id));

    // Resolve permissions for exactly the classes being listed.
    const resolved = await Promise.all(classes.map((c) => getClassAccess(user, c.id)));
    classes.forEach((c, i) => accessCache.set(c.id, resolved[i]!));

    return reply.send(
      classes.map((cls, i) => {
        const access = resolved[i]!;
        return {
          ...cls,
          mySubjects: attachHours(cls.id, access.subjects),
          canAccessRaster: access.isCoreTeacher,
          isCoreTeacher: access.isCoreTeacher,
          canRate: access.canRate,
          isKv: access.isKv,
        };
      }),
    );
  });

  /** GET /api/classes/:classId/rubric */
  fastify.get('/:classId/rubric', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRead) {
      return reply.status(403).send({ error: 'Keine Zugriffsberechtigung für diese Klasse' });
    }

    const [rubric] = await db
      .select()
      .from(assessmentRubrics)
      .where(eq(assessmentRubrics.isDefault, true))
      .limit(1);
    if (!rubric) return reply.status(404).send({ error: 'Kein Bewertungsraster gefunden' });

    const criteria = await db
      .select()
      .from(rubricCriteria)
      .where(eq(rubricCriteria.rubricId, rubric.id))
      .orderBy(rubricCriteria.position);

    const [round] = await db
      .select()
      .from(observationRounds)
      .orderBy(desc(observationRounds.createdAt))
      .limit(1);

    return reply.send({ rubric, criteria, round, canRate: access.canRate });
  });

  /**
   * GET /api/classes/:classId/pupils — roster with cards and evaluations.
   *
   * Bug fix: the card filter used `eq(revokedAt, null)`, which Drizzle compiles to
   * `revoked_at = $1` bound to NULL. In PostgreSQL that predicate is never true, so
   * the cards array came back empty for every pupil and the green/yellow counters in
   * BeobachtungsGrid and ClassOverview always rendered 0.
   * Verified by compiling the query rather than assuming:
   *   eq(col, null) -> `where  = $1` [null]      (matches zero rows)
   *   isNull(col)   -> `where  is null`          (correct)
   */
  fastify.get('/:classId/pupils', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    if (cid === 999) {
      const [cls] = await db.select().from(schoolClasses).where(eq(schoolClasses.id, 999)).limit(1);
      return reply.send({
        class: cls ?? { id: 999, name: 'LW', grade: 0 },
        pupils: [],
        canAccessRaster: false,
        isKv: false,
        mySubjects: [],
      });
    }

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRead) {
      return reply.status(403).send({ error: 'Keine Zugriffsberechtigung für die Schüler dieser Klasse' });
    }

    accessCache.set(cid, access);

    const classPupils = await db
      .select()
      .from(pupils)
      .where(and(eq(pupils.classId, cid), eq(pupils.isArchived, false)))
      .orderBy(pupils.fullName);

    const [round] = await db
      .select()
      .from(observationRounds)
      .orderBy(desc(observationRounds.createdAt))
      .limit(1);

    let classEvaluations: Array<typeof evaluations.$inferSelect> = [];
    const itemsByEvaluationId: Record<string, Array<typeof evaluationItems.$inferSelect>> = {};

    if (round && classPupils.length > 0) {
      classEvaluations = await db
        .select()
        .from(evaluations)
        .where(and(eq(evaluations.classId, cid), eq(evaluations.roundId, round.id)));

      const evalIds = classEvaluations.map((e) => e.id);
      if (evalIds.length > 0) {
        const allItems = await db
          .select()
          .from(evaluationItems)
          .where(inArray(evaluationItems.evaluationId, evalIds));

        for (const item of allItems) {
          (itemsByEvaluationId[item.evaluationId] ??= []).push(item);
        }
      }
    }

    const cards = await db
      .select()
      .from(behaviorCards)
      .where(and(eq(behaviorCards.classId, cid), isNull(behaviorCards.revokedAt)))
      .orderBy(desc(behaviorCards.createdAt));

    const pupilsWithData = classPupils.map((p) => {
      const pupilEvals = classEvaluations.filter((e) => e.pupilId === p.id);
      const pupilCards = cards.filter((c) => c.pupilId === p.id);

      return {
        ...p,
        evaluations: pupilEvals.map((e) => ({
          ...e,
          items: itemsByEvaluationId[e.id] ?? [],
        })),
        cards: pupilCards,
        greenCardCount: pupilCards.filter((c) => c.cardType === 'green').length,
        yellowCardCount: pupilCards.filter((c) => c.cardType === 'yellow').length,
        redCardCount: pupilCards.filter((c) => c.cardType === 'red').length,
      };
    });

    // Look up teacher's timetable lesson hours for this class and subjects
    const userHoursMap = new Map<string, number>();
    if (user.teacherId) {
      try {
        const hoursRes = await getPool().query<{
          class_id: number;
          subject_code: string;
          hours: number;
        }>(
          `SELECT class_id, UPPER(TRIM(subject_code)) as subject_code, COUNT(*)::int as hours
             FROM timetable_lessons
            WHERE teacher_id = $1 AND class_id = $2
            GROUP BY class_id, UPPER(TRIM(subject_code))`,
          [user.teacherId, cid],
        );
        for (const h of hoursRes.rows) {
          const norm = normalizeSubject(h.subject_code).code;
          userHoursMap.set(norm, (userHoursMap.get(norm) || 0) + h.hours);
        }
      } catch (err) {
        fastify.log.warn({ err }, 'Failed to query timetable lessons for class pupils');
      }
    }

    const mySubjectsWithHours = access.subjects.map((s) => ({
      ...s,
      hours: userHoursMap.get(s.code) || 0,
    }));

    return reply.send({
      class: {
        id: access.classId,
        name: (await className(cid)) ?? String(cid),
      },
      round,
      canAccessRaster: access.isCoreTeacher,
      isCoreTeacher: access.isCoreTeacher,
      canRate: access.canRate,
      isKv: access.isKv,
      mySubjects: mySubjectsWithHours,
      pupils: pupilsWithData,
    });
  });
};

async function className(classId: number): Promise<string | undefined> {
  const [cls] = await db
    .select({ name: schoolClasses.name })
    .from(schoolClasses)
    .where(eq(schoolClasses.id, classId))
    .limit(1);
  return cls?.name;
}

/** Exported for tests. */
export { accessCache };