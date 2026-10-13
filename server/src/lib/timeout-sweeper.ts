import { and, eq, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../db/index.js';
import { auditLogs, timeoutIncidents } from '../db/schema.js';
import { broadcastToClass } from '../ws/live-sync.js';
import { LW_CLASS_ID } from './guards.js';
import { isRestoreInProgress } from './restore-lock.js';

export const AUTO_RESOLVE_NOTE = 'Automatisch beendet (Stundenende)';

/**
 * Single-query sweep of expired active timeouts.
 *
 * Uses atomic UPDATE ... WHERE status = 'active' AND expires_at <= now RETURNING.
 * Resolved by is set to NULL (audit_logs.actor_id is nullable; no invented actor).
 * For every auto-resolved row:
 * - emits audit log entry with action TIME_OUT_AUTO_RESOLVED
 * - broadcasts TIMEOUT_RESOLVED to the pupil's class room and room 999 (Lernwerkstatt)
 */
export async function sweepExpiredTimeouts(now: Date = new Date()): Promise<number> {
  // While a restore holds the gate the database is being replaced; an auto-resolve
  // UPDATE here would race the destructive step. Skip this tick, try again next round.
  if (isRestoreInProgress()) return 0;

  const resolved = await db
    .update(timeoutIncidents)
    .set({
      status: 'resolved',
      resolvedAt: now,
      resolvedBy: null,
      resolutionNote: AUTO_RESOLVE_NOTE,
    })
    .where(
      and(
        eq(timeoutIncidents.status, 'active'),
        sql`${timeoutIncidents.expiresAt} IS NOT NULL`,
        lte(timeoutIncidents.expiresAt, now),
      ),
    )
    .returning();

  for (const incident of resolved) {
    try {
      await db.insert(auditLogs).values({
        actorId: null,
        action: 'TIME_OUT_AUTO_RESOLVED',
        entity: 'timeout_incident',
        entityId: incident.id,
        payload: {
          pupilId: incident.pupilId,
          classId: incident.classId,
          expiredAt: incident.expiresAt,
        },
      });
    } catch (err) {
      console.error('Failed to log audit entry for auto-resolved timeout:', incident.id, err);
    }

    broadcastToClass(incident.classId, { type: 'TIMEOUT_RESOLVED', incident });
    broadcastToClass(LW_CLASS_ID, { type: 'TIMEOUT_RESOLVED', incident });
  }

  return resolved.length;
}

export interface TimeoutSweeper {
  stop: () => void;
}

/**
 * Starts the periodic background sweeper.
 * Unrefs the timer so it never holds Node processes open in tests or worker scripts.
 */
export function startTimeoutSweeper(intervalMs = 60_000): TimeoutSweeper {
  const timer = setInterval(() => {
    sweepExpiredTimeouts().catch((err) => {
      console.error('Error in timeout sweeper tick:', err);
    });
  }, intervalMs);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return {
    stop: () => clearInterval(timer),
  };
}

/**
 * Registers the background sweeper on a Fastify instance, clearing it on server close.
 */
export function registerTimeoutSweeper(app: FastifyInstance, intervalMs = 60_000): TimeoutSweeper {
  const sweeper = startTimeoutSweeper(intervalMs);
  app.addHook('onClose', (_instance, done) => {
    sweeper.stop();
    done();
  });
  return sweeper;
}
