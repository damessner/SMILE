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
  parseIdParam,
  requireAuth,
  type AuthUser,
} from '../lib/guards.js';
import { calculateRank, summarizeRatings, type RatingLike } from '../lib/ranking.js';
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
  fastify.post('/:classId/lock', { preHandler: [fastify.authenticate] }, async (request, reply) => {
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
      actorId: user.teacherId ?? null,
      action: isLocked ? 'VOTING_LOCKED' : 'VOTING_UNLOCKED',
      entity: 'class',
      entityId: String(cid),
      payload: { isLocked, roundId: round?.id ?? null },
    });

    broadcastToClass(cid, {
      type: 'VOTING_LOCK_CHANGED',
      classId: cid,
      isLocked,
      changedBy: user.teacherId ?? null,
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
  fastify.post('/:classId/vote', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const {
      pupilId,
      rank,
      votesNo = 0,
      overrideReason,
      action = 'confirm',
    } = (request.body ?? {}) as {
      pupilId?: number;
      rank?: string;
      votesNo?: number;
      overrideReason?: string;
      action?: 'confirm' | 'unconfirm';
    };

    if (!pupilId) return badRequest(reply, 'PupilId ist erforderlich');
    if (action !== 'confirm' && action !== 'unconfirm') {
      return badRequest(reply, 'Unbekannte Aktion.');
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
        actorId: user.teacherId ?? null,
        action: 'CONFERENCE_VOTE_REVOKED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: { classId: cid, pupilId },
      });

      broadcastToClass(cid, { type: 'FINAL_RANK_REVOKED', pupilId });
      return reply.send({ success: true, isConfirmed: false, pupilId });
    }

    if (!rank || !isRank(rank)) {
      return badRequest(reply, 'Rang muss einer von "Lehrling", "Geselle", "Meister" sein.');
    }

    const totalClassTeachers = await countClassTeachers(cid);
    const cleanVotesNo = Math.max(0, Math.min(Math.trunc(votesNo) || 0, totalClassTeachers));
    const cleanVotesYes = Math.max(0, totalClassTeachers - cleanVotesNo);
    const reason = overrideReason?.trim() || defaultConferenceReason();
    if (reason.length > 2000) return badRequest(reply, 'Der Beschlussvermerk ist zu lang.');

    // The unique index on (round_id, pupil_id) makes this a real upsert.
    const [confirmed] = await db
      .insert(finalRanks)
      .values({
        roundId: round.id,
        pupilId,
        classId: cid,
        rank,
        votesYes: cleanVotesYes,
        votesNo: cleanVotesNo,
        totalVoters: totalClassTeachers,
        overrideReason: reason,
        confirmedBy: user.teacherId ?? null,
        confirmedAt: config.officialConferenceDate,
      })
      .onConflictDoUpdate({
        target: [finalRanks.roundId, finalRanks.pupilId],
        set: {
          rank,
          votesYes: cleanVotesYes,
          votesNo: cleanVotesNo,
          totalVoters: totalClassTeachers,
          overrideReason: reason,
          confirmedBy: user.teacherId ?? null,
          confirmedAt: config.officialConferenceDate,
        },
      })
      .returning();

    await db.insert(auditLogs).values({
      actorId: user.teacherId ?? null,
      action: 'CONFERENCE_VOTE_CONFIRMED',
      entity: 'pupil',
      entityId: String(pupilId),
      payload: { rank, votesYes: cleanVotesYes, votesNo: cleanVotesNo, totalVoters: totalClassTeachers, overrideReason: reason },
    });

    broadcastToClass(cid, {
      type: 'FINAL_RANK_CONFIRMED',
      pupilId,
      rank,
      votesYes: cleanVotesYes,
      votesNo: cleanVotesNo,
      totalVoters: totalClassTeachers,
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
  fastify.post('/:classId/vote-all', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const { items } = (request.body ?? {}) as {
      items?: Array<{ pupilId: number; rank: string; votesNo?: number }>;
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

    const totalClassTeachers = await countClassTeachers(cid);

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

    const reason = defaultConferenceReason();

    await db.transaction(async (tx) => {
      for (const item of items) {
        const cleanVotesNo = Math.max(0, Math.min(Math.trunc(item.votesNo ?? 0) || 0, totalClassTeachers));
        const cleanVotesYes = Math.max(0, totalClassTeachers - cleanVotesNo);

        await tx
          .insert(finalRanks)
          .values({
            roundId: round.id,
            pupilId: item.pupilId,
            classId: cid,
            rank: item.rank,
            votesYes: cleanVotesYes,
            votesNo: cleanVotesNo,
            totalVoters: totalClassTeachers,
            overrideReason: reason,
            confirmedBy: user.teacherId ?? null,
            confirmedAt: config.officialConferenceDate,
          })
          .onConflictDoUpdate({
            target: [finalRanks.roundId, finalRanks.pupilId],
            set: {
              rank: item.rank,
              votesYes: cleanVotesYes,
              votesNo: cleanVotesNo,
              totalVoters: totalClassTeachers,
              overrideReason: reason,
              confirmedBy: user.teacherId ?? null,
              confirmedAt: config.officialConferenceDate,
            },
          });
      }

      await tx.insert(auditLogs).values({
        actorId: user.teacherId ?? null,
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
        confirmedAt: config.officialConferenceDate,
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
  fastify.get('/:classId/summary', { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const user: AuthUser = requireAuth(request);
    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRead) {
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

      const teacherVotes = pupilEvals.map((e) => {
        const evalItems = itemsByEval.get(e.id) ?? [];
        const summaryCounts = summarizeRatings([{ evaluationId: e.id, items: evalItems }]);
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
        };
      });

      const pupilGroups = pupilEvals.map((e) => ({
        evaluationId: e.id,
        items: itemsByEval.get(e.id) ?? [],
      }));
      const counts = summarizeRatings(pupilGroups);
      const redCards = mapCards('red');
      const outcome = calculateRank(counts.scoreForThreshold, redCards.length > 0);

      const confirmed = confirmedRanks.find((r) => r.pupil_id === p.id);

      return {
        id: p.id,
        fullName: p.fullName,
        positiveCount: counts.positiveCount,
        totalRated: counts.totalRated,
        baseRank: outcome.baseRank,
        calculatedRank: outcome.finalRank,
        hasRedCardDemotion: outcome.hasRedCardDemotion,
        finalRank: confirmed?.rank || outcome.finalRank,
        isConfirmed: !!confirmed,
        confirmedAt: confirmed?.confirmed_at || null,
        votesYes: confirmed?.votes_yes ?? totalClassTeachers,
        votesNo: confirmed?.votes_no ?? 0,
        totalVoters: confirmed?.total_voters || totalClassTeachers,
        overrideReason: confirmed?.override_reason || null,
        evaluationsCount: counts.evaluationCount,
        teacherVotes,
        voteStats: {
          Lehrling: teacherVotes.filter((tv) => tv.proposedStatus === 'Lehrling').length,
          Geselle: teacherVotes.filter((tv) => tv.proposedStatus === 'Geselle').length,
          Meister: teacherVotes.filter((tv) => tv.proposedStatus === 'Meister').length,
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

/** Re-export for tests. */
export { countClassTeachers };