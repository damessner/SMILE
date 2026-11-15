import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  setRestoreRunnerForTests,
  setRollbackRunnerForTests,
  type RestoreRunner,
} from './backup.js';

const auditEntries: any[] = [];

// The restore route migrates the restored database to the current schema before it
// reports success; stub the migrator so these tests never touch a real database.
const migrationsMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock('../db/index.js', async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import('../db/index.js')>()),
    db: {
      insert: () => ({
        values: async (data: any) => {
          auditEntries.push(data);
          return [data];
        },
      }),
      select: () => ({
        from: () => ({
          limit: async () => [],
          then: (fn: any) => Promise.resolve([]).then(fn),
        }),
      }),
    },
    getPool: () => ({
      query: async () => ({ rows: [] }),
    }),
    runMigrations: migrationsMock,
  };
});

let testBackupDir: string;

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: 'postgres://smile:password@127.0.0.1:1/smile_db_test',
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
};

let app: FastifyInstance | null = null;

beforeAll(async () => {
  testBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smile-test-backups-'));
  process.env.BACKUP_DIR = testBackupDir;

  const saved = { ...process.env };
  Object.assign(process.env, TEST_ENV);

  const { buildServer } = await import('../index.js');
  try {
    app = await buildServer(async () => ({ sessionVersion: 0, mustChangePassword: false, teacherActive: true }));
    await app.ready();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in TEST_ENV)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
}, 30_000); // full-suite load on Windows can exceed vitest's 10s default hook timeout

