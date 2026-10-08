import type { FastifyPluginAsync } from 'fastify';
import { db, getPool } from '../db/index.js';
import { safeErrorLogFields } from '../lib/log-safety.js';
import {
  assessmentRubrics,
  auditLogs,
  behaviorCards,
  evaluationItems,
  evaluations,
  finalRanks,
  observationRounds,
  passwordResets,
  pupils,
  rubricCriteria,
  schoolClasses,
  teachingAssignments,
  teachers,
  timeoutEscalations,
  timeoutIncidents,
  timetableLessons,
  users,
} from '../db/schema.js';
import { assertPasswordCurrent, requireAuth } from '../lib/guards.js';

export const backupRoutes: FastifyPluginAsync = async (fastify) => {
  /**
   * GET /api/backup/export-json — complete data export.
   *
   * Two changes from the original:
   *  - Administrator only. It previously also allowed `head_teacher`, which handed a
   *    full database dump (every pupil, every comment) to ~20 homeroom accounts.
   *  - The audit log is no longer truncated. `.limit(500)` silently discarded all but
   *    the most recent 500 rows, which is exactly the history needed to investigate an
   *    incident after a restore.
   *
   * Password hashes are never included.
   */
  fastify.get(
    '/export-json',
    { preValidation: [fastify.requireRole('admin')] },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const [
        allTeachers,
        allClasses,
        allPupils,
        allEvals,
        allItems,
        allCards,
        allRanks,
        allRounds,
        allRubrics,
        allCriteria,
        allAssignments,
        allLessons,
        allTimeouts,
        allEscalations,
        allAudits,
        allResets,
      ] = await Promise.all([
        db.select().from(teachers),
        db.select().from(schoolClasses),
        db.select().from(pupils),
        db.select().from(evaluations),
        db.select().from(evaluationItems),
        db.select().from(behaviorCards),
        db.select().from(finalRanks),
        db.select().from(observationRounds),
        db.select().from(assessmentRubrics),
        db.select().from(rubricCriteria),
        db.select().from(teachingAssignments),
        db.select().from(timetableLessons),
        db.select().from(timeoutIncidents),
        db.select().from(timeoutEscalations),
        // Full audit trail, not just the most recent slice.
        db.select().from(auditLogs),
        db.select().from(passwordResets),
      ]);

      const backupBundle = {
        version: '2.0.0',
        exportedAt: new Date().toISOString(),
        exportedBy: user.username,
        school: 'MS Telfs Weissenbach',
        note: 'Enthaelt keine Passwort-Hashes. Zeitstempel sind UTC.',
        data: {
          teachers: allTeachers,
          classes: allClasses,
          pupils: allPupils,
          teachingAssignments: allAssignments,
          timetableLessons: allLessons,
          observationRounds: allRounds,
          rubrics: allRubrics,
          rubricCriteria: allCriteria,
          evaluations: allEvals,
          evaluationItems: allItems,
          behaviorCards: allCards,
          finalRanks: allRanks,
          timeoutIncidents: allTimeouts,
          timeoutEscalations: allEscalations,
          auditLogs: allAudits,
          passwordResetRequests: allResets,
        },
      };

      const filename = `smile-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.header('Content-Type', 'application/json');

      request.log.info(
        { auditRows: allAudits.length, pupils: allPupils.length },
        'Full data export',
      );

      return reply.send(backupBundle);
    },
  );

  /**
   * POST /api/backup/verify — confirm the database is reachable and report row counts.
   * Read-only, so it is safe to call from monitoring.
   */
  fastify.get(
    '/verify',
    { preValidation: [fastify.requireRole('admin')] },
    async (request, reply) => {
      requireAuth(request);
      try {
        const res = await getPool().query<{ ok: number }>('SELECT 1 AS ok');
        const countsResult = await getPool().query<{
          pupils: string;
          cards: string;
          evaluations: string;
          audit_logs: string;
        }>(
          `SELECT (SELECT count(*) FROM pupils)::text        AS pupils,
                  (SELECT count(*) FROM behavior_cards)::text AS cards,
                  (SELECT count(*) FROM evaluations)::text    AS evaluations,
                  (SELECT count(*) FROM audit_logs)::text     AS audit_logs`,
        );
        return reply.send({
          reachable: res.rows[0]?.ok === 1,
          counts: countsResult.rows[0],
          checkedAt: new Date().toISOString(),
        });
      } catch (err) {
        request.log.error(safeErrorLogFields(err), 'Backup verification query failed');
        return reply.status(503).send({ error: 'Datenbank nicht erreichbar.' });
      }
    },
  );

  /**
   * POST /api/backup/audit-log — paged audit trail for administrators.
   *
   * Added because the audit log is the primary evidence trail for the system's own
   * correctness claims, yet there was no way to read it from the application.
   */
  fastify.get(
    '/audit-log',
    { preValidation: [fastify.requireRole('admin')] },
    async (request, reply) => {
      requireAuth(request);
      const { limit, offset, action } = request.query as {
        limit?: string;
        offset?: string;
        action?: string;
      };

      const take = Math.min(Math.max(Number.parseInt(limit ?? '100', 10) || 100, 1), 500);
      const skip = Math.max(Number.parseInt(offset ?? '0', 10) || 0, 0);

      const params: unknown[] = [take, skip];
      let actionFilter = '';
      if (action) {
        params.push(action);
        actionFilter = `WHERE action = $${params.length}`;
      }

      const rows = await getPool().query(
        `SELECT id, actor_id, action, entity, entity_id, payload, created_at
           FROM audit_logs
           ${actionFilter}
          ORDER BY id DESC
          LIMIT $1 OFFSET $2`,
        params,
      );
      return reply.send({ rows: rows.rows, limit: take, offset: skip });
    },
  );
};
