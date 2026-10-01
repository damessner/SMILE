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
} from '../db/schema.js';
import {
  getGlobalAccess,
  parseIdParam,
  requireAuth,
  type AuthUser,
} from '../lib/guards.js';
import { calculateRank, summarizeRatings } from '../lib/ranking.js';
import { normalizeSubject } from '../utils/subject.js';

export const statisticsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/statistics/overview?classId=...
   *
   * Previously commented "Accessible to ALL authenticated teachers!" and returned every
   * pupil in the school together with each teacher's individual comment and next step.
   * Now scoped: a teacher sees only the classes they are responsible for, and the
   * aggregate is computed over that set.
   */
  fastify.get('/overview', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user: AuthUser = requireAuth(request);
    const { classId } = request.query as { classId?: string };

    const global = await getGlobalAccess(user);
    if (global.classIds !== null && global.classIds.length === 0) {
      return reply.send({
        classes: [],
        round: null,
        distribution: emptyDistribution(),
        pupils: [],
        scope: { restricted: true, classIds: [] },
      });
    }

    const allClasses = await db
      .select({ id: schoolClasses.id, name: schoolClasses.name, grade: schoolClasses.grade })
      .from(schoolClasses)
      .orderBy(schoolClasses.grade, schoolClasses.name);

    // The class picker must not advertise classes the caller cannot open.
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
        distribution: emptyDistribution(),
        pupils: [],
        scope: { restricted: global.classIds !== null, classIds: global.classIds },
      });
    }

    let targetClassIds: number[];
    if (classId && classId !== 'all') {
      const cid = parseIdParam(String(classId), 'classId');
      if (!cid) {
        return reply.status(400).send({ error: 'Ungültige Klassen-ID.' });
      }
      // Reject a request for a class outside the caller's scope instead of silently
      // returning another class's data.
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
        distribution: emptyDistribution(),
        pupils: [],
        scope: { restricted: global.classIds !== null, classIds: global.classIds },
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
        distribution: emptyDistribution(),
        pupils: [],
        scope: { restricted: global.classIds !== null, classIds: global.classIds },
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

    let countLehrling = 0;
    let countGeselle = 0;
    let countMeister = 0;

    const pupilsSummary = classPupils.map((pupil) => {
      const pupilEvals = allEvals.filter((e) => e.pupilId === pupil.id);
      const counts = summarizeRatings(
        pupilEvals.map((e) => ({
          evaluationId: e.id,
          items: itemsByEvalId.get(e.id) ?? [],
        })),
      );

      const confirmed = confirmedRanks.find((r) => r.pupilId === pupil.id);
      const finalRank = confirmed?.rank ?? calculateRank(counts.scoreForThreshold, false).finalRank;

      if (finalRank === 'Meister') countMeister++;
      else if (finalRank === 'Geselle') countGeselle++;
      else countLehrling++;

      const teacherVotes = pupilEvals.map((ev) => {
        const teacher = teacherMap.get(ev.teacherId);
        const normSub = normalizeSubject(ev.subjectCode);
        const evalCounts = summarizeRatings([
          { evaluationId: ev.id, items: itemsByEvalId.get(ev.id) ?? [] },
        ]);
        return {
          teacherId: ev.teacherId,
          teacherShort: teacher?.shortName || 'LEH',
          teacherName: teacher?.fullName || 'Fachlehrer',
          subjectCode: ev.subjectCode,
          subjectName: normSub.name,
          isCore: normSub.isCoreSmile,
          proposedStatus: ev.proposedStatus,
          nextStep: ev.nextStep,
          comment: ev.comment,
          positiveCount: evalCounts.positiveCount,
          totalRated: evalCounts.totalRated,
          updatedAt: ev.updatedAt,
        };
      });

      const pupilItems = pupilEvals.flatMap((e) => itemsByEvalId.get(e.id) ?? []);
      const formattedItems = pupilItems.map((it) => {
        const updater = it.updatedByTeacherId != null ? teacherMap.get(it.updatedByTeacherId) : undefined;
        return { ...it, updatedBy: updater?.fullName || updater?.shortName || null };
      });

      return {
        id: pupil.id,
        fullName: pupil.fullName,
        classId: pupil.classId,
        className: pupil.className,
        grade: pupil.grade,
        positiveCount: counts.positiveCount,
        totalRated: counts.totalRated,
        calculatedRank: calculateRank(counts.scoreForThreshold, false).finalRank,
        finalRank,
        isConfirmed: !!confirmed,
        overrideReason: confirmed?.overrideReason,
        teacherVotes,
        items: formattedItems,
      };
    });

    const totalPupils = pupilsSummary.length;
    const pct = (n: number) => (totalPupils > 0 ? Math.round((n / totalPupils) * 100) : 0);

    return reply.send({
      classes: visibleClasses,
      round,
      distribution: {
        lehrling: countLehrling,
        geselle: countGeselle,
        meister: countMeister,
        total: totalPupils,
        percentLehrling: pct(countLehrling),
        percentGeselle: pct(countGeselle),
        percentMeister: pct(countMeister),
      },
      pupils: pupilsSummary,
      scope: { restricted: global.classIds !== null, classIds: global.classIds },
    });
  });

  /** GET /api/statistics/rubric — the active rubric definition. */
  fastify.get('/rubric', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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