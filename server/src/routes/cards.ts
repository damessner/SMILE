import type { FastifyPluginAsync } from 'fastify';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { db, getPool } from '../db/index.js';
import { auditLogs, behaviorCards } from '../db/schema.js';
import { config } from '../config.js';
import {
  assertPasswordCurrent,
  badRequest,
  findPupilInClass,
  getClassAccess,
  getGlobalAccess,
  getPupil,
  hasPersistedTeacherActor,
  MAX_POSTGRES_INTEGER,
  parseIdParam,
  requireAuth,
  safeTeacherId,
} from '../lib/guards.js';
import { broadcastToClass } from '../ws/live-sync.js';
import { queueRedCardRankChange } from '../lib/teams.js';

const CARD_TYPES = new Set(['green', 'yellow', 'red']);

type CardType = 'green' | 'yellow' | 'red';

export const cardRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * POST /api/cards — issue a green, yellow or red card.
   *
   * Now requires class access and validates that the pupil really is in that class.
   * Previously any authenticated teacher could file a red card (instant rank loss)
   * against a pupil of any class.
   */
  fastify.post(
    '/',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['pupilId', 'classId', 'cardType'],
          additionalProperties: false,
          properties: {
            pupilId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            classId: { type: 'integer', minimum: 1, maximum: MAX_POSTGRES_INTEGER },
            cardType: { enum: ['green', 'yellow', 'red'] },
            note: { type: 'string', nullable: true, maxLength: 2000 },
          },
        },
      },
    },
    async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { pupilId, classId, cardType, note } = (request.body ?? {}) as {
      pupilId?: number;
      classId?: number;
      cardType?: string;
      note?: string;
    };

    if (!pupilId || !classId || !cardType) {
      return badRequest(reply, 'Pupil, class, and cardType are required');
    }
    if (!CARD_TYPES.has(cardType)) {
      return badRequest(reply, 'Unbekannter Kartentyp.');
    }
    const typedCard = cardType as CardType;

    const cleanNote = note?.trim();
    if (cleanNote && cleanNote.length > 2000) {
      return badRequest(reply, 'Die Begründung ist zu lang.');
    }
    // A red card costs the pupil a rank, so it must be justified.
    if (typedCard === 'red' && !cleanNote) {
      return badRequest(
        reply,
        'Für eine Rote Karte (Rangverlust) ist eine Begründung / Vorfallsbeschreibung zwingend erforderlich',
      );
    }

    const access = await getClassAccess(user, classId);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRecord) {
      return reply.status(403).send({
        error: 'Sie unterrichten diese Klasse nicht und dürfen dort keine Karten vergeben.',
      });
    }

    const pupil = await findPupilInClass(pupilId, classId);
    if (!pupil) {
      // Without this the card lands on a pupil/class pair that never existed, and
      // the per-class aggregates silently mis-count.
      return badRequest(reply, 'Dieser Schüler gehört nicht zu dieser Klasse.');
    }

    // Bound to a const so the `is number` narrowing survives into the transaction
    // callback. `behavior_cards.teacher_id` is a NOT NULL foreign key; the former
    // `?? 0` attributed the card to a phantom teacher row instead of failing.
    const actorId = user.teacherId;
    if (!hasPersistedTeacherActor(actorId)) {
      return reply.status(503).send({
        error:
          'Das Ausstellen einer Karte ist nicht verfügbar, weil Ihrem Konto kein Lehrkraftdatensatz zugeordnet ist.',
        code: 'SYSTEM_ACTOR_NOT_CONFIGURED',
      });
    }

    // A red card costs the pupil a rank, so the card and its audit row commit
    // together; a rank loss with no RED_CARD_ISSUED row cannot be explained later.
    const card = await db.transaction(async (tx) => {
      const [issued] = await tx
        .insert(behaviorCards)
        .values({
          pupilId,
          classId,
          teacherId: actorId,
          cardType: typedCard,
          note: cleanNote || null,
        })
        .returning();

      if (typedCard === 'red') {
        await tx.insert(auditLogs).values({
          actorId: safeTeacherId(user.teacherId),
          action: 'RED_CARD_ISSUED',
          entity: 'pupil',
          entityId: String(pupilId),
          payload: { classId, note: cleanNote, reason: 'Instant rank loss' },
        });
      }

      return issued;
    });

    // Yellow-card escalation alert.
    let alertTriggered = false;
    if (typedCard === 'yellow') {
      const since = new Date();
      since.setDate(since.getDate() - config.yellowCardAlertWindowDays);
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(behaviorCards)
        .where(
          and(
            eq(behaviorCards.pupilId, pupilId),
            eq(behaviorCards.cardType, 'yellow'),
            isNull(behaviorCards.revokedAt),
            gte(behaviorCards.createdAt, since),
          ),
        );
      alertTriggered = (row?.count ?? 0) >= config.yellowCardAlertThreshold;
    }

    broadcastToClass(classId, { type: 'CARD_ISSUED', card, alertTriggered });

    if (typedCard === 'red') {
      queueRedCardRankChange({
        pupilId,
        classId,
        actorTeacherId: actorId,
        direction: 'issued',
        source: 'Rote Karte',
      });
    }

    return reply.status(201).send({ card, alertTriggered });
  });

  /**
   * POST /api/cards/:id/revoke — withdraw a card.
   *
   * Restricted to the issuing teacher, the homeroom heads of that class and the
   * school administration. Previously any authenticated user could withdraw any
   * card, including another teacher's justified red card.
   */
  fastify.post('/:id/revoke', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const { id } = request.params as { id: string };
    if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
      return badRequest(reply, 'Ungültige Karten-ID.');
    }

    const [existing] = await db.select().from(behaviorCards).where(eq(behaviorCards.id, id)).limit(1);
    if (!existing) return reply.status(404).send({ error: 'Karte nicht gefunden' });
    if (existing.revokedAt) return badRequest(reply, 'Diese Karte wurde bereits zurückgezogen.');

    const access = await getClassAccess(user, existing.classId);
    const isIssuer = user.teacherId != null && existing.teacherId === user.teacherId;
    const mayRevoke = isIssuer || access.isKv || access.isHeadmaster || access.isAdmin;

    if (!mayRevoke) {
      return reply.status(403).send({
        error: 'Nur die ausstellende Lehrperson, der Klassenvorstand oder die Schulleitung kann diese Karte zurückziehen.',
      });
    }

    const revoked = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(behaviorCards)
        .set({ revokedAt: new Date(), revokedBy: safeTeacherId(user.teacherId) })
        .where(and(eq(behaviorCards.id, id), isNull(behaviorCards.revokedAt)))
        .returning();

      if (!row) return null;

      await tx.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'CARD_REVOKED',
        entity: 'pupil',
        entityId: String(existing.pupilId),
        payload: { cardId: id, cardType: existing.cardType, wasIssuer: isIssuer },
      });

      return row;
    });

    if (!revoked) {
      return badRequest(reply, 'Diese Karte wurde soeben von jemand anderem zurückgezogen.');
    }

    broadcastToClass(existing.classId, {
      type: 'CARD_REVOKED',
      cardId: id,
      pupilId: existing.pupilId,
    });

    if (existing.cardType === 'red') {
      queueRedCardRankChange({
        pupilId: existing.pupilId,
        classId: existing.classId,
        actorTeacherId: user.teacherId ?? null,
        direction: 'revoked',
        source: 'Rote Karte',
      });
    }

    return reply.send({ success: true, card: revoked });
  });

  /**
   * GET /api/cards/alerts — yellow-card threshold alerts.
   *
   * Scoped to the caller's classes. This used to return school-wide counts to any
   * authenticated teacher.
   */
  fastify.get('/alerts', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);

    const global = await getGlobalAccess(user);
    if (global.classIds !== null && global.classIds.length === 0) {
      return reply.send([]);
    }

    const since = new Date();
    since.setDate(since.getDate() - config.yellowCardAlertWindowDays);

    const rows = await getPool().query(
      `SELECT bc.pupil_id,
              p.full_name AS pupil_name,
              sc.id       AS class_id,
              sc.name     AS class_name,
              COUNT(bc.id)::int AS yellow_count
         FROM behavior_cards bc
         JOIN pupils p        ON p.id  = bc.pupil_id
         JOIN school_classes sc ON sc.id = bc.class_id
        WHERE bc.card_type = 'yellow'
          AND bc.revoked_at IS NULL
          AND bc.created_at >= $1
          AND ($2::int[] IS NULL OR sc.id = ANY($2::int[]))
        GROUP BY bc.pupil_id, p.full_name, sc.id, sc.name
       HAVING COUNT(bc.id) >= $3
        ORDER BY yellow_count DESC`,
      [since, global.classIds, config.yellowCardAlertThreshold],
    );

    return reply.send(rows.rows);
  });

  /**
   * GET /api/cards/class/:classId — active cards for a class.
   *
   * LEFT JOIN on teachers so cards filed by an account without a teacher id (the
   * administrator) are still returned. The previous INNER JOIN silently dropped them.
   */
  fastify.get('/class/:classId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { classId } = request.params as { classId: string };
    const cid = parseIdParam(classId, 'classId');
    if (!cid) return badRequest(reply, 'Ungültige Klassen-ID.');

    const access = await getClassAccess(user, cid);
    if (!access.exists) return reply.status(404).send({ error: 'Klasse nicht gefunden' });
    if (!access.canRead) {
      return reply.status(403).send({ error: 'Keine Zugriffsberechtigung für diese Klasse' });
    }

    const rows = await getPool().query(
      `SELECT bc.id,
              bc.pupil_id,
              bc.class_id,
              bc.teacher_id,
              t.short_name AS teacher_short,
              COALESCE(t.full_name, 'Schulleitung') AS teacher_name,
              bc.card_type,
              bc.note,
              bc.created_at,
              bc.revoked_at
         FROM behavior_cards bc
         LEFT JOIN teachers t ON t.id = bc.teacher_id
        WHERE bc.class_id = $1
          AND bc.revoked_at IS NULL
        ORDER BY bc.created_at DESC`,
      [cid],
    );

    return reply.send(rows.rows);
  });

  /** GET /api/cards/pupil/:pupilId — full card history for one pupil. */
  fastify.get('/pupil/:pupilId', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    const { pupilId } = request.params as { pupilId: string };
    const pid = parseIdParam(pupilId, 'pupilId');
    if (!pid) return badRequest(reply, 'Ungültige Schüler-ID.');

    const pupil = await getPupil(pid);
    if (!pupil) return reply.status(404).send({ error: 'Schüler nicht gefunden' });

    const access = await getClassAccess(user, pupil.classId);
    if (!access.canRead) {
      return reply.status(403).send({ error: 'Keine Zugriffsberechtigung für diese Klasse' });
    }

    const cards = await db
      .select({
        id: behaviorCards.id,
        cardType: behaviorCards.cardType,
        note: behaviorCards.note,
        createdAt: behaviorCards.createdAt,
        revokedAt: behaviorCards.revokedAt,
        teacherId: behaviorCards.teacherId,
      })
      .from(behaviorCards)
      .where(eq(behaviorCards.pupilId, pid))
      .orderBy(desc(behaviorCards.createdAt));

    return reply.send(cards);
  });
};
