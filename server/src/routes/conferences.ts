import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import { auditLogs, classRoundLocks, finalRanks, observationRounds, pupils } from '../db/schema.js';
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
import { demote, summarizeRatings, type Rank, type RatingLike } from '../lib/ranking.js';
import { buildSubjectEvidence } from '../lib/subject-evidence.js';
import { normalizeSubject } from '../utils/subject.js';
import { broadcastToClass } from '../ws/live-sync.js';
import { acquireClassRoundLock, getClassRoundLockState, isClassRoundLocked } from '../lib/class-round-lock.js';
import { getLatestRound } from '../lib/rounds.js';
import {
  hoursWeightedSuggestion,
  summarizeSubmittedTeacherVotes,
  type ConferenceTeacherVote,
  type SubmittedTeacherVoteSummary,
} from '../lib/conference-rank.js';
import type { ClassAccess, Identity } from '../lib/guards.js';

export { hoursWeightedSuggestion, summarizeSubmittedTeacherVotes };
export type { ConferenceTeacherVote, SubmittedTeacherVoteSummary };

/**
 * Formal Notenkonferenz decisions.
 *
 * Access rule: the school administration plus the homeroom heads of the specific
 * class. That check now lives in guards.getClassAccess().canRunConference, replacing
 * the local copy that used a bare substring match on the teacher's short name.
 */

// Round resolution now lives in ../lib/rounds.js so the conference, evaluation
// and live-sync paths agree on which round is "the latest one".
const getActiveRound = getLatestRound;

async function countClassTeachers(classId: number): Promise<number> {
  const result = await getPool().query<{ count: number }>(
    'SELECT COUNT(DISTINCT teacher_id)::int AS count FROM teaching_assignments WHERE class_id = $1',
    [classId],
  );
  return result.rows[0]?.count || 1;
}

/**
 * May this caller read the conference summary for one class?
 *
 * The payload carries every pupil, every behaviour card and its note, every other
 * teacher's `comment` / `nextStep`, and every confirmed rank. It therefore rests on
 * `canRead` and nothing else.
 *
 * Extracted from the handler so it can be tested without a database, and so the next
 * edit to this file cannot silently reintroduce a wider gate: the previous condition was
 * `!access.canRead && !user.teacherId && user.role !== 'admin'`, whose second conjunct
 * is false for every teacher, so no teacher was ever refused.
 */
export function canReadConferenceSummary(_user: Identity, access: ClassAccess): boolean {
  if (!access.exists) return false;
  return access.canRead;
}

// Conference rank helpers (hours-weighted suggestion, submitted-vote summary)
// live in lib/conference-rank.ts because the staff-notification path also needs
// the pupil-level rank. Re-exported above for existing callers and tests.

