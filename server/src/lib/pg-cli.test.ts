import { beforeEach, describe, expect, it, vi } from 'vitest';

const execFileMock = vi.hoisted(() => vi.fn());

vi.mock('node:child_process', () => ({ execFile: execFileMock }));

import {
  pgConnection,
  redactSecrets,
  runPgDump,
  runPgRestore,
  runTool,
  ToolError,
} from './pg-cli.js';

// Contains characters that percent-encoding changes, so both forms must be kept out of argv.
const PASSWORD = 'Xk7@pw#probe';
const ENCODED_PASSWORD = encodeURIComponent(PASSWORD);
const DB_URL = `postgres://smile:${ENCODED_PASSWORD}@db.internal:5432/smile_db`;

interface Invocation {
  command: string;
  args: string[];
  env: Record<string, string | undefined>;
}

function failWith(code: number | string | undefined, stderr: string) {
  return { err: Object.assign(new Error(`Command failed: ${DB_URL}`), { code }), stderr };
}

function respondWith(outcome: ReturnType<typeof failWith> | null) {
  execFileMock.mockImplementation((command: string, args: string[], options: any, cb: any) => {
    if (outcome) cb(outcome.err, '', outcome.stderr);
    else cb(null, '', '');
    return {} as any;
  });
}

function lastInvocation(): Invocation {
  const call = execFileMock.mock.calls.at(-1)!;
  return { command: call[0], args: call[1], env: call[2].env };
}

function allArgvText(): string {
  return execFileMock.mock.calls.map((call) => [call[0], ...call[1]].join(' ')).join('\n');
}

beforeEach(() => {
  execFileMock.mockReset();
});

describe('pgConnection', () => {
  it('strips the password from the URI and returns it decoded for PGPASSWORD', () => {
    const conn = pgConnection(DB_URL);
    expect(conn.url).not.toContain(PASSWORD);
    expect(conn.url).not.toContain(ENCODED_PASSWORD);
    expect(conn.url).toContain('smile@db.internal');
    expect(conn.env).toEqual({ PGPASSWORD: PASSWORD });
    expect(conn.secrets).toEqual(expect.arrayContaining([PASSWORD, ENCODED_PASSWORD]));
  });

  it('does not echo the input when the URL cannot be parsed', () => {
    // Unterminated IPv6 host: the WHATWG parser rejects it and would echo the input.
    const broken = `postgres://smile:${ENCODED_PASSWORD}@[::1`;
    let message = '';
    try {
      pgConnection(broken);
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(PASSWORD);
    expect(message).not.toContain(ENCODED_PASSWORD);
    expect(message).not.toContain('postgres://');
  });
});

describe('pg_dump / pg_restore invocation', () => {
  it('never puts the password or the credentialed URI in argv; it travels in PGPASSWORD', async () => {
    respondWith(null);

    await runPgDump(DB_URL, 'C:\\tmp\\safety.dump');
    const dumpArgv = allArgvText();
    expect(dumpArgv).not.toContain(PASSWORD);
    expect(dumpArgv).not.toContain(ENCODED_PASSWORD);
    expect(lastInvocation().command).toBe('pg_dump');
    expect(lastInvocation().env.PGPASSWORD).toBe(PASSWORD);

    execFileMock.mockClear();
    await runPgRestore(DB_URL, 'C:\\tmp\\backup.dump');
    expect(allArgvText()).not.toContain(PASSWORD);
    expect(allArgvText()).not.toContain(ENCODED_PASSWORD);
    expect(lastInvocation().command).toBe('pg_restore');
    expect(lastInvocation().env.PGPASSWORD).toBe(PASSWORD);
    // Still targets the right database and host, just without the secret.
    expect(lastInvocation().args).toEqual(expect.arrayContaining(['-d']));
    expect(lastInvocation().args.join(' ')).toContain('postgres://smile@db.internal:5432/smile_db');
  });

  it('passes --exit-on-error so a failing statement aborts the restore', async () => {
    respondWith(null);
    await runPgRestore(DB_URL, 'C:\\tmp\\backup.dump');
    expect(lastInvocation().args).toContain('--exit-on-error');
  });

  it('rejects pg_restore exit code 1 (errors occurred) instead of reporting success', async () => {
    // pg_restore exits 1 when it hit errors and continued past them. The restore
    // route must see that as a failure and roll back, not as "some warnings".
    respondWith(failWith(1, 'pg_restore: warning: errors ignored on restore: 3'));
    const err = await runPgRestore(DB_URL, 'C:\\tmp\\backup.dump').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    expect((err as ToolError).exitCode).toBe(1);
  });

  it('rejects real pg_restore failures without leaking the URL or password into the error', async () => {
    respondWith(
      failWith(2, `pg_restore: error: could not connect with ${DB_URL} (password ${PASSWORD})`),
    );

    const err = await runPgRestore(DB_URL, 'C:\\tmp\\backup.dump').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolError);
    const text = `${(err as Error).message} ${(err as Error).stack ?? ''} ${String((err as ToolError).exitCode)}`;
    expect(text).toContain('pg_restore');
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(ENCODED_PASSWORD);
    expect(text).not.toContain(DB_URL);
    expect((err as ToolError).exitCode).toBe(2);
  });

  it('keeps the password out of the error when pg_dump fails with no stderr', async () => {
    respondWith(failWith('ENOENT', ''));
    const err = await runPgDump(DB_URL, 'C:\\tmp\\safety.dump').catch((e: unknown) => e);
    expect((err as Error).message).not.toContain(PASSWORD);
    expect((err as Error).message).not.toContain('postgres://');
    expect((err as Error).message).toContain('ENOENT');
  });
});

describe('runTool guard and redaction', () => {
  it('refuses to start a process whose argv contains a secret, and never spawns it', async () => {
    respondWith(null);
    const err = await runTool('pg_dump', ['--dbname', PASSWORD], { secrets: [PASSWORD] }).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ToolError);
    expect(execFileMock).not.toHaveBeenCalled();
  });

  it('passes a passphrase to openssl through the environment, not argv', async () => {
    respondWith(null);
    const passphrase = 'backup-key-do-not-leak-42';
    await runTool(
      'openssl',
      ['enc', '-d', '-pass', 'env:SMILE_BACKUP_PASSPHRASE'],
      { env: { SMILE_BACKUP_PASSPHRASE: passphrase }, secrets: [passphrase] },
    );
    expect(allArgvText()).not.toContain(passphrase);
    expect(lastInvocation().env.SMILE_BACKUP_PASSPHRASE).toBe(passphrase);
  });

  it('redacts connection URIs and listed secrets from free text', () => {
    const text = redactSecrets(`failed for ${DB_URL} with ${PASSWORD}`, [PASSWORD]);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain('postgres://');
    expect(text).toContain('<redacted>');
  });
});
