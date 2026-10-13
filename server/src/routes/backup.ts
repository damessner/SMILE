import fs from 'node:fs';
import path from 'node:path';
import type { FastifyPluginAsync } from 'fastify';
import { db, getPool, runMigrations } from '../db/index.js';
import { backupDirectory, backupEncryptionPassphrase, databaseUrl } from '../config.js';
import { safeErrorLogFields } from '../lib/log-safety.js';
import { closeAllWebSockets } from '../ws/live-sync.js';
import { endRestore, tryBeginRestore } from '../lib/restore-lock.js';
import { runPgDump, runPgRestore, runTool } from '../lib/pg-cli.js';
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
import type { AuthUser } from '../lib/guards.js';
import { parsePageParams } from '../lib/pagination.js';

/**
 * Raised when a restore fails before the live database is modified (tools missing,
 * safety dump failed). Nothing is rolled back in that case.
 */
export class PreRestoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreRestoreError';
  }
}

/** Forward operation: writes the safety dump of the live database, then replaces it with backupPath. */
export type RestoreRunner = (
  dbUrl: string,
  backupPath: string,
  safetyPath: string,
) => Promise<{ safetyCreated: boolean }>;

/** Rollback operation: replaces the live database with the pre-restore safety dump. */
export type RollbackRunner = (dbUrl: string, safetyPath: string) => Promise<void>;

