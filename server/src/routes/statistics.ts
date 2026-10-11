import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  assessmentRubrics,
  evaluationItems,
  evaluations,
  finalRanks,
  observationRounds,
  pupils,
  rubricCriteria,
  schoolClasses,
  teachers,
  teachingAssignments,
} from '../db/schema.js';
import {
  forbid,
  getGlobalAccess,
  parseIdParam,
  requireAuth,
  type AuthUser,
} from '../lib/guards.js';
import { config } from '../config.js';
import {
  buildSubjectStatistics,
  calculateSubjectDistribution,
} from '../lib/subject-statistics.js';

export const statisticsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/statistics/overview?classId=...
   *
   * READ-ONLY. There is no POST/PUT/PATCH/DELETE variant of this route and the
   * client only ever reads it, so "every teacher sees everything, nobody edits"
   * holds structurally rather than by an edit check somewhere.
   *
   * School decision (STATISTICS_SCHOOL_WIDE, default true): every teacher sees the
   * school-wide and per-class figures, not just their own classes. This reverses the
   * scoping introduced during the hardening pass, on the grounds that staff under the
   * same controller may see the whole picture.
   *
   * STATISTICS_SHOW_FOREIGN_COMMENTS (default true) additionally exposes the
   * individual `comment` / `nextStep` another teacher wrote about a pupil. Turn it off
   * to keep private notes with their author while still sharing the aggregates.
   *
   * Pupil logins are excluded outright: this view is for staff.
   */
  fastify.get('/overview', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user: AuthUser = requireAuth(request);
    const { classId } = request.query as { classId?: string };

    if (user.role === 'pupil') {
      return forbid(reply, 'Die Schulstatistik ist für Lehrkräfte freigegeben.');
    }

    const schoolWide = config.statisticsSchoolWide;
    const global = schoolWide ? { classIds: null } : await getGlobalAccess(user);

    /**
     * One shape for `scope`, built in one place.
     *
     * The early returns below used to hand-write this object each time, and two of the
     * five omitted `schoolWide` — including the success path. A client reading
     * `scope.schoolWide` therefore got a correct answer on every *empty* response and
     * `undefined` precisely when there was data to describe. Deriving it here means a
     * future branch cannot silently drop a field again.
     */
    const buildScope = () => ({
      restricted: global.classIds !== null,
      schoolWide,
      classIds: global.classIds,
    });

    if (global.classIds !== null && global.classIds.length === 0) {
      return reply.send({
        classes: [],
        round: null,
        rubricConfig: currentRubricConfig(),
        distribution: emptyDistribution(),
        pupils: [],
        scope: buildScope(),
      });
    }

    const allClasses = await db
      .select({ id: schoolClasses.id, name: schoolClasses.name, grade: schoolClasses.grade })
      .from(schoolClasses)
      .orderBy(schoolClasses.grade, schoolClasses.name);

    const visibleClasses =
      global.classIds === null
        ? allClasses
        : allClasses.filter((c) => global.classIds!.includes(c.id));

    const [round] = await db
      .select()
      .from(observationRounds)
      .orderBy(desc(observationRounds.createdAt))
      .limit(1);

    if (!round) {
      return reply.send({
        classes: visibleClasses,
        round: null,
        rubricConfig: currentRubricConfig(),
        distribution: emptyDistribution(),
        pupils: [],
        scope: buildScope(),
      });
    }

    let targetClassIds: number[];
    if (classId && classId !== 'all') {
      const cid = parseIdParam(String(classId), 'classId');
      if (!cid) {
        return reply.status(400).send({ error: 'Ungültige Klassen-ID.' });
      }
      if (global.classIds !== null && !global.classIds.includes(cid)) {
        return reply.status(403).send({
          error: 'Für diese Klasse haben Sie keine Zugriffsberechtigung.',
        });
      }
      targetClassIds = [cid];
    } else {
      targetClassIds = visibleClasses.map((c) => c.id);
    }

    if (targetClassIds.length === 0) {
      return reply.send({
        classes: visibleClasses,
        round,
        rubricConfig: currentRubricConfig(),
        distribution: emptyDistribution(),
        pupils: [],
        scope: buildScope(),
      });
    }

    const classPupils = await db
      .select({
        id: pupils.id,
        fullName: pupils.fullName,
        classId: pupils.classId,
        className: schoolClasses.name,
        grade: schoolClasses.grade,
      })
      .from(pupils)
      .innerJoin(schoolClasses, eq(schoolClasses.id, pupils.classId))
      .where(and(inArray(pupils.classId, targetClassIds), eq(pupils.isArchived, false)))
      .orderBy(schoolClasses.grade, schoolClasses.name, pupils.fullName);

    if (classPupils.length === 0) {
      return reply.send({
        classes: visibleClasses,
        round,
        rubricConfig: currentRubricConfig(),
        distribution: emptyDistribution(),
        pupils: [],
        scope: buildScope(),
      });
    }

    const pupilIds = classPupils.map((p) => p.id);

    const allEvals = await db
      .select()
      .from(evaluations)
      .where(and(inArray(evaluations.pupilId, pupilIds), eq(evaluations.roundId, round.id)));

    const evalIds = allEvals.map((e) => e.id);

    type ItemRow = {
      id: string;
      evaluationId: string;
      criterionId: string;
      itemKey: string;
      rating: string;
      version: number;
      updatedByTeacherId: number | null;
      updatedAt: Date;
    };

    let allItems: ItemRow[] = [];
    if (evalIds.length > 0) {
      allItems = await db
        .select({
          id: evaluationItems.id,
          evaluationId: evaluationItems.evaluationId,
          criterionId: evaluationItems.criterionId,
          itemKey: evaluationItems.itemKey,
          rating: evaluationItems.rating,
          version: evaluationItems.version,
          updatedByTeacherId: evaluationItems.updatedByTeacherId,
          updatedAt: evaluationItems.updatedAt,
        })
        .from(evaluationItems)
        .where(inArray(evaluationItems.evaluationId, evalIds));
    }

    const confirmedRanks = await db
      .select()
      .from(finalRanks)
      .where(and(inArray(finalRanks.pupilId, pupilIds), eq(finalRanks.roundId, round.id)));

    const allTeachers = await db.select().from(teachers);
    const teacherMap = new Map(allTeachers.map((t) => [t.id, t]));

    const itemsByEvalId = new Map<string, ItemRow[]>();
    for (const it of allItems) {
      const list = itemsByEvalId.get(it.evaluationId) ?? [];
      list.push(it);
      itemsByEvalId.set(it.evaluationId, list);
    }

    const classAssignments = await db
      .select({
        classId: teachingAssignments.classId,
        subjectCode: teachingAssignments.subjectCode,
        subjectName: teachingAssignments.subjectName,
      })
      .from(teachingAssignments)
      .where(inArray(teachingAssignments.classId, targetClassIds));

    const assignmentsByClass = new Map<number, Array<{ subjectCode: string; subjectName: string }>>();
    for (const a of classAssignments) {
      const list = assignmentsByClass.get(a.classId) ?? [];
      list.push(a);
      assignmentsByClass.set(a.classId, list);
    }

    const pupilsSummary = buildSubjectStatistics(
      classPupils,
      assignmentsByClass,
      allEvals,
      itemsByEvalId,
      teacherMap,
      {
        showForeignComments: config.statisticsShowForeignComments,
        viewerRole: user.role,
        viewerTeacherId: user.teacherId,
        confirmedRanks: confirmedRanks.map((r) => ({
          pupilId: r.pupilId,
          rank: r.rank,
          overrideReason: r.overrideReason,
        })),
      },
    );

    const distribution = calculateSubjectDistribution(pupilsSummary);

    return reply.send({
      classes: visibleClasses,
      round,
      rubricConfig: currentRubricConfig(),
      distribution,
      pupils: pupilsSummary,
      scope: buildScope(),
    });
  });

  /** GET /api/statistics/rubric — the active rubric definition. */
  fastify.get('/rubric', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    requireAuth(request);
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

    return reply.send({ rubric, criteria });
  });
};

function currentRubricConfig() {
  return {
    meister: config.rankThresholds.meister,
    geselle: config.rankThresholds.geselle,
    itemCount: config.rubricItemCount,
    aggregation: config.rankAggregation,
  };
}

function emptyDistribution() {
  return {
    lehrling: 0,
    geselle: 0,
    meister: 0,
    total: 0,
    percentLehrling: 0,
    percentGeselle: 0,
    percentMeister: 0,
  };
}
