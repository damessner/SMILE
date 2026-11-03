import type { FastifyPluginAsync } from 'fastify';
import { and, eq, gt, inArray, ne } from 'drizzle-orm';
import { db } from '../db/index.js';
import {
  auditLogs,
  notificationPreferences,
  notificationSubscriptions,
  schoolClasses,
} from '../db/schema.js';
import { assertPasswordCurrent, badRequest, requireAuth, safeTeacherId } from '../lib/guards.js';

/**
 * Teacher-managed e-mail subscriptions.
 *
 * Any staff member may subscribe to any class (school decision). A subscription
 * is per class and event type; the address is stored once per user. There is no
 * address-confirmation step, by explicit school decision, so the UI must warn
 * that pupil names and notes are sent.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const FLAG_KEYS = ['green', 'yellow', 'red', 'timeout', 'cooldown', 'weeklyDigest'] as const;

type SubscriptionInput = {
  classId?: number;
  green?: boolean;
  yellow?: boolean;
  red?: boolean;
  timeout?: boolean;
  cooldown?: boolean;
  weeklyDigest?: boolean;
};

function hasAnyFlag(subscription: SubscriptionInput): boolean {
  return FLAG_KEYS.some((key) => subscription[key] === true);
}

export const notificationRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get('/preferences', { preValidation: [fastify.authenticate] }, async (request, reply) => {
    const user = requireAuth(request);
    if (user.role === 'pupil') {
      return reply.status(403).send({ error: 'Schülerkonten können keine Benachrichtigungen abonnieren.' });
    }

    const [preference] = await db
      .select({ email: notificationPreferences.email })
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, user.id))
      .limit(1);

    const classes = await db
      .select({ id: schoolClasses.id, name: schoolClasses.name, grade: schoolClasses.grade })
      .from(schoolClasses)
      .where(and(ne(schoolClasses.name, 'LW'), gt(schoolClasses.grade, 0)))
      .orderBy(schoolClasses.grade, schoolClasses.name);

    const subscriptions = await db
      .select()
      .from(notificationSubscriptions)
      .where(eq(notificationSubscriptions.userId, user.id));

    const byClass = new Map(subscriptions.map((s) => [s.classId, s]));

    return reply.send({
      email: preference?.email ?? '',
      classes: classes.map((schoolClass) => {
        const subscription = byClass.get(schoolClass.id);
        return {
          classId: schoolClass.id,
          className: schoolClass.name,
          green: subscription?.green ?? false,
          yellow: subscription?.yellow ?? false,
          red: subscription?.red ?? false,
          timeout: subscription?.timeout ?? false,
          cooldown: subscription?.cooldown ?? false,
          weeklyDigest: subscription?.weeklyDigest ?? false,
        };
      }),
    });
  });

  fastify.put(
    '/preferences',
    {
      preValidation: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['email', 'subscriptions'],
          additionalProperties: false,
          properties: {
            email: { type: 'string', maxLength: 254 },
            subscriptions: {
              type: 'array',
              maxItems: 100,
              items: {
                type: 'object',
                required: ['classId'],
                additionalProperties: false,
                properties: {
                  classId: { type: 'integer', minimum: 1 },
                  green: { type: 'boolean' },
                  yellow: { type: 'boolean' },
                  red: { type: 'boolean' },
                  timeout: { type: 'boolean' },
                  cooldown: { type: 'boolean' },
                  weeklyDigest: { type: 'boolean' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const user = requireAuth(request);
      if (user.role === 'pupil') {
        return reply.status(403).send({ error: 'Schülerkonten können keine Benachrichtigungen abonnieren.' });
      }
      if (!assertPasswordCurrent(user, reply)) return;

      const { email, subscriptions } = (request.body ?? {}) as {
        email?: string;
        subscriptions?: SubscriptionInput[];
      };
      const cleanEmail = email?.trim() ?? '';
      const active = (subscriptions ?? []).filter(hasAnyFlag);

      if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
        return badRequest(reply, 'Bitte eine gültige E-Mail-Adresse angeben.');
      }
      if (active.length > 0 && !cleanEmail) {
        return badRequest(reply, 'Bitte eine gültige E-Mail-Adresse für die Benachrichtigungen angeben.');
      }

      const classIds = [...new Set(active.map((s) => s.classId).filter((id): id is number => !!id))];
      if (classIds.length !== active.length) {
        return badRequest(reply, 'Jede Klasse darf nur einmal ausgewählt werden.');
      }
      if (classIds.length > 0) {
        const existing = await db
          .select({ id: schoolClasses.id })
          .from(schoolClasses)
          .where(
            and(
              inArray(schoolClasses.id, classIds),
              ne(schoolClasses.name, 'LW'),
              gt(schoolClasses.grade, 0),
            ),
          );
        if (existing.length !== classIds.length) {
          return badRequest(reply, 'Mindestens eine ausgewählte Klasse ist ungültig.');
        }
      }

      await db.transaction(async (tx) => {
        if (cleanEmail) {
          await tx
            .insert(notificationPreferences)
            .values({ userId: user.id, email: cleanEmail })
            .onConflictDoUpdate({
              target: notificationPreferences.userId,
              set: { email: cleanEmail, updatedAt: new Date() },
            });
        } else {
          await tx
            .delete(notificationPreferences)
            .where(eq(notificationPreferences.userId, user.id));
        }

        await tx
          .delete(notificationSubscriptions)
          .where(eq(notificationSubscriptions.userId, user.id));

        if (active.length > 0) {
          await tx.insert(notificationSubscriptions).values(
            active.map((subscription) => ({
              userId: user.id,
              classId: subscription.classId!,
              green: subscription.green === true,
              yellow: subscription.yellow === true,
              red: subscription.red === true,
              timeout: subscription.timeout === true,
              cooldown: subscription.cooldown === true,
              weeklyDigest: subscription.weeklyDigest === true,
              updatedAt: new Date(),
            })),
          );
        }

        await tx.insert(auditLogs).values({
          actorId: safeTeacherId(user.teacherId),
          action: 'NOTIFICATION_PREFERENCES_UPDATED',
          entity: 'user',
          entityId: user.id,
          payload: {
            hasEmail: Boolean(cleanEmail),
            classes: classIds,
            eventFlags: active.map((s) => ({
              classId: s.classId,
              ...Object.fromEntries(FLAG_KEYS.map((key) => [key, s[key] === true])),
            })),
          },
        });
      });

      return reply.send({ success: true });
    },
  );
};