export const defaultRestoreRunner: RestoreRunner = async (dbUrl, backupPath, safetyPath) => {
  // Pre-flight: verify required PostgreSQL client binaries exist
  try {
    await runTool('pg_dump', ['--version']);
    await runTool('pg_restore', ['--version']);
  } catch {
    throw new PreRestoreError('PostgreSQL-Werkzeuge (pg_dump / pg_restore) sind auf dem Server nicht im PATH verfügbar.');
  }

  // Pre-flight: the archive must actually be a pg_dump archive. `--list` reads the file
  // only; plain SQL files, empty files or truncated archives fail here - before the
  // safety dump runs and long before --clean touches the live database.
  try {
    await runTool('pg_restore', ['--list', backupPath]);
  } catch (err) {
    throw new PreRestoreError(
      `Backup-Datei ist kein gültiges pg_dump-Archiv: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
    );
  }

  // Step 1: safety snapshot. Read-only, so a failure here leaves the data untouched.
  try {
    await runPgDump(dbUrl, safetyPath);
  } catch (err) {
    throw new PreRestoreError(
      `Sicherheitskopie fehlgeschlagen: ${err instanceof Error ? err.message : 'unbekannter Fehler'}`,
    );
  }

  // Step 2: destructive replacement. Any error from here on is handled by the rollback.
  await runPgRestore(dbUrl, backupPath);
  return { safetyCreated: true };
};

export const defaultRollbackRunner: RollbackRunner = async (dbUrl, safetyPath) => {
  if (!fs.existsSync(safetyPath)) {
    throw new Error('Sicherheitskopie für die Zurücksetzung wurde nicht gefunden.');
  }
  await runPgRestore(dbUrl, safetyPath);
};

let activeRestoreRunner: RestoreRunner = defaultRestoreRunner;
let activeRollbackRunner: RollbackRunner = defaultRollbackRunner;

export function setRestoreRunnerForTests(runner: RestoreRunner | null): void {
  activeRestoreRunner = runner ?? defaultRestoreRunner;
}

export function setRollbackRunnerForTests(runner: RollbackRunner | null): void {
  activeRollbackRunner = runner ?? defaultRollbackRunner;
}

/** Returns true when the safety dump was restored. Never throws; logs the outcome. */
async function rollbackToSafety(
  dbUrl: string,
  safetyFilePath: string,
  log: { error: (obj: object, msg: string) => void },
): Promise<boolean> {
  try {
    await activeRollbackRunner(dbUrl, safetyFilePath);
    return true;
  } catch (err) {
    log.error(safeErrorLogFields(err), 'Automatic rollback from pre-restore safety backup failed');
    return false;
  }
}

/**
 * Best-effort audit row for a failed restore. Runs after any rollback, so on a successful
 * rollback the row survives in the safety-restored database; when even that failed, the
 * insert may not be possible at all - hence failures here are only logged.
 */
async function recordRestoreFailureAudit(
  user: Pick<AuthUser, 'teacherId' | 'username'>,
  failure: {
    attemptedBackup: string;
    safetyBackup: string | null;
    stage: 'pre-restore' | 'after-destructive-step';
    rollback: { attempted: boolean; succeeded: boolean };
  },
  log: { error: (obj: object, msg: string) => void },
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: safeTeacherId(user.teacherId),
      action: 'DATABASE_RESTORE_FAILED',
      entity: 'system',
      entityId: 'backup',
      payload: {
        attemptedBackup: failure.attemptedBackup,
        safetyBackup: failure.safetyBackup,
        stage: failure.stage,
        rollback: failure.rollback,
        attemptedBy: user.username,
        failedAt: new Date().toISOString(),
      },
    });
  } catch (err) {
    log.error(safeErrorLogFields(err), 'Failed to record restore failure in audit log');
  }
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
      const { action } = (request.query ?? {}) as { action?: string };

      const parsed = parsePageParams(request.query);
      if (!parsed.ok) return reply.status(400).send({ error: parsed.error });
      const { limit: take, offset: skip } = parsed.page;

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

    const backupDir = backupDirectory();
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
   *  - Restore gate (restore-lock.ts) and LiveSync disconnect (1001) happen BEFORE the
   *    first destructive statement, not after success.
   *  - If anything fails after the destructive step, the safety dump is restored
   *    automatically. The response reports both the failure and the rollback outcome,
   *    and names the safety file. The safety file is never deleted.
   *  - Full audit logging upon completion.
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

      // Only pg_dump archives can be applied by pg_restore. Plain-SQL exports
      // (.sql / .sql.gz) remain listed for download, but restoring them here would
      // fail halfway, so they must be replayed manually with psql.
      if (!cleanId.endsWith('.dump') && !cleanId.endsWith('.dump.enc')) {
        return reply.status(400).send({
          error:
            'Nur PostgreSQL-Archive (.dump / .dump.enc) können wiederhergestellt werden. ' +
            'SQL-Exporte (.sql / .sql.gz) müssen manuell mit psql eingespielt werden.',
        });
      }

      const backupDir = backupDirectory();
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
      let restoreGateHeld = false;

      try {
        if (cleanId.endsWith('.dump.enc')) {
          // Single source of truth for the decryption key. There is deliberately
          // no fallback to a second variable name: scripts/backup_m365.py encrypts
          // only with BACKUP_ENCRYPTION_PASSPHRASE, so accepting anything else here
          // could produce a confusing failure instead of a clear misconfiguration.
          const passphrase = backupEncryptionPassphrase();
          if (!passphrase) {
            return reply.status(400).send({
              error: 'Kein Entschlüsselungs-Passwort (BACKUP_ENCRYPTION_PASSPHRASE) konfiguriert.',
            });
          }
          tempDecryptedPath = path.join(backupDir, `temp-decrypt-${Date.now()}.dump`);
          // Create the target 0600 first: openssl keeps the mode of an existing file, so
          // a crash mid-decrypt cannot leave a world-readable plaintext dump behind.
          fs.writeFileSync(tempDecryptedPath, '', { mode: 0o600 });
          // The passphrase travels in the child environment, not argv (visible in the process list).
          await runTool('openssl', [
            'enc', '-d', '-aes-256-cbc', '-pbkdf2',
            '-in', targetFilePath,
            '-out', tempDecryptedPath,
            '-pass', 'env:SMILE_BACKUP_PASSPHRASE',
          ], { env: { SMILE_BACKUP_PASSPHRASE: passphrase }, secrets: [passphrase] });
          targetRestorePath = tempDecryptedPath;
        }

        const dbUrl = databaseUrl();

        // Gate first, then disconnect: writes are refused and clients are dropped before the
        // safety dump starts. Clients can reconnect only once the gate is released below.
        if (!tryBeginRestore()) {
          return reply.status(409).send({ error: 'Eine andere Wiederherstellung läuft bereits.' });
        }
        restoreGateHeld = true;
        closeAllWebSockets(1001, 'database restore in progress');

        const failAfterDestructiveStep = async (err: unknown) => {
          const rolledBack = await rollbackToSafety(dbUrl, safetyFilePath, request.log);
          request.log.error(
            { ...safeErrorLogFields(err), safetyBackup: safetyFileName, rollbackSucceeded: rolledBack },
            'Database restore failed',
          );
          await recordRestoreFailureAudit(
            user,
            {
              attemptedBackup: cleanId,
              safetyBackup: safetyFileName,
              stage: 'after-destructive-step',
              rollback: { attempted: true, succeeded: rolledBack },
            },
            request.log,
          );
          return reply.status(500).send({
            error: rolledBack
              ? 'Wiederherstellung fehlgeschlagen. Die Datenbank wurde automatisch auf die Sicherheitskopie zurückgesetzt.'
              : 'Wiederherstellung fehlgeschlagen. Die automatische Zurücksetzung ist ebenfalls fehlgeschlagen. Die Sicherheitskopie muss manuell eingespielt werden.',
            preRestoreBackup: safetyFileName,
            rollback: { attempted: true, succeeded: rolledBack },
            liveSyncReopened: true,
          });
        };

        try {
          await activeRestoreRunner(dbUrl, targetRestorePath, safetyFilePath);
        } catch (err) {
          if (err instanceof PreRestoreError) {
            // Failed before the live database was modified: there is nothing to roll back.
            request.log.error(
              { ...safeErrorLogFields(err), safetyBackup: safetyFileName },
              'Restore aborted before the database was modified',
            );
            await recordRestoreFailureAudit(
              user,
              {
                attemptedBackup: cleanId,
                safetyBackup: fs.existsSync(safetyFilePath) ? safetyFileName : null,
                stage: 'pre-restore',
                rollback: { attempted: false, succeeded: false },
              },
              request.log,
            );
            return reply.status(500).send({
              error: 'Wiederherstellung fehlgeschlagen. Die Datenbank wurde nicht verändert. Überprüfen Sie die Server-Logs.',
              preRestoreBackup: fs.existsSync(safetyFilePath) ? safetyFileName : null,
              rollback: { attempted: false, succeeded: false },
              liveSyncReopened: true,
            });
          }
          return failAfterDestructiveStep(err);
        }

        try {
          // A restored dump may predate the app's newest migration (for example one taken
          // before users.password_issued_at existed). Upgrade the schema now, while the
          // gate is still held and writes are refused; a failure rolls back like any other.
          await runMigrations();

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
        } catch (err) {
          // A failure after the data was replaced is still a failed restore; it rolls back too.
          return failAfterDestructiveStep(err);
        }

        return reply.send({
          success: true,
          message: `Backup ${cleanId} wurde erfolgreich eingespielt. Sicherheitskopie ${safetyFileName} wurde erstellt.`,
          preRestoreBackup: safetyFileName,
          restoredAt: new Date().toISOString(),
          liveSyncReopened: true,
        });
      } catch (err) {
        request.log.error(safeErrorLogFields(err), 'Database restore execution failed');
        return reply.status(500).send({
          error: 'Wiederherstellung fehlgeschlagen. Überprüfen Sie die Server-Logs.',
        });
      } finally {
        if (restoreGateHeld) endRestore();
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
