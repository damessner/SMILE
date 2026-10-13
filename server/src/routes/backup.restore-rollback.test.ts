import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// Scripted stand-in for pg_dump / pg_restore. Real binaries are never spawned.
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: execFileMock }));

const PASSWORD = 'Rb-probe@Secret#77';
const ENCODED = encodeURIComponent(PASSWORD);

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

import { isRestoreInProgress, resetRestoreGateForTests } from '../lib/restore-lock.js';

let testBackupDir: string;
let app: FastifyInstance | null = null;

const TEST_ENV: Record<string, string> = {
  JWT_SECRET: 'test-secret-that-is-long-enough-to-pass-validation-1234',
  DATABASE_URL: `postgres://smile:${ENCODED}@127.0.0.1:1/smile_db_test`,
  NODE_ENV: 'test',
  CORS_ALLOWED_ORIGINS: 'http://localhost:5173',
  SMILE_ENV_FILE: 'no-such-env-file-for-tests',
};

beforeAll(async () => {
  testBackupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smile-rollback-backups-'));
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
});

afterAll(async () => {
  if (app) await app.close();
  fs.rmSync(testBackupDir, { recursive: true, force: true });
});

function createToken(): string {
  return app!.jwt.sign(
    { id: 'user-admin', username: 'admin_user', role: 'admin', teacherId: 1, mustChangePassword: false, sessionVersion: 0 },
    { expiresIn: '1h' },
  );
}

interface Call {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
  gateHeld: boolean;
}

/** Which step of the restore flow fails in a given scenario. */
interface Scenario {
  safetyDumpFails: boolean;
  forwardRestoreFails: boolean;
  rollbackFails: boolean;
}

const calls: Call[] = [];
let scenario: Scenario;

function classify(command: string, args: string[], backupFile: string): 'version' | 'safety' | 'forward' | 'rollback' {
  if (args.includes('--version')) return 'version';
  if (command === 'pg_dump') return 'safety';
  const archive = args[args.length - 1];
  return archive === backupFile ? 'forward' : 'rollback';
}

let backupFile = '';

beforeEach(() => {
  calls.length = 0;
  auditEntries.length = 0;
  execFileMock.mockReset();
  resetRestoreGateForTests();
  scenario = { safetyDumpFails: false, forwardRestoreFails: false, rollbackFails: false };
  backupFile = path.join(testBackupDir, 'smile_db_2026-10-12_rollback.dump');
  fs.writeFileSync(backupFile, 'archive');

  execFileMock.mockImplementation((command: string, args: string[], options: any, cb: any) => {
    calls.push({ command, args: [...args], env: options?.env ?? {}, gateHeld: isRestoreInProgress() });
    const step = classify(command, args, backupFile);
    const failing =
      (step === 'safety' && scenario.safetyDumpFails) ||
      (step === 'forward' && scenario.forwardRestoreFails) ||
      (step === 'rollback' && scenario.rollbackFails);

    if (step === 'safety' && !failing) {
      // pg_dump -f <path>: create the file so the safety dump exists on disk.
      fs.writeFileSync(args[args.indexOf('-f') + 1], 'safety archive');
    }
    if (failing) {
      const err = Object.assign(new Error(`Command failed: ${command} ${args.join(' ')}`), { code: 2 });
      // Worst case: the tool echoes the credentialed URI and password on stderr.
      cb(err, '', `pg_restore: error: connection failed for postgres://smile:${ENCODED}@127.0.0.1:1 (${PASSWORD})`);
    } else {
      cb(null, '', '');
    }
    return {} as any;
  });
});

function restore(payload: unknown) {
  return app!.inject({
    method: 'POST',
    url: '/api/backup/restore',
    cookies: { smile_session: createToken() },
    payload: payload as object,
  });
}

/** Database-touching calls only; the `--version` preflight is excluded. */
function pgCalls(): Call[] {
  return calls.filter(
    (c) => (c.command === 'pg_dump' || c.command === 'pg_restore') && !c.args.includes('--version'),
  );
}