export function presentRank(
  confirmedRank: Rank | null | undefined,
  suggestion: Rank | null,
  hasActiveRedCard: boolean,
): { presentedRank: Rank | null; suggestedRank: Rank | null; hasRedCardDemotion: boolean } {
  // A confirmed rank is the official conference decision and is stored exactly
  // as the chair confirmed it. A red card demotes the *suggestion* shown before
  // confirmation; applying it again to the confirmed value would demote twice
  // when the chair accepts the already-demoted suggestion.
  const presentedRank = confirmedRank ?? null;
  const suggestedRank = hasActiveRedCard && suggestion ? demote(suggestion) : suggestion;
  return {
    presentedRank,
    suggestedRank,
    hasRedCardDemotion: hasActiveRedCard && (presentedRank !== null || suggestedRank !== null),
  };
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

    const round = await getActiveRound();
    if (!round) {
      return reply.status(400).send({ error: 'Kein aktiver Beobachtungszeitraum gefunden.' });
    }

    // Voting lock is stored per class in class_round_locks, not in observation_rounds.
    //
    // The row and its audit entry are written in one transaction: a freeze with no
    // audit trail cannot be explained afterwards, and an audit entry with no row
    // records a freeze that never happened. Wrapping them also means a failing
    // audit insert cannot leave the class frozen, which is why the broadcast is
    // issued after the commit rather than beside it.
    await db.transaction(async (tx) => {
      // Serialise against rating writes. A write that already passed its own
      // pre-check either commits before this point or sees the lock below.
      await acquireClassRoundLock(tx, round.id, cid);
      await tx
        .insert(classRoundLocks)
        .values({
          roundId: round.id,
          classId: cid,
          isLocked,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [classRoundLocks.roundId, classRoundLocks.classId],
          set: {
            isLocked,
            updatedAt: new Date(),
          },
        });

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: isLocked ? 'VOTING_LOCKED' : 'VOTING_UNLOCKED',
        entity: 'class',
        entityId: String(cid),
        payload: { isLocked, roundId: round.id, classId: cid },
      });
    });

    // Clients store this payload into the same map entry SYNCED fills with the
    // effective (round || class) lock state, so the broadcast must carry the
    // effective value too: releasing a class lock must never advertise an open
    // grid while the round itself is closed.
    const effectiveLocked = isClassRoundLocked(round.isLocked, isLocked);
    broadcastToClass(cid, {
      type: 'VOTING_LOCK_CHANGED',
      classId: cid,
      roundId: round.id,
      isLocked: effectiveLocked,
      changedBy: safeTeacherId(user.teacherId),
    });

    return reply.send({ success: true, classId: cid, roundId: round.id, isLocked });
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
      // Revocation and its audit row commit together. Split apart, a committed deletion
      // with no CONFERENCE_VOTE_REVOKED row would remove a conference decision from the
      // official record without leaving a trace of who withdrew it.
      await db.transaction(async (tx) => {
        await tx
          .delete(finalRanks)
          .where(and(eq(finalRanks.roundId, round.id), eq(finalRanks.pupilId, pupilId)));

        await tx.insert(auditLogs).values({
          actorId: safeTeacherId(user.teacherId),
          action: 'CONFERENCE_VOTE_REVOKED',
          entity: 'pupil',
          entityId: String(pupilId),
          payload: { classId: cid, pupilId },
        });
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

    // The decision and its audit row commit together; a confirmed rank that the audit
    // history never recorded is the one outcome a conference decision must not have.
    const confirmed = await db.transaction(async (tx) => {
      // The unique index on (round_id, pupil_id) makes this a real upsert.
      const [row] = await tx
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

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'CONFERENCE_VOTE_CONFIRMED',
        entity: 'pupil',
        entityId: String(pupilId),
        payload: { rank: confirmationRank, overrideReason: reason },
      });

      return row;
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

    // Validate every entry before writing anything, and check class membership in one
    // query. The previous loop called `getPupil` per entry, so a full-class conference
    // issued 200 sequential round trips just to answer "is this pupil in this class?".
    for (const item of items) {
      if (!item?.pupilId || !isRank(item.rank)) {
        return badRequest(reply, 'Jeder Beschluss benötigt eine gültige Schüler-ID und einen gültigen Rang.');
      }
    }
    const requestedIds = [...new Set(items.map((item) => item.pupilId))];
    const roster = await db
      .select({ id: pupils.id, classId: pupils.classId })
      .from(pupils)
      .where(inArray(pupils.id, requestedIds));
    const pupilClass = new Map(roster.map((row) => [row.id, row.classId]));
    for (const item of items) {
      if (pupilClass.get(item.pupilId) !== cid) {
        return badRequest(reply, `Schüler ${item.pupilId} gehört nicht zu dieser Klasse.`);
      }
    }

    const confirmation = createConferenceConfirmationMetadata();
    const reason = confirmation.overrideReason;
    const confirmedBy = safeTeacherId(user.teacherId);

    // One decision per pupil, last one wins. A duplicated pupilId would otherwise make
    // PostgreSQL reject the whole batch with "ON CONFLICT DO UPDATE command cannot affect
    // row a second time" - a single confused client request must not fail the conference.
    const decisions = new Map<number, string>();
    for (const item of items) decisions.set(item.pupilId, item.rank);

    await db.transaction(async (tx) => {
      // One multi-row statement instead of one upsert per pupil: the round trips the old
      // loop spent were sequential while the transaction stayed open for the whole class.
      await tx
        .insert(finalRanks)
        .values(
          [...decisions].map(([pupilId, rank]) => ({
            roundId: round.id,
            pupilId,
            classId: cid,
            rank,
            overrideReason: reason,
            confirmedBy,
            confirmedAt: confirmation.confirmedAt,
          })),
        )
        .onConflictDoUpdate({
          target: [finalRanks.roundId, finalRanks.pupilId],
          set: {
            rank: sql`excluded.rank`,
            overrideReason: sql`excluded.override_reason`,
            confirmedBy: sql`excluded.confirmed_by`,
            confirmedAt: sql`excluded.confirmed_at`,
          },
        });

      await tx.insert(auditLogs).values({
        actorId: confirmedBy,
        action: 'CONFERENCE_VOTE_CONFIRMED_BULK',
        entity: 'class',
        entityId: String(cid),
        payload: { count: decisions.size, roundId: round.id },
      });
    });

    for (const [pupilId, rank] of decisions) {
      broadcastToClass(cid, {
        type: 'FINAL_RANK_CONFIRMED',
        pupilId,
        rank,
        confirmedAt: confirmation.confirmedAt,
      });
    }

    return reply.send({ success: true, count: decisions.size });
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
    if (!canReadConferenceSummary(user, access)) {
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
      updated_at: Date;
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
                e.next_step, e.comment, e.is_submitted, e.submitted_at, e.updated_at,
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
          weight: hours,
          isTeamTeaching: normSub.isCoreSmile,
        };
      });

      // A proposal is an active conference vote only while its evaluation is
      // submitted. Reopened rows remain visible as pending, but do not contribute
      // to participation, hours, or the weighted rank. Core-subject double weight
      // is computed from submitted evaluations only.
      const voteSummary = summarizeSubmittedTeacherVotes(teacherVotes);
      // The privacy flag used to affect only /statistics, while the conference
      // summary exposed every colleague's comment to every class teacher. Apply
      // the same policy here; leadership still sees the full picture.
      const hideForeignComments =
        !config.statisticsShowForeignComments && !access.canRunConference;
      const summarizedTeacherVotes = hideForeignComments
        ? voteSummary.teacherVotes.map((vote) =>
            vote.teacherId === user.teacherId
              ? vote
              : { ...vote, comment: null, nextStep: null }
          )
        : voteSummary.teacherVotes;
      const submittedTeachers = voteSummary.submittedTeachers;
      const { Lehrling: hoursLehrling, Geselle: hoursGeselle, Meister: hoursMeister } = voteSummary.hours;
      const totalVotedHours = voteSummary.hours.total;
      const pctLehrling = totalVotedHours > 0 ? Math.round((hoursLehrling / totalVotedHours) * 100) : 0;
      const pctGeselle = totalVotedHours > 0 ? Math.round((hoursGeselle / totalVotedHours) * 100) : 0;
      const pctMeister = totalVotedHours > 0 ? Math.round((hoursMeister / totalVotedHours) * 100) : 0;
      const suggestedRankByHours = voteSummary.suggestedRankByHours;

      // The 18-item raster is decision *support*, not a score.
      //
      // It was previously summed across every core subject and compared against the 14/8
      // thresholds. Three core subjects of 6/18 each summed to 18 and produced MEISTER,
      // for a pupil every teacher had individually rated LEHRLING - and that summed
      // value was what `finalRank` fell back to whenever nobody had confirmed anything.
      //
      // What the school actually decides on is the rank a teacher submits, weighted by
      // the lessons they teach. So the raster is now reported per subject as evidence
      // and never aggregated into a rank. `positiveCount`/`totalRated` are kept because
      // the threshold table in the client still reads them, but they are per-subject
      // figures, not a score.
      const redCards = mapCards('red');
      const hasRedCard = redCards.length > 0;

      const subjectEvidence = buildSubjectEvidence(
        pupilEvals.map((e) => {
          const c = summarizeRatings([{ evaluationId: e.id, items: itemsByEval.get(e.id) ?? [] }]);
          return {
            subjectCode: e.subject_code,
            positiveCount: c.positiveCount,
            totalRated: c.totalRated,
            teacherShort: e.teacher_short,
            updatedAt: e.updated_at,
          };
        }),
      );

      // A red card demotes the *suggestion* by one step before the chair confirms
      // it. The confirmed rank is the official decision and is returned exactly as
      // stored; demoting it again here would apply the card twice when the chair
      // accepts an already-demoted suggestion.
      const confirmed = confirmedRanks.find((r) => r.pupil_id === p.id);
      const confirmedRank = (confirmed?.rank as Rank | undefined) ?? null;
      const { presentedRank, suggestedRank, hasRedCardDemotion } = presentRank(
        confirmedRank,
        suggestedRankByHours,
        hasRedCard,
      );

      return {
        id: p.id,
        fullName: p.fullName,
        subjectEvidence,
        // null means "the conference has not decided this pupil yet". It is never
        // back-filled with a computed value: an undecided pupil must look undecided.
        finalRank: presentedRank,
        suggestedRank,
        hasRedCardDemotion,
        isConfirmed: !!confirmed,
        confirmedAt: confirmed?.confirmed_at || null,
        overrideReason: confirmed?.override_reason || null,
        evaluationsCount: pupilEvals.length,
        teacherVotes: summarizedTeacherVotes,
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
          Lehrling: voteSummary.voteCounts.Lehrling,
          Geselle: voteSummary.voteCounts.Geselle,
          Meister: voteSummary.voteCounts.Meister,
          hoursLehrling,
          hoursGeselle,
          hoursMeister,
          totalVotedHours,
          pctLehrling,
          pctGeselle,
          pctMeister,
          suggestedRankByHours,
          weightedRank: suggestedRank,
        },
        cards: {
          green: mapCards('green'),
          yellow: mapCards('yellow'),
          red: redCards,
        },
      };
    });

    const isClassLocked = round ? await getClassRoundLockState(round.id, cid) : false;
    const isLocked = isClassRoundLocked(round?.isLocked ?? false, isClassLocked);

    return reply.send({
      class: { id: access.classId },
      round,
      isLocked,
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