afterAll(async () => {
  if (app) await app.close();
  setRestoreRunnerForTests(null);
  setRollbackRunnerForTests(null);
  try {
    fs.rmSync(testBackupDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup
  }
});

function createToken(role: 'admin' | 'teacher' | 'head_teacher'): string {
  return app!.jwt.sign(
    {
      id: `user-${role}`,
      username: `${role}_user`,
      role,
      teacherId: 1,
      mustChangePassword: false,
      sessionVersion: 0,
    },
    { expiresIn: '1h' },
  );
}

describe('Backup API endpoints (Task 6)', () => {
  beforeEach(() => {
    auditEntries.length = 0;
    migrationsMock.mockClear();
  });

  describe('GET /api/backup/list', () => {
    it('rejects unauthenticated requests with 401', async () => {
      const res = await app!.inject({
        method: 'GET',
        url: '/api/backup/list',
      });
      expect(res.statusCode).toBe(401);
    });

    it('rejects non-admin role with 403', async () => {
      const token = createToken('teacher');
      const res = await app!.inject({
        method: 'GET',
        url: '/api/backup/list',
        cookies: { smile_session: token },
      });
      expect(res.statusCode).toBe(403);
    });

    it('returns empty list when no backups exist', async () => {
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'GET',
        url: '/api/backup/list',
        cookies: { smile_session: token },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.backups).toBeDefined();
      expect(Array.isArray(data.backups)).toBe(true);
    });

    it('lists backup files sorted newest first with metadata', async () => {
      const olderFile = path.join(testBackupDir, 'smile_db_2026-10-10_1000.dump');
      const newerFile = path.join(testBackupDir, 'smile_db_2026-10-10_1100.dump');
      fs.writeFileSync(olderFile, 'dummy older dump content');
      fs.writeFileSync(newerFile, 'dummy newer dump content with more bytes');

      // Set explicit mtimes so sorting order is guaranteed
      fs.utimesSync(olderFile, new Date(2026, 9, 10, 10, 0, 0), new Date(2026, 9, 10, 10, 0, 0));
      fs.utimesSync(newerFile, new Date(2026, 9, 10, 11, 0, 0), new Date(2026, 9, 10, 11, 0, 0));

      const token = createToken('admin');
      const res = await app!.inject({
        method: 'GET',
        url: '/api/backup/list',
        cookies: { smile_session: token },
      });
      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.backups.length).toBeGreaterThanOrEqual(2);
      expect(data.backups[0].filename).toBe('smile_db_2026-10-10_1100.dump');
      expect(data.backups[0].sizeFormatted).toBeDefined();
      expect(data.backups[0].timestamp).toBeDefined();
    });
  });

  describe('POST /api/backup/restore', () => {
    it('rejects non-admin requests with 403', async () => {
      const token = createToken('head_teacher');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: 'smile_db_2026-10-10_1100.dump' },
      });
      expect(res.statusCode).toBe(403);
    });

    it('rejects empty or missing backupId with 400', async () => {
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: {},
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects path traversal attempts with 400', async () => {
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: '../../etc/passwd.dump' },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Ungültiger');
    });

    it('rejects unsupported file extensions with 400', async () => {
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: 'evil_script.sh' },
      });
      expect(res.statusCode).toBe(400);
    });

    it('rejects non-existent file with 404', async () => {
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: 'non_existent_2099-01-01.dump' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('executes restore, creates safety snapshot, records audit log, and returns success', async () => {
      const validBackup = path.join(testBackupDir, 'smile_db_2026-10-10_valid.dump');
      fs.writeFileSync(validBackup, 'valid dump data');

      let executedRestorePath = '';
      let executedSafetyPath = '';
      const mockRunner: RestoreRunner = async (_dbUrl, backupPath, safetyPath) => {
        executedRestorePath = backupPath;
        executedSafetyPath = safetyPath;
        return { safetyCreated: true };
      };
      setRestoreRunnerForTests(mockRunner);

      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: 'smile_db_2026-10-10_valid.dump' },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json();
      expect(data.success).toBe(true);
      expect(data.preRestoreBackup).toMatch(/^pre-restore-safety-.*\.dump$/);
      expect(executedRestorePath).toBe(validBackup);
      expect(executedSafetyPath).toContain('pre-restore-safety-');

      // Verify audit log row
      expect(auditEntries.length).toBe(1);
      expect(auditEntries[0].action).toBe('DATABASE_RESTORED');
      expect(auditEntries[0].payload.restoredBackup).toBe('smile_db_2026-10-10_valid.dump');

      // The restored database is migrated to the current schema while the gate is held.
      expect(migrationsMock).toHaveBeenCalledTimes(1);
    });

    it('returns 500 if restore runner throws an error', async () => {
      const validBackup = path.join(testBackupDir, 'smile_db_2026-10-10_fail.dump');
      fs.writeFileSync(validBackup, 'valid dump data');

      const mockFailingRunner: RestoreRunner = async () => {
        throw new Error('Database connection failed during restore');
      };
      setRestoreRunnerForTests(mockFailingRunner);
      const rollbackCalls: string[] = [];
      setRollbackRunnerForTests(async (_dbUrl, safetyPath) => {
        rollbackCalls.push(safetyPath);
      });

      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: 'smile_db_2026-10-10_fail.dump' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain('Wiederherstellung fehlgeschlagen');
      // Generic failures after the destructive step roll back from the safety dump.
      expect(rollbackCalls).toHaveLength(1);
      expect(path.basename(rollbackCalls[0])).toMatch(/^pre-restore-safety-.*\.dump$/);
      expect(res.json().preRestoreBackup).toBe(path.basename(rollbackCalls[0]));
      expect(res.json().rollback).toEqual({ attempted: true, succeeded: true });
      // A failed restore never reaches the migration step; it leaves exactly one
      // failure audit row instead of a success row.
      expect(migrationsMock).not.toHaveBeenCalled();
      expect(auditEntries).toHaveLength(1);
      expect(auditEntries[0].action).toBe('DATABASE_RESTORE_FAILED');
    });
  });

  // The encryption passphrase is a single, independent secret. These two tests
  // pin the contract with scripts/backup_m365.py: it encrypts only with
  // BACKUP_ENCRYPTION_PASSPHRASE, so the restore path must not accept any other
  // variable name. An earlier version fell back to M365_BACKUP_PASSWORD, which
  // no writer ever used.
  describe('restore of an encrypted backup', () => {
    const ENC_FILE = 'smile_db_2026-10-10_1100.dump.enc';

    afterEach(() => {
      delete process.env.BACKUP_ENCRYPTION_PASSPHRASE;
      delete process.env.M365_BACKUP_PASSWORD;
    });

    const writeEncBackup = () => {
      fs.writeFileSync(path.join(testBackupDir, ENC_FILE), 'ciphertext');
    };

    it('rejects an encrypted backup when no passphrase is configured', async () => {
      writeEncBackup();
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: ENC_FILE },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Entschlüsselungs-Passwort');
    });

    it('does not accept a retired fallback variable as the passphrase', async () => {
      writeEncBackup();
      process.env.M365_BACKUP_PASSWORD = 'not-the-backup-key';
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: ENC_FILE },
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error).toContain('Entschlüsselungs-Passwort');
    });
  });

  describe('GET /api/backup/export-json', () => {
    it('exports all domain tables including locks, notifications, outbox, and chunked auditLogs', async () => {
      const token = createToken('admin');
      const res = await app!.inject({
        method: 'GET',
        url: '/api/backup/export-json',
        cookies: { smile_session: token },
      });

      expect(res.statusCode).toBe(200);
      const data = res.json().data as Record<string, unknown>;
      for (const key of [
        'teachers',
        'classes',
        'pupils',
        'pupilSubjectTeachers',
        'teachingAssignments',
        'timetableLessons',
        'observationRounds',
        'classRoundLocks',
        'rubrics',
        'rubricCriteria',
        'evaluations',
        'evaluationItems',
        'behaviorCards',
        'pupilBehaviorActions',
        'finalRanks',
        'timeoutIncidents',
        'timeoutEscalations',
        'notificationPreferences',
        'notificationSubscriptions',
        'webuntisSyncOutbox',
        'auditLogs',
        'passwordResetRequests',
      ]) {
        expect(Array.isArray(data[key]), `expected array for backup key ${key}`).toBe(true);
      }
    });
  });
});
