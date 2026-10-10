import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { FastifyPluginAsync } from 'fastify';
import { db, getPool } from '../db/index.js';
import { databaseUrl } from '../config.js';
import { safeErrorLogFields } from '../lib/log-safety.js';
import { closeAllWebSockets } from '../ws/live-sync.js';
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
import { assertPasswordCurrent, requireAuth, safeTeacherId } from '../lib/guards.js';

const execFileAsync = promisify(execFile);

export type RestoreRunner = (
  dbUrl: string,
  backupPath: string,
  safetyPath: string,
) => Promise<{ safetyCreated: boolean }>;

export const defaultRestoreRunner: RestoreRunner = async (dbUrl, backupPath, safetyPath) => {
  // Pre-flight: verify required PostgreSQL client binaries exist
  try {
    await execFileAsync('pg_dump', ['--version']);
    await execFileAsync('pg_restore', ['--version']);
  } catch {
    throw new Error('PostgreSQL-Werkzeuge (pg_dump / pg_restore) sind auf dem Server nicht im PATH verfügbar.');
  }

  // Step 1: Pre-restore safety snapshot
  await execFileAsync('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-d', dbUrl, '-f', safetyPath]);

  // Step 2: pg_restore
  try {
    await execFileAsync('pg_restore', ['--clean', '--if-exists', '--no-owner', '--no-acl', '-d', dbUrl, backupPath]);
  } catch (err: unknown) {
    const errorWithCode = err as { code?: number };
    // pg_restore exits with 1 when warnings occur (such as non-existent objects on clean drop)
    if (errorWithCode && typeof errorWithCode.code === 'number' && errorWithCode.code === 1) {
      // warnings are acceptable
    } else {
      throw err;
    }
  }
  return { safetyCreated: true };
};

let activeRestoreRunner: RestoreRunner = defaultRestoreRunner;