describe('POST /api/backup/restore: failure path and rollback', () => {
  it('rolls back from the safety dump when pg_restore fails, and reports both outcomes', async () => {
    scenario.forwardRestoreFails = true;
    const res = await restore({ backupId: path.basename(backupFile) });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toContain('Wiederherstellung fehlgeschlagen');
    expect(body.error).toContain('zurückgesetzt');
    expect(body.preRestoreBackup).toMatch(/^pre-restore-safety-.*\.dump$/);
    expect(body.rollback).toEqual({ attempted: true, succeeded: true });
    expect(body.liveSyncReopened).toBe(true);

    // Order: safety dump, failing restore, then restore of the safety dump.
    const steps = pgCalls().map((c) => c.command + ':' + c.args[c.args.length - 1]);
    expect(steps).toEqual([
      'pg_dump:' + path.join(testBackupDir, body.preRestoreBackup),
      'pg_restore:' + backupFile,
      'pg_restore:' + path.join(testBackupDir, body.preRestoreBackup),
    ]);

    // The safety dump is kept on disk after the rollback.
    expect(fs.existsSync(path.join(testBackupDir, body.preRestoreBackup))).toBe(true);
    // The restore gate was held during every database-touching call and released afterwards.
    expect(pgCalls().every((c) => c.gateHeld)).toBe(true);
    expect(isRestoreInProgress()).toBe(false);
    // No success audit row for a failed restore.
    expect(auditEntries.some((e) => e.action === 'DATABASE_RESTORED')).toBe(false);
  });

  it('reports a failed rollback and still keeps the safety file for manual recovery', async () => {
    scenario.forwardRestoreFails = true;
    scenario.rollbackFails = true;
    const res = await restore({ backupId: path.basename(backupFile) });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.rollback).toEqual({ attempted: true, succeeded: false });
    expect(body.error).toContain('manuell');
    expect(body.preRestoreBackup).toMatch(/^pre-restore-safety-.*\.dump$/);
    expect(fs.existsSync(path.join(testBackupDir, body.preRestoreBackup))).toBe(true);
    expect(isRestoreInProgress()).toBe(false);
  });

  it('does not touch the database again when the safety dump itself fails', async () => {
    scenario.safetyDumpFails = true;
    const res = await restore({ backupId: path.basename(backupFile) });

    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toContain('nicht verändert');
    expect(body.rollback).toEqual({ attempted: false, succeeded: false });
    // Only the failed safety dump ran: no pg_restore of either archive.
    expect(pgCalls().map((c) => c.command)).toEqual(['pg_dump']);
    expect(isRestoreInProgress()).toBe(false);
  });

  it('closes live sockets and holds the gate before the first destructive call', async () => {
    const res = await restore({ backupId: path.basename(backupFile) });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.liveSyncReopened).toBe(true);
    expect(body.rollback).toBeUndefined();
    expect(pgCalls().map((c) => c.command)).toEqual(['pg_dump', 'pg_restore']);
    expect(pgCalls().every((c) => c.gateHeld)).toBe(true);
    expect(isRestoreInProgress()).toBe(false);
    expect(auditEntries.some((e) => e.action === 'DATABASE_RESTORED')).toBe(true);
  });

  it('never places the database password in any argv, env var name, or response body', async () => {
    scenario.forwardRestoreFails = true;
    const res = await restore({ backupId: path.basename(backupFile) });

    for (const call of calls) {
      const argv = [call.command, ...call.args].join(' ');
      expect(argv).not.toContain(PASSWORD);
      expect(argv).not.toContain(ENCODED);
    }
    // The credential is handed to the tools through PGPASSWORD only.
    expect(pgCalls().every((c) => c.env.PGPASSWORD === PASSWORD)).toBe(true);
    expect(res.body).not.toContain(PASSWORD);
    expect(res.body).not.toContain(ENCODED);
  });

  it('returns 409 without touching the database when another restore holds the gate', async () => {
    const { tryBeginRestore, endRestore } = await import('../lib/restore-lock.js');
    expect(tryBeginRestore()).toBe(true);
    try {
      const res = await restore({ backupId: path.basename(backupFile) });
      expect(res.statusCode).toBe(409);
      expect(pgCalls()).toHaveLength(0);
      // The rejected request must not release a gate it does not own.
      expect(isRestoreInProgress()).toBe(true);
    } finally {
      endRestore();
    }
  });
});
