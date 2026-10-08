import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import { auditLogs, finalRanks, observationRounds, pupils } from '../db/schema.js';
import { config } from '../config.js';
import {
  assertPasswordCurrent,
  badRequest,
  getClassAccess,
  getPupil,
  isRank,
  MAX_POSTGRES_INTEGER,
  parseIdParam,
  requireAuth,
  safeTeacherId,
  type AuthUser,
} from '../lib/guards.js';
import { calculateRank, demote, summarizeRatings, type RatingLike } from '../lib/ranking.js';
import { normalizeSubject } from '../utils/subject.js';
import { broadcastToClass } from '../ws/live-sync.js';

/**
 * Formal Notenkonferenz decisions.
 *
 * Access rule: the school administration plus the homeroom heads of the specific
 * class. That check now lives in guards.getClassAccess().canRunConference, replacing
 * the local copy that used a bare substring match on the teacher's short name.
 */

async function getActiveRound() {
  const [round] = await db
    .select()
    .from(observationRounds)
    .orderBy(desc(observationRounds.createdAt))
    .limit(1);
  return round ?? null;
}

async function countClassTeachers(classId: number): Promise<number> {
  const result = await getPool().query<{ count: number }>(
    'SELECT COUNT(DISTINCT teacher_id)::int AS count FROM teaching_assignments WHERE class_id = $1',
    [classId],
  );
  return result.rows[0]?.count || 1;
}