export function setRestoreRunnerForTests(runner: RestoreRunner | null): void {
  activeRestoreRunner = runner ?? defaultRestoreRunner;
}

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
   *
   * The export is itself written to `audit_logs`. This is the one action that can move
   * the entire school record out of the system in a single request, and it used to leave
   * only a line in the pino stream — which is exactly the history that does not survive
   * an incident. The payload records who, when, how many pupils, and nothing about the
   * contents; putting pupil names into the audit row would copy the data into the one
   * table every administrator can read without a per-record decision.
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

      // Recorded after a successful read, in the same shape as every other privileged
      // mutation. A failed or unauthorized attempt never reaches this point, because the
      // role gate and the password guard run first.
      await db.insert(auditLogs).values({
        actorId: safeTeacherId(user.teacherId),
        action: 'FULL_DATA_EXPORTED',
        entity: 'system',
        entityId: 'backup',
        payload: {
          pupils: allPupils.length,
          teachers: allTeachers.length,
          evaluations: allEvals.length,
          behaviorCards: allCards.length,
          auditRowsIncluded: allAudits.length,
          exportStartedAt: backupBundle.exportedAt,
        },
      });

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

  /**
   * GET /api/backup/list (and /backups) — list available database backup files.
   * Administrator only.
   */
  const listBackupsHandler = async (request: any, reply: any) => {
    const user = requireAuth(request);
    if (!assertPasswordCurrent(user, reply)) return;

    const backupDir = process.env.BACKUP_DIR || '/var/backups/smile';
    if (!fs.existsSync(backupDir)) {
      return reply.send({ backups: [] });
    }

    try {
      const entries = fs.readdirSync(backupDir, { withFileTypes: true });
      const backups = entries
        .filter((entry) => entry.isFile() && (
          entry.name.endsWith('.dump') ||
          entry.name.endsWith('.dump.enc') ||
          entry.name.endsWith('.sql') ||
          entry.name.endsWith('.sql.gz')
        ))
        .map((entry) => {
          const fullPath = path.join(backupDir, entry.name);
          try {
            const stats = fs.statSync(fullPath);
            const sizeBytes = stats.size;
            let sizeFormatted: string;
            if (sizeBytes >= 1024 * 1024) {
              sizeFormatted = `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
            } else if (sizeBytes >= 1024) {
              sizeFormatted = `${Math.round(sizeBytes / 1024)} KB`;
            } else {
              sizeFormatted = `${sizeBytes} B`;
            }
            return {
              id: entry.name,
              filename: entry.name,
              sizeBytes,
              sizeFormatted,
              timestamp: stats.mtime.toISOString(),
              isSafetySnapshot: entry.name.startsWith('pre-restore-safety-'),
              isEncrypted: entry.name.endsWith('.enc'),
            };
          } catch {
            return null;
          }
        })
        .filter((b): b is NonNullable<typeof b> => b !== null)
        .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      return reply.send({ backups });
    } catch (err) {
      request.log.error(safeErrorLogFields(err), 'Failed to list backups');
      return reply.status(500).send({ error: 'Backups konnten nicht aufgelistet werden.' });
    }
  };

  fastify.get('/list', { preValidation: [fastify.requireRole('admin')] }, listBackupsHandler);
  fastify.get('/backups', { preValidation: [fastify.requireRole('admin')] }, listBackupsHandler);

  /**
   * POST /api/backup/restore — restores the database from a selected backup snapshot.
   *
   * Safeguards:
   *  - Administrator only.
   *  - Strict filename sanitization and traversal prevention.
   *  - Automatic pre-restore safety dump created before restore execution.
   *  - Full audit logging upon completion.
   *  - LiveSync WebSocket disconnect (code 1001) to force clients to re-synchronize.
   */
  fastify.post(
    '/restore',
    { preValidation: [fastify.requireRole('admin')] },
    async (request, reply) => {
      const user = requireAuth(request);
      if (!assertPasswordCurrent(user, reply)) return;

      const body = request.body as { backupId?: unknown };
      const backupId = body?.backupId;
      if (!backupId || typeof backupId !== 'string') {
        return reply.status(400).send({ error: 'Backup-ID ist erforderlich.' });
      }

      const cleanId = path.basename(backupId.trim());
      if (
        cleanId !== backupId.trim() ||
        !/^[a-zA-Z0-9_.-]+$/.test(cleanId) ||
        cleanId.includes('..') ||
        cleanId.includes('/') ||
        cleanId.includes('\\')
      ) {
        return reply.status(400).send({ error: 'Ungültiger Backup-Dateiname.' });
      }

      if (
        !cleanId.endsWith('.dump') &&
        !cleanId.endsWith('.sql') &&
        !cleanId.endsWith('.sql.gz') &&
        !cleanId.endsWith('.dump.enc')
      ) {
        return reply.status(400).send({ error: 'Nicht unterstütztes Backup-Dateiformat.' });
      }

      const backupDir = process.env.BACKUP_DIR || '/var/backups/smile';
      const targetFilePath = path.join(backupDir, cleanId);

      if (!fs.existsSync(targetFilePath)) {
        return reply.status(404).send({ error: 'Das ausgewählte Backup wurde auf dem Server nicht gefunden.' });
      }

      // Ensure backup directory exists if writing safety snapshot
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }

      // Pre-restore safety snapshot
      const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const safetyFileName = `pre-restore-safety-${safetyTimestamp}.dump`;
      const safetyFilePath = path.join(backupDir, safetyFileName);

      let targetRestorePath = targetFilePath;
      let tempDecryptedPath: string | null = null;

      try {
        if (cleanId.endsWith('.dump.enc')) {
          const passphrase = process.env.BACKUP_ENCRYPTION_PASSPHRASE || process.env.M365_BACKUP_PASSWORD;
          if (!passphrase) {
            return reply.status(400).send({
              error: 'Kein Entschlüsselungs-Passwort (BACKUP_ENCRYPTION_PASSPHRASE) konfiguriert.',
            });
          }
          tempDecryptedPath = path.join(backupDir, `temp-decrypt-${Date.now()}.dump`);
          await execFileAsync('openssl', [
            'enc', '-d', '-aes-256-cbc', '-pbkdf2',
            '-in', targetFilePath,
            '-out', tempDecryptedPath,
            '-pass', `pass:${passphrase}`,
          ]);
          targetRestorePath = tempDecryptedPath;
        }

        const dbUrl = databaseUrl();
        await activeRestoreRunner(dbUrl, targetRestorePath, safetyFilePath);

        request.log.info(
          { restoredBackup: cleanId, safetyBackup: safetyFileName, restoredBy: user.username },
          'Database restored successfully',
        );

        // Record in audit log
        await db.insert(auditLogs).values({
          actorId: safeTeacherId(user.teacherId),
          action: 'DATABASE_RESTORED',
          entity: 'system',
          entityId: 'backup',
          payload: {
            restoredBackup: cleanId,
            safetyBackup: safetyFileName,
            restoredBy: user.username,
            restoredAt: new Date().toISOString(),
          },
        });

        // Close all WebSockets to force client-side re-synchronization
        closeAllWebSockets(1001, 'database restored');

        return reply.send({
          success: true,
          message: `Backup ${cleanId} wurde erfolgreich eingespielt. Sicherheitskopie ${safetyFileName} wurde erstellt.`,
          preRestoreBackup: safetyFileName,
          restoredAt: new Date().toISOString(),
        });
      } catch (err) {
        request.log.error(safeErrorLogFields(err), 'Database restore execution failed');
        return reply.status(500).send({
          error: 'Wiederherstellung fehlgeschlagen. Überprüfen Sie die Server-Logs.',
        });
      } finally {
        if (tempDecryptedPath && fs.existsSync(tempDecryptedPath)) {
          try {
            fs.unlinkSync(tempDecryptedPath);
          } catch {
            // ignore cleanup failure
          }
        }
      }
    },
  );
};
