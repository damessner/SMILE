import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setRestoreRunnerForTests, type RestoreRunner } from './backup.js';

const auditEntries: any[] = [];

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
    app = await buildServer(async () => ({ sessionVersion: 0, mustChangePassword: false }));
    await app.ready();
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in TEST_ENV)) delete process.env[key];
    }
    Object.assign(process.env, saved);
  }
});

afterAll(async () => {
  if (app) await app.close();
  setRestoreRunnerForTests(null);
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
    });

    it('returns 500 if restore runner throws an error', async () => {
      const validBackup = path.join(testBackupDir, 'smile_db_2026-10-10_fail.dump');
      fs.writeFileSync(validBackup, 'valid dump data');

      const mockFailingRunner: RestoreRunner = async () => {
        throw new Error('Database connection failed during restore');
      };
      setRestoreRunnerForTests(mockFailingRunner);

      const token = createToken('admin');
      const res = await app!.inject({
        method: 'POST',
        url: '/api/backup/restore',
        cookies: { smile_session: token },
        payload: { backupId: 'smile_db_2026-10-10_fail.dump' },
      });

      expect(res.statusCode).toBe(500);
      expect(res.json().error).toContain('Wiederherstellung fehlgeschlagen');
    });
  });
});
