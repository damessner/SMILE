import type { FastifyPluginAsync } from 'fastify';
import { config } from '../config.js';
import { and, desc, eq, gt, inArray, isNull, ne } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import { safeErrorLogFields } from '../lib/log-safety.js';
import { effectiveCardDemotionSteps } from '../lib/rank-demotion.js';
import {
  assessmentRubrics,
  behaviorCards,
  evaluationItems,
  evaluations,
  finalRanks,
  pupils,
  rubricCriteria,
  schoolClasses,
  teachingAssignments,
  pupilSubjectTeachers,
} from '../db/schema.js';
import {
  badRequest,
  forbid,
  getClassAccess,
  getGlobalAccess,
  isSchoolLeader,
  parseIdParam,
  requireAuth,
  type ClassAccess,
} from '../lib/guards.js';
import { normalizeSubject } from '../utils/subject.js';
import { getClassRoundLockState, isClassRoundLocked } from '../lib/class-round-lock.js';
import { getLatestRound } from '../lib/rounds.js';
import { paginate, parsePageParams } from '../lib/pagination.js';

/**
 * Per-class permission results, filled in as classes are opened.
 *
 * Removed: this map was written on two paths and read by none. It held a full
 * `ClassAccess` per class, was never invalidated, and was only exported so a test could
 * observe it — which no test did. `GET /api/classes` resolves every class's access on
 * each request, which is correct and cheap enough at 15 classes; a cache that is never
 * read and never invalidated is not a speed-up.
 */

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
  /** GET /api/classes/all — all real school classes for school-wide overview and reports */
  fastify.get('/all', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!(await isSchoolLeader(user))) {
      return forbid(reply, 'Die Gesamtklassenliste ist der Schulleitung vorbehalten.');
    }

    const parsed = parsePageParams(request.query);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });

    const realClasses = await db
      .select()
      .from(schoolClasses)
      .where(and(ne(schoolClasses.name, 'LW'), gt(schoolClasses.grade, 0)))
      .orderBy(schoolClasses.grade, schoolClasses.name, schoolClasses.id);

    return reply.send(paginate(realClasses, parsed.page));
  });

  /** GET /api/classes — the classes this user may open. */
  fastify.get('/', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const global = await getGlobalAccess(user);

    const parsed = parsePageParams(request.query);
    if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
    const page = parsed.page;

    const realClasses = await db
      .select()
      .from(schoolClasses)
      .where(and(ne(schoolClasses.name, 'LW'), gt(schoolClasses.grade, 0)))
      .orderBy(schoolClasses.grade, schoolClasses.name, schoolClasses.id);

    const { all } = (request.query || {}) as { all?: string };
    if (all === 'true' || all === '1') {
      if (!(await isSchoolLeader(user))) {
        return forbid(reply, 'Die Gesamtklassenliste ist der Schulleitung vorbehalten.');
      }
      return reply.send(paginate(realClasses, page));
    }

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
        fastify.log.warn(safeErrorLogFields(err), 'Failed to query timetable lessons for classes');
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
        paginate(realClasses, page).map((c) => {
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

    // Filter by access first, then page: paging before the filter would hand back
    // short or empty pages for a teacher whose classes sit beyond the first window.
    const classes = paginate(
      realClasses.filter((c) => global.classIds!.includes(c.id)),
      page,
    );

    // Resolve permissions for exactly the classes being listed.
    const resolved = await Promise.all(classes.map((c) => getClassAccess(user, c.id)));


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
  fastify.get('/:classId/rubric', { preValidation: [fastify.authenticate] }, async (request, reply) => {
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

    const round = await getLatestRound();

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
  fastify.get('/:classId/pupils', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    // The rubric thresholds are part of the answer, not a fixed constant: the
    // client's raster maths and the server's `lib/ranking.ts` must not drift, or
    // a pupil can read Meister on screen while the server stores Lehrling.
    const rubricConfig = {
      meister: config.rankThresholds.meister,
      geselle: config.rankThresholds.geselle,
      itemCount: config.rubricItemCount,
      aggregation: config.rankAggregation,
    };

    if (cid === 999) {
      const [cls] = await db.select().from(schoolClasses).where(eq(schoolClasses.id, 999)).limit(1);
      return reply.send({
        class: cls ?? { id: 999, name: 'LW', grade: 0 },
        submissionDeadline: config.submissionDeadline.toISOString(),
        rubricConfig,
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



    const [classPupils, round, cards, pupilTeachers, hoursRows, resolvedClassName] =
      await Promise.all([
        db
          .select()
          .from(pupils)
          .where(and(eq(pupils.classId, cid), eq(pupils.isArchived, false)))
          .orderBy(pupils.fullName),
        getLatestRound(),
        db
          .select()
          .from(behaviorCards)
          .where(and(eq(behaviorCards.classId, cid), isNull(behaviorCards.revokedAt)))
          .orderBy(desc(behaviorCards.createdAt)),
        db
          .select()
          .from(pupilSubjectTeachers)
          .where(eq(pupilSubjectTeachers.classId, cid)),
        user.teacherId
          ? getPool()
              .query<{ class_id: number; subject_code: string; hours: number }>(
                `SELECT class_id, UPPER(TRIM(subject_code)) as subject_code, COUNT(*)::int as hours
                   FROM timetable_lessons
                  WHERE teacher_id = $1 AND class_id = $2
                  GROUP BY class_id, UPPER(TRIM(subject_code))`,
                [user.teacherId, cid],
              )
              .then((res) => res.rows)
              .catch((err) => {
                fastify.log.warn(safeErrorLogFields(err), 'Failed to query timetable lessons for class pupils');
                return [];
              })
          : Promise.resolve([]),
        className(cid),
      ]);

    let classEvaluations: Array<typeof evaluations.$inferSelect> = [];
    const itemsByEvaluationId: Record<string, Array<typeof evaluationItems.$inferSelect>> = {};
    const finalRankByPupil = new Map<number, { rank: string; confirmedAt: Date | null }>();
    let isLockedByConference = false;

    if (round && classPupils.length > 0) {
      const [confirmedRanks, evalRows, isClassLocked] = await Promise.all([
        db
          .select({
            pupilId: finalRanks.pupilId,
            rank: finalRanks.rank,
            confirmedAt: finalRanks.confirmedAt,
          })
          .from(finalRanks)
          .where(and(eq(finalRanks.roundId, round.id), eq(finalRanks.classId, cid))),
        db
          .select()
          .from(evaluations)
          .where(and(eq(evaluations.classId, cid), eq(evaluations.roundId, round.id))),
        getClassRoundLockState(round.id, cid),
      ]);
      for (const row of confirmedRanks) {
        finalRankByPupil.set(row.pupilId, {
          rank: row.rank,
          confirmedAt: row.confirmedAt ?? null,
        });
      }
      classEvaluations = evalRows;
      isLockedByConference = isClassRoundLocked(round.isLocked, isClassLocked);

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
    } else if (round) {
      const isClassLocked = await getClassRoundLockState(round.id, cid);
      isLockedByConference = isClassRoundLocked(round.isLocked, isClassLocked);
    }

    const pupilTeachersMap = new Map<number, Record<string, number[]>>();
    const pupilGroupsMap = new Map<number, Record<string, string>>();

    for (const pt of pupilTeachers) {
      const code = pt.subjectCode;
      let teacherSubMap = pupilTeachersMap.get(pt.pupilId);
      if (!teacherSubMap) {
        teacherSubMap = {};
        pupilTeachersMap.set(pt.pupilId, teacherSubMap);
      }
      if (!teacherSubMap[code]) {
        teacherSubMap[code] = [];
      }
      if (!teacherSubMap[code].includes(pt.teacherId)) {
        teacherSubMap[code].push(pt.teacherId);
      }

      if (pt.groupName) {
        let groupSubMap = pupilGroupsMap.get(pt.pupilId);
        if (!groupSubMap) {
          groupSubMap = {};
          pupilGroupsMap.set(pt.pupilId, groupSubMap);
        }
        groupSubMap[code] = pt.groupName;
      }
    }

    const hideForeignComments = !config.statisticsShowForeignComments && !access.canRunConference;
    const pupilsWithData = classPupils.map((p) => {
      const pupilEvals = classEvaluations.filter((e) => e.pupilId === p.id);
      const pupilCards = cards.filter((c) => c.pupilId === p.id);
      const confirmed = finalRankByPupil.get(p.id) ?? null;

      return {
        ...p,
        evaluations: pupilEvals.map((e) => ({
          ...e,
          // When the school disables shared comments, blank the fields on rows
          // authored by another teacher. The row (rank, submission state, items)
          // stays visible so collaboration still works.
          comment: hideForeignComments && e.teacherId !== user.teacherId ? null : e.comment,
          nextStep: hideForeignComments && e.teacherId !== user.teacherId ? null : e.nextStep,
          items: itemsByEvaluationId[e.id] ?? [],
        })),
        cards: pupilCards,
        greenCardCount: pupilCards.filter((c) => c.cardType === 'green').length,
        yellowCardCount: pupilCards.filter((c) => c.cardType === 'yellow').length,
        redCardCount: pupilCards.filter((c) => c.cardType === 'red').length,
        rankDemotionSteps: confirmed
          ? effectiveCardDemotionSteps(pupilCards, round, confirmed.confirmedAt)
          : effectiveCardDemotionSteps(pupilCards, round),
        finalRank: confirmed?.rank ?? null,
        finalRankConfirmedAt: confirmed?.confirmedAt
          ? new Date(confirmed.confirmedAt).toISOString()
          : null,
        assignedTeachers: pupilTeachersMap.get(p.id) ?? {},
        assignedGroups: pupilGroupsMap.get(p.id) ?? {},
      };
    });

    // Look up teacher's timetable lesson hours for this class and subjects
    const userHoursMap = new Map<string, number>();
    for (const h of hoursRows) {
      const norm = normalizeSubject(h.subject_code).code;
      userHoursMap.set(norm, (userHoursMap.get(norm) || 0) + h.hours);
    }

    const mySubjectsWithHours = access.subjects.map((s) => ({
      ...s,
      hours: userHoursMap.get(s.code) || 0,
    }));

    return reply.send({
      class: {
        id: access.classId,
        name: resolvedClassName ?? String(cid),
      },
      round,
      roundId: round?.id ?? null,
      isLockedByConference,
      canAccessRaster: access.isCoreTeacher,
      isCoreTeacher: access.isCoreTeacher,
      canRate: access.canRate,
      isKv: access.isKv,
      submissionDeadline: config.submissionDeadline.toISOString(),
      rubricConfig,
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
export {};
