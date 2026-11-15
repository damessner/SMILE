import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  assessmentRubrics,
  behaviorCards,
  evaluationItems,
  evaluations,
  finalRanks,
  observationRounds,
  pupilBehaviorActions,
  pupils,
  rubricCriteria,
  schoolClasses,
  teachers,
  teachingAssignments,
  timeoutIncidents,
} from '../db/schema.js';
import {
  forbid,
  getGlobalAccess,
  parseIdParam,
  requireAuth,
  type AuthUser,
} from '../lib/guards.js';
import { config } from '../config.js';
import { tallyBehaviorCounts } from '../lib/behavior-counts.js';
import {
  buildSubjectStatistics,
  calculateSubjectDistribution,
  type PupilStatisticsSummary,
} from '../lib/subject-statistics.js';
import { PERIOD_TIMES } from '../lib/period-times.js';

export const statisticsRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/statistics/overview?classId=...
   *
   * Factual school & class statistics dashboard.
   * Focuses purely on objective facts:
   * 1. Behavioral cards & incident totals (Green, Yellow, Red, Time-Out, Cool-Down)
   * 2. Per-class distribution and breakdown
   * 3. Temporal incident breakdown (by weekday and lesson period)
   * 4. Per-pupil factual card statistics
   *
   * READ-ONLY. Pupil logins are excluded outright: this view is for staff.
   */
  fastify.get('/overview', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user: AuthUser = requireAuth(request);
    const { classId } = request.query as { classId?: string };

    if (user.role === 'pupil') {
      return forbid(reply, 'Die Schulstatistik ist für Lehrkräfte freigegeben.');
    }

    const schoolWide = config.statisticsSchoolWide;
    const global = schoolWide ? { classIds: null } : await getGlobalAccess(user);

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
        pupilCardStats: [],
        cardsSummary: emptyCardsSummary(),
        classBreakdown: [],
        gradeProgression: [],
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
        round: round ?? null,
        rubricConfig: currentRubricConfig(),
        distribution: emptyDistribution(),
        pupils: [],
        pupilCardStats: [],
        cardsSummary: emptyCardsSummary(),
        classBreakdown: [],
        gradeProgression: [],
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

    const pupilIds = classPupils.map((p) => p.id);

    // Fetch active behavioral cards and timeouts
    const activeCards = await db
      .select({
        id: behaviorCards.id,
        pupilId: behaviorCards.pupilId,
        classId: behaviorCards.classId,
        cardType: behaviorCards.cardType,
        createdAt: behaviorCards.createdAt,
        note: behaviorCards.note,
      })
      .from(behaviorCards)
      .where(and(
        inArray(behaviorCards.classId, targetClassIds),
        isNull(behaviorCards.revokedAt)
      ));

    const classTimeouts = await db
      .select({
        id: timeoutIncidents.id,
        pupilId: timeoutIncidents.pupilId,
        classId: timeoutIncidents.classId,
        kind: timeoutIncidents.kind,
        sentAt: timeoutIncidents.sentAt,
        status: timeoutIncidents.status,
      })
      .from(timeoutIncidents)
      .where(inArray(timeoutIncidents.classId, targetClassIds));

    // Calculate individual pupil factual card stats
    const pupilCardStats = classPupils.map((p) => {
      const cards = activeCards.filter((c) => c.pupilId === p.id);
      const timeouts = classTimeouts.filter((t) => t.pupilId === p.id);
      const { green, yellow, red, cooldown, timeout } = tallyBehaviorCounts(cards, timeouts);
      const total = green + yellow + red + cooldown + timeout;

      return {
        id: p.id,
        fullName: p.fullName,
        classId: p.classId,
        className: p.className,
        grade: p.grade,
        green,
        yellow,
        red,
        timeout,
        cooldown,
        total,
      };
    });

    // Fetch confirmed ranks from finalRanks (synced with actual conference decisions)
    const confirmedRanks = round && pupilIds.length > 0
      ? await db
          .select()
          .from(finalRanks)
          .where(and(inArray(finalRanks.pupilId, pupilIds), eq(finalRanks.roundId, round.id)))
      : [];

    const cardsSummary = computeCardsSummary(activeCards, classTimeouts);
    const classBreakdown = computeClassBreakdown(
      allClasses.filter((c) => targetClassIds.includes(c.id)),
      classPupils,
      activeCards,
      classTimeouts,
      confirmedRanks,
    );
    const gradeProgression = computeGradeProgression(classBreakdown);

    // If there is no round or no pupils, return basic overview
    if (!round || pupilIds.length === 0) {
      return reply.send({
        classes: visibleClasses,
        round: round ?? null,
        rubricConfig: currentRubricConfig(),
        distribution: emptyDistribution(),
        pupils: [],
        pupilCardStats,
        cardsSummary,
        classBreakdown,
        gradeProgression,
        scope: buildScope(),
      });
    }

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
      pupilCardStats,
      cardsSummary,
      classBreakdown,
      gradeProgression,
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

function emptyCardsSummary() {
  return {
    totals: {
      green: 0,
      yellow: 0,
      red: 0,
      cooldown: 0,
      timeout: 0,
      total: 0,
    },
    incidentsByDayOfWeek: [
      { day: 1, dayName: 'Mo', count: 0 },
      { day: 2, dayName: 'Di', count: 0 },
      { day: 3, dayName: 'Mi', count: 0 },
      { day: 4, dayName: 'Do', count: 0 },
      { day: 5, dayName: 'Fr', count: 0 },
    ],
    incidentsByPeriod: [
      { period: 1, label: '1. Stunde', time: '07:45 - 08:35', count: 0 },
      { period: 2, label: '2. Stunde', time: '08:40 - 09:30', count: 0 },
      { period: 3, label: '3. Stunde', time: '09:45 - 10:35', count: 0 },
      { period: 4, label: '4. Stunde', time: '10:40 - 11:30', count: 0 },
      { period: 5, label: '5. Stunde', time: '11:35 - 12:25', count: 0 },
      { period: 6, label: '6. Stunde', time: '12:30 - 13:20', count: 0 },
    ],
  };
}

function computeCardsSummary(
  activeCards: Array<{
    id: string;
    pupilId: number;
    classId: number;
    cardType: string;
    createdAt: Date;
    note: string | null;
  }>,
  classTimeouts: Array<{
    id: string;
    pupilId: number;
    classId: number;
    kind: string;
    sentAt: Date;
    status: string;
  }>,
) {
  const { green, yellow, red, cooldown, timeout } = tallyBehaviorCounts(activeCards, classTimeouts);
  const total = green + yellow + red + cooldown + timeout;

  // Temporal analysis: Day of week & period
  const incidentDates: Date[] = [];
  for (const c of activeCards) {
    if (c.cardType === 'yellow' || c.cardType === 'red') {
      incidentDates.push(new Date(c.createdAt));
    }
  }
  for (const t of classTimeouts) {
    if (t.kind === 'timeout') {
      incidentDates.push(new Date(t.sentAt));
    }
  }

  const dayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr'];
  const dayCounts = [0, 0, 0, 0, 0];

  for (const ts of incidentDates) {
    const day = ts.getDay(); // 0=Sun, 1=Mon... 5=Fri
    if (day >= 1 && day <= 5) {
      dayCounts[day - 1]++;
    }
  }

  const incidentsByDayOfWeek = dayNames.map((name, i) => ({
    day: i + 1,
    dayName: name,
    count: dayCounts[i],
  }));

  const periodCounts = PERIOD_TIMES.slice(0, 6).map((pt) => ({
    period: pt.period,
    label: `${pt.period}. Stunde`,
    time: `${pt.start} - ${pt.end}`,
    count: 0,
  }));

  for (const ts of incidentDates) {
    const min = ts.getHours() * 60 + ts.getMinutes();
    for (let i = 0; i < periodCounts.length; i++) {
      const pt = PERIOD_TIMES[i]!;
      if (min >= pt.startMin && min <= pt.endMin) {
        periodCounts[i].count++;
        break;
      }
    }
  }

  return {
    totals: {
      green,
      yellow,
      red,
      cooldown,
      timeout,
      total,
    },
    incidentsByDayOfWeek,
    incidentsByPeriod: periodCounts,
  };
}

function computeClassBreakdown(
  classes: Array<{ id: number; name: string; grade: number }>,
  classPupils: Array<{ id: number; fullName: string; classId: number; className: string; grade: number }>,
  activeCards: Array<{ classId: number; cardType: string }>,
  classTimeouts: Array<{ classId: number; kind: string }>,
  confirmedRanks: Array<{ pupilId: number; rank: string }>,
) {
  const confirmedMap = new Map<number, string>();
  for (const cr of confirmedRanks) {
    confirmedMap.set(cr.pupilId, cr.rank);
  }

  return classes.map((sc) => {
    const classPupilsInThisClass = classPupils.filter((p) => p.classId === sc.id);
    const cardsInClass = activeCards.filter((c) => c.classId === sc.id);
    const timeoutsInClass = classTimeouts.filter((t) => t.classId === sc.id);
    const { green, yellow, red, cooldown, timeout } = tallyBehaviorCounts(
      cardsInClass,
      timeoutsInClass,
    );
    const totalCards = green + yellow + red + cooldown + timeout;
    const totalIncidents = yellow + red + timeout;

    // Confirmed rank distribution synced with conference decisions
    let lehrling = 0;
    let geselle = 0;
    let meister = 0;
    let totalConfirmed = 0;

    for (const p of classPupilsInThisClass) {
      const rank = confirmedMap.get(p.id);
      if (rank === 'Meister') {
        meister++;
        totalConfirmed++;
      } else if (rank === 'Geselle') {
        geselle++;
        totalConfirmed++;
      } else if (rank === 'Lehrling') {
        lehrling++;
        totalConfirmed++;
      }
    }

    const pct = (n: number) => (totalConfirmed > 0 ? Math.round((n / totalConfirmed) * 100) : 0);

    return {
      classId: sc.id,
      className: sc.name,
      grade: sc.grade,
      pupilCount: classPupilsInThisClass.length,
      green,
      yellow,
      red,
      cooldown,
      timeout,
      totalCards,
      totalIncidents,
      lehrling,
      geselle,
      meister,
      totalConfirmed,
      percentLehrling: pct(lehrling),
      percentGeselle: pct(geselle),
      percentMeister: pct(meister),
    };
  });
}

function computeGradeProgression(classBreakdown: ReturnType<typeof computeClassBreakdown>) {
  const grades = [1, 2, 3, 4];
  return grades.map((grade) => {
    const classesInGrade = classBreakdown.filter((c) => c.grade === grade);
    let lehrling = 0;
    let geselle = 0;
    let meister = 0;
    let totalConfirmed = 0;
    let pupilCount = 0;

    for (const c of classesInGrade) {
      lehrling += c.lehrling;
      geselle += c.geselle;
      meister += c.meister;
      totalConfirmed += c.totalConfirmed;
      pupilCount += c.pupilCount;
    }

    const pct = (n: number) => (totalConfirmed > 0 ? Math.round((n / totalConfirmed) * 100) : 0);

    return {
      grade,
      gradeLabel: `${grade}. Schulstufe`,
      classCount: classesInGrade.length,
      pupilCount,
      lehrling,
      geselle,
      meister,
      totalConfirmed,
      percentLehrling: pct(lehrling),
      percentGeselle: pct(geselle),
      percentMeister: pct(meister),
    };
  });
}