export const conferenceRoutes: FastifyPluginAsync = async (fastify) => {
  /** POST /api/conferences/:classId/lock — freeze/unfreeze voting. */
  fastify.post('/:classId/lock', {
    preValidation: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['classId'],
        additionalProperties: false,
        properties: { classId: { type: 'string', pattern: '^[1-9]\\d*$' } },
      },
      body: {
        type: 'object',
        required: ['isLocked'],
        additionalProperties: false,
        properties: { isLocked: { type: 'boolean' } },
      },
    },
  }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const { isLocked } = (request.body ?? {}) as { isLocked?: boolean };
    if (typeof isLocked !== 'boolean') return badRequest(reply, 'isLocked muss true oder false sein.');

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRunConference) {
      return reply.status(403).send({
        error: 'Nur Schulleitung (MED, SLC) oder Klassenvorstände können die Abstimmung sperren',
      });
    }

    // Voting lock is stored per class so it survives independently of the round.
    const round = await getActiveRound();
    if (round) {
      await db
        .update(observationRounds)
        .set({ isLocked: isLocked })
        .where(eq(observationRounds.id, round.id));
    }

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: isLocked ? 'VOTING_LOCKED' : 'VOTING_UNLOCKED',
      entity: 'class',
      entityId: String(cid),
      payload: { isLocked, roundId: round?.id ?? null },
    });

    broadcastToClass(cid, {
      type: 'VOTING_LOCK_CHANGED',
      classId: cid,
      isLocked,
      changedBy: safeTeacherId(user.teacherId),
    });

    return reply.send({ success: true, isLocked });
  });

  /**
   * POST /api/conferences/:classId/vote — record or withdraw one conference decision.
   *
   * The pupil is now verified to belong to the class. Previously any authorised user
   * for class A could confirm a rank for a pupil of class B, because `pupilId` was
   * taken from the body and never checked against `cid`.
   */
  fastify.post('/:classId/vote', {
    preValidation: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['classId'],
        additionalProperties: false,
        properties: { classId: { type: 'string', pattern: '^[1-9]\\d*$' } },
      },
      body: {
        type: 'object',
        required: ['pupilId'],
        additionalProperties: false,
        properties: {
          pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
          rank: { type: 'string', enum: ['Lehrling', 'Geselle', 'Meister'] },
          overrideReason: { type: 'string', nullable: true, maxLength: 2000 },
          action: { type: 'string', enum: ['confirm', 'unconfirm'] },
        },
      },
    },
  }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const {
      pupilId,
      rank,
      overrideReason,
      action = 'confirm',
    } = (request.body ?? {}) as {
      pupilId?: number;
      rank?: string;
      overrideReason?: string;
      action?: 'confirm' | 'unconfirm';
    };

    if (!pupilId) return badRequest(reply, 'PupilId ist erforderlich');
    if (action !== 'confirm' && action !== 'unconfirm') {
      return badRequest(reply, 'Unbekannte Aktion.');
    }
    const confirmationRank = typeof rank === 'string' && isRank(rank) ? rank : null;
    if (action === 'confirm' && !confirmationRank) {
      return badRequest(reply, 'Rang muss einer von "Lehrling", "Geselle", "Meister" sein.');
    }

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRunConference) {
      return reply.status(403).send({
        error: 'Nur Schulleitung (MED, SLC) oder die Klassenvorstände dieser Klasse dürfen Konferenzbeschlüsse erfassen.',
      });
    }

    const pupil = await getPupil(pupilId);
    if (!pupil) return reply.status(404).send({ error: 'Schüler nicht gefunden' });
    if (pupil.classId !== cid) {
      // This is the cross-class write the audit flagged.
      return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');
    }

    const round = await getActiveRound();
    if (!round) return badRequest(reply, 'Kein aktiver Beobachtungszeitraum gefunden');

    if (action === 'unconfirm') {
      await db
        .delete(finalRanks)
        .where(and(eq(finalRanks.roundId, round.id), eq(finalRanks.pupilId, pupilId)));

      await db.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'CONFERENCE_VOTE_REVOKED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: { classId: cid, pupilId },
      });

      broadcastToClass(cid, { type: 'FINAL_RANK_REVOKED', pupilId });
      return reply.send({ success: true, isConfirmed: false, pupilId });
    }

    // `action` is now narrowed to confirm; keep the write value explicitly narrowed
    // as well so no optional/unvalidated body value reaches Drizzle.
    if (!confirmationRank) {
      return badRequest(reply, 'Rang muss einer von "Lehrling", "Geselle", "Meister" sein.');
    }

    const confirmation = createConferenceConfirmationMetadata();
    const reason = overrideReason?.trim() || confirmation.overrideReason;
    if (reason.length > 2000) return badRequest(reply, 'Der Beschlussvermerk ist zu lang.');

    // The unique index on (round_id, pupil_id) makes this a real upsert.
    const [confirmed] = await db
      .insert(finalRanks)
      .values({
        roundId: round.id,
        pupilId,
        classId: cid,
        rank: confirmationRank,
        overrideReason: reason,
        confirmedBy: safeTeacherId(user.teacherId),
        confirmedAt: confirmation.confirmedAt,
      })
      .onConflictDoUpdate({
        target: [finalRanks.roundId, finalRanks.pupilId],
        set: {
          rank: confirmationRank,
          overrideReason: reason,
          confirmedBy: safeTeacherId(user.teacherId),
          confirmedAt: confirmation.confirmedAt,
        },
      })
      .returning();

    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'CONFERENCE_VOTE_CONFIRMED',
      entity: 'pupil',
      entityId: String(pupilId),
      payload: { rank: confirmationRank, overrideReason: reason },
    });

    broadcastToClass(cid, {
      type: 'FINAL_RANK_CONFIRMED',
      pupilId,
      rank: confirmationRank,
      confirmedAt: confirmed.confirmedAt,
    });

    return reply.send(confirmed);
  });

  /**
   * POST /api/conferences/:classId/vote-all — confirm a whole class in one transaction.
   *
   * The previous loop issued ~2N sequential round trips with no transaction, so a
   * failure halfway through left the class partly confirmed.
   */
  fastify.post('/:classId/vote-all', {
    preValidation: [fastify.authenticate],
    schema: {
      params: {
        type: 'object',
        required: ['classId'],
        additionalProperties: false,
        properties: { classId: { type: 'string', pattern: '^[1-9]\\d*$' } },
      },
      body: {
        type: 'object',
        required: ['items'],
        additionalProperties: false,
        properties: {
          items: {
            type: 'array',
            minItems: 1,
            maxItems: 200,
            items: {
              type: 'object',
              required: ['pupilId', 'rank'],
              additionalProperties: false,
              properties: {
                pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
                rank: { type: 'string', enum: ['Lehrling', 'Geselle', 'Meister'] },
                    },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const { items } = (request.body ?? {}) as {
      items?: Array<{ pupilId: number; rank: string }>;
    };
    if (!Array.isArray(items) || items.length === 0) {
      return badRequest(reply, 'Es wurden keine Beschlüsse übermittelt.');
    }
    if (items.length > 200) return badRequest(reply, 'Zu viele Beschlüsse auf einmal.');

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRunConference) {
      return reply.status(403).send({
        error: 'Nur Schulleitung (MED, SLC) oder die Klassenvorstände dieser Klasse dürfen Konferenzbeschlüsse erfassen.',
      });
    }

    const round = await getActiveRound();
    if (!round) return badRequest(reply, 'Kein aktiver Beobachtungszeitraum gefunden');

    // Validate every entry before writing anything.
    for (const item of items) {
      if (!item?.pupilId || !isRank(item.rank)) {
        return badRequest(reply, 'Jeder Beschluss benötigt eine gültige Schüler-ID und einen gültigen Rang.');
      }
      const pupil = await getPupil(item.pupilId);
      if (!pupil || pupil.classId !== cid) {
        return badRequest(reply, `Schüler ${item.pupilId} gehört nicht zu dieser Klasse.`);
      }
    }

    const confirmation = createConferenceConfirmationMetadata();
    const reason = confirmation.overrideReason;

    await db.transaction(async (tx) => {
      for (const item of items) {
        await tx
          .insert(finalRanks)
          .values({
            roundId: round.id,
            pupilId: item.pupilId,
            classId: cid,
            rank: item.rank,
            overrideReason: reason,
            confirmedBy: safeTeacherId(user.teacherId),
            confirmedAt: confirmation.confirmedAt,
          })
          .onConflictDoUpdate({
            target: [finalRanks.roundId, finalRanks.pupilId],
            set: {
              rank: item.rank,
              overrideReason: reason,
              confirmedBy: safeTeacherId(user.teacherId),
              confirmedAt: confirmation.confirmedAt,
            },
          });
      }

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'CONFERENCE_VOTE_CONFIRMED_BULK',
        entity: 'class',
        entityId: String(cid),
        payload: { count: items.length, roundId: round.id },
      });
    });

    for (const item of items) {
      broadcastToClass(cid, {
        type: 'FINAL_RANK_CONFIRMED',
        pupilId: item.pupilId,
        rank: item.rank,
        confirmedAt: confirmation.confirmedAt,
      });
    }

    return reply.send({ success: true, count: items.length });
  });

  /**
   * GET /api/conferences/:classId/summary — the data behind the conference view.
   *
   * Scoped: homeroom heads and school leadership see the full picture including other
   * teachers' comments. Other teachers get their own class view restricted to what
   * they are responsible for. The endpoint previously returned every teacher's
   * comments for any class to any authenticated user.
   */
  fastify.get('/:classId/summary', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user: AuthUser = requireAuth(request);
    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    // Conference summary overview is accessible to all staff members (teachers, leadership, admin)
    if (!access.canRead && !user.teacherId && user.role !== 'admin') {
      return reply.status(403).send({ error: 'Keine Zugriffsberechtigung für diese Klasse' });
    }

    const activePupils = await db
      .select()
      .from(pupils)
      .where(and(eq(pupils.classId, cid), eq(pupils.isArchived, false)))
      .orderBy(pupils.fullName);

    const round = await getActiveRound();
    const totalClassTeachers = await countClassTeachers(cid);

    const cardsRes = await getPool().query(
      `SELECT bc.id,
              bc.pupil_id,
              bc.card_type,
              bc.note,
              bc.created_at,
              t.id AS teacher_id,
              COALESCE(t.short_name, 'SL') AS teacher_short,
              COALESCE(t.full_name, 'Schulleitung') AS teacher_name
         FROM behavior_cards bc
         LEFT JOIN teachers t ON t.id = bc.teacher_id
        WHERE bc.class_id = $1 AND bc.revoked_at IS NULL
        ORDER BY bc.created_at DESC`,
      [cid],
    );
    const allCards: CardRow[] = cardsRes.rows;

    interface CardRow {
      id: string;
      pupil_id: number;
      card_type: string;
      note: string | null;
      created_at: Date;
      teacher_id: number | null;
      teacher_short: string;
      teacher_name: string;
    }

    interface EvalRow {
      id: string;
      pupil_id: number;
      teacher_id: number | null;
      subject_code: string;
      proposed_status: string | null;
      next_step: string | null;
      comment: string | null;
      is_submitted: boolean;
      submitted_at: Date | null;
      teacher_short: string;
      teacher_name: string;
    }

    interface ConfirmedRow {
      pupil_id: number;
      rank: string;
      votes_yes: number | null;
      votes_no: number | null;
      total_voters: number | null;
      override_reason: string | null;
      confirmed_at: Date | null;
    }

    let evals: EvalRow[] = [];
    let items: Array<RatingLike & { evaluation_id: string; item_key: string }> = [];
    let confirmedRanks: ConfirmedRow[] = [];

    if (round && activePupils.length > 0) {
      const evalsRes = await getPool().query<EvalRow>(
        `SELECT e.id, e.pupil_id, e.teacher_id, e.subject_code, e.proposed_status,
                e.next_step, e.comment, e.is_submitted, e.submitted_at,
                COALESCE(t.short_name, 'SL') AS teacher_short,
                COALESCE(t.full_name, 'Schulleitung') AS teacher_name
           FROM evaluations e
           LEFT JOIN teachers t ON t.id = e.teacher_id
          WHERE e.class_id = $1 AND e.round_id = $2`,
        [cid, round.id],
      );
      evals = evalsRes.rows;

      const evalIds = evals.map((e) => e.id);
      if (evalIds.length > 0) {
        const itemsRes = await getPool().query<RatingLike & { evaluation_id: string; item_key: string }>(
          `SELECT evaluation_id, criterion_id, item_key, rating
             FROM evaluation_items
            WHERE evaluation_id = ANY($1::uuid[])`,
          [evalIds],
        );
        items = itemsRes.rows;
      }

      const confirmedRes = await getPool().query<ConfirmedRow>(
        `SELECT pupil_id, rank, votes_yes, votes_no, total_voters, override_reason, confirmed_at
           FROM final_ranks
          WHERE class_id = $1 AND round_id = $2`,
        [cid, round.id],
      );
      confirmedRanks = confirmedRes.rows;
    }

    // Query teaching hours from timetable_lessons for this class
    const hoursRes = await getPool().query<{
      teacher_id: number;
      subject_code: string;
      hours: number;
    }>(
      `SELECT teacher_id, UPPER(TRIM(subject_code)) as subject_code, COUNT(*)::int as hours
         FROM timetable_lessons
        WHERE class_id = $1
        GROUP BY teacher_id, UPPER(TRIM(subject_code))`,
      [cid],
    );
    const hoursMap = new Map<string, number>();
    for (const h of hoursRes.rows) {
      hoursMap.set(`${h.teacher_id}_${h.subject_code}`, h.hours);
    }

    const teacherTotalHoursRes = await getPool().query<{
      teacher_id: number;
      total_hours: number;
    }>(
      `SELECT teacher_id, COUNT(*)::int as total_hours
         FROM timetable_lessons
        WHERE class_id = $1
        GROUP BY teacher_id`,
      [cid],
    );
    const teacherTotalHoursMap = new Map<number, number>();
    for (const th of teacherTotalHoursRes.rows) {
      teacherTotalHoursMap.set(th.teacher_id, th.total_hours);
    }

    const itemsByEval = new Map<string, Array<RatingLike & { item_key: string }>>();
    for (const it of items) {
      const list = itemsByEval.get(it.evaluation_id) ?? [];
      list.push(it);
      itemsByEval.set(it.evaluation_id, list);
    }

    const summary = activePupils.map((p) => {
      const pupilEvals = evals.filter((e) => e.pupil_id === p.id);
      const pupilCards = allCards.filter((c) => c.pupil_id === p.id);

      const mapCards = (type: string) =>
        pupilCards
          .filter((c) => c.card_type === type)
          .map((c) => ({
            id: c.id,
            teacherShort: c.teacher_short,
            teacherName: c.teacher_name,
            note: c.note,
            createdAt: c.created_at,
          }));

      // Count how many teachers submitted for each core subject (D, M, E) for this pupil
      const coreTeacherCounts: Record<string, number> = { D: 0, M: 0, E: 0 };
      pupilEvals.forEach((e) => {
        const norm = normalizeSubject(e.subject_code);
        if (norm.isCoreSmile && norm.code in coreTeacherCounts) {
          coreTeacherCounts[norm.code] = (coreTeacherCounts[norm.code] || 0) + 1;
        }
      });

      const teacherVotes = pupilEvals.map((e) => {
        const evalItems = itemsByEval.get(e.id) ?? [];
        const summaryCounts = summarizeRatings([{ evaluationId: e.id, items: evalItems }]);
        const normSub = normalizeSubject(e.subject_code);
        const subCodeUpper = e.subject_code.trim().toUpperCase();

        // 1. Look up weekly hours from timetable_lessons
        let hours = (e.teacher_id ? hoursMap.get(`${e.teacher_id}_${subCodeUpper}`) : undefined);
        if (!hours && e.teacher_id) {
          hours = hoursMap.get(`${e.teacher_id}_${normSub.code}`);
        }
        if (!hours && e.teacher_id) {
          hours = teacherTotalHoursMap.get(e.teacher_id);
        }
        if (!hours) {
          hours = normSub.isCoreSmile ? 4 : 2;
        }

        // 2. Weighting & Team-Teaching rule:
        // Core subjects (D, M, E) have double weight because two teachers give votes.
        // If only 1 teacher from the team submitted for this pupil, double their hours so the
        // core subject retains its full 2-teacher weight (e.g. 4 * 2 = 8h).
        // If both teachers submitted, each contributes their own hours (e.g. 4 + 4 = 8h).
        let weight = hours;
        const isTeamTeaching = normSub.isCoreSmile;
        if (isTeamTeaching) {
          const teacherCountForThisCoreSub = coreTeacherCounts[normSub.code] || 1;
          if (teacherCountForThisCoreSub === 1) {
            weight = hours * 2;
          }
        }

        return {
          teacherId: e.teacher_id,
          teacherShort: e.teacher_short,
          teacherName: e.teacher_name,
          subjectCode: e.subject_code,
          proposedStatus: e.proposed_status || null,
          nextStep: e.next_step || null,
          comment: e.comment || null,
          isSubmitted: !!e.is_submitted,
          submittedAt: e.submitted_at || null,
          positiveCount: summaryCounts.positiveCount,
          totalRated: summaryCounts.totalRated,
          hours,
          weight,
          isTeamTeaching,
        };
      });

      // Participation counts distinct teachers who actually submitted, not evaluation rows:
      // a teacher covering two core subjects in this class submitted twice but is one voter,
      // and a teacher who submitted nothing must not appear at all.
      const submittedTeacherIds = new Set<number | null>();
      for (const tv of teacherVotes) {
        if (tv.isSubmitted) submittedTeacherIds.add(tv.teacherId);
      }
      const submittedTeachers = submittedTeacherIds.size;

      // Hours-weighted split. Weighting is the school's existing rule (weekly lessons,
      // doubled for a core subject when only one team teacher submitted), so a teacher who
      // teaches more lessons in this class carries proportionally more of the vote.
      let hoursLehrling = 0;
      let hoursGeselle = 0;
      let hoursMeister = 0;

      for (const tv of teacherVotes) {
        if (tv.proposedStatus === 'Meister') hoursMeister += tv.weight;
        else if (tv.proposedStatus === 'Geselle') hoursGeselle += tv.weight;
        else if (tv.proposedStatus === 'Lehrling') hoursLehrling += tv.weight;
      }

      const totalVotedHours = hoursLehrling + hoursGeselle + hoursMeister;
      const pctLehrling = totalVotedHours > 0 ? Math.round((hoursLehrling / totalVotedHours) * 100) : 0;
      const pctGeselle = totalVotedHours > 0 ? Math.round((hoursGeselle / totalVotedHours) * 100) : 0;
      const pctMeister = totalVotedHours > 0 ? Math.round((hoursMeister / totalVotedHours) * 100) : 0;

      // Determine hours-weighted majority rank:
      let suggestedRankByHours: 'Lehrling' | 'Geselle' | 'Meister' = 'Geselle';
      if (hoursMeister >= hoursGeselle && hoursMeister >= hoursLehrling && hoursMeister > 0) {
        suggestedRankByHours = 'Meister';
      } else if (hoursLehrling > hoursGeselle && hoursLehrling > hoursMeister) {
        suggestedRankByHours = 'Lehrling';
      } else {
        suggestedRankByHours = 'Geselle';
      }

      // Automatic threshold rank is determined by the core subjects (D, M, E).
      // Non-core subject observations are supplementary and for individual teacher notes.
      const coreEvals = pupilEvals.filter((e) => normalizeSubject(e.subject_code).isCoreSmile);
      const evalsForCalc = coreEvals.length > 0 ? coreEvals : pupilEvals;
      const pupilGroups = evalsForCalc.map((e) => ({
        evaluationId: e.id,
        items: itemsByEval.get(e.id) ?? [],
      }));
      const counts = summarizeRatings(pupilGroups);
      const redCards = mapCards('red');
      const outcome = calculateRank(counts.scoreForThreshold, redCards.length > 0);
      const weightedRank = redCards.length > 0 ? demote(suggestedRankByHours) : suggestedRankByHours;

      const confirmed = confirmedRanks.find((r) => r.pupil_id === p.id);

      return {
        id: p.id,
        fullName: p.fullName,
        positiveCount: counts.positiveCount,
        totalRated: counts.totalRated,
        baseRank: outcome.baseRank,
        calculatedRank: outcome.finalRank,
        weightedRank,
        hasRedCardDemotion: outcome.hasRedCardDemotion,
        finalRank: confirmed?.rank || outcome.finalRank,
        isConfirmed: !!confirmed,
        confirmedAt: confirmed?.confirmed_at || null,
        overrideReason: confirmed?.override_reason || null,
        evaluationsCount: counts.evaluationCount,
        teacherVotes,
        /**
         * Participation, measured only from evaluations that were actually submitted.
         *
         * The previous payload exposed votesYes/votesNo/totalVoters, where the "yes" count
         * was totalClassTeachers minus a number the administrator typed. That made every
         * teacher who never opened the app count as agreeing, and it contradicted the
         * hours-weighted split shown next to it. The tally is no longer stored on the
         * confirmation: it is derived here from real ballots, and a teacher who has not
         * voted contributes nothing.
         */
        participation: {
          submittedTeachers,
          eligibleTeachers: totalClassTeachers,
          teachersMissing: Math.max(0, totalClassTeachers - submittedTeachers),
        },
        voteStats: {
          Lehrling: teacherVotes.filter((tv) => tv.proposedStatus === 'Lehrling').length,
          Geselle: teacherVotes.filter((tv) => tv.proposedStatus === 'Geselle').length,
          Meister: teacherVotes.filter((tv) => tv.proposedStatus === 'Meister').length,
          hoursLehrling,
          hoursGeselle,
          hoursMeister,
          totalVotedHours,
          pctLehrling,
          pctGeselle,
          pctMeister,
          suggestedRankByHours,
          weightedRank,
        },
        cards: {
          green: mapCards('green'),
          yellow: mapCards('yellow'),
          red: redCards,
        },
      };
    });

    return reply.send({
      class: { id: access.classId },
      round,
      totalClassTeachers,
      isAuthorized: access.canRunConference,
      canRate: access.canRate,
      summary,
    });
  });
};

function defaultConferenceReason(): string {
  return `Beschluss der Klassenkonferenz vom ${config.officialConferenceDate.toISOString().slice(0, 10)}`;
}

export function createConferenceConfirmationMetadata(recordedAt = new Date()): {
  confirmedAt: Date;
  overrideReason: string;
} {
  return {
    confirmedAt: recordedAt,
    overrideReason: defaultConferenceReason(),
  };
}

/** Re-export for tests. */
export { countClassTeachers };
