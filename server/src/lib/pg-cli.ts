import { execFile } from 'node:child_process';
import fs from 'node:fs';

/** Failure of an external client (pg_dump, pg_restore, openssl). The message is already redacted. */
export class ToolError extends Error {
  readonly exitCode: number | undefined;

  constructor(message: string, exitCode?: number) {
    super(message);
    this.name = 'ToolError';
    this.exitCode = exitCode;
  }
}

export interface RunToolOptions {
  /** Values that must never appear in argv or in error text (passwords, passphrases). */
  secrets?: readonly string[];
  /** Extra child environment. Credentials belong here, never in args. */
  env?: Record<string, string>;
}

const CONNECTION_URL = /postgres(?:ql)?:\/\/[^\s'"]*/gi;

/** Masks connection URIs and every listed secret in free text. */
export function redactSecrets(text: string, secrets: readonly string[] = []): string {
  let out = text.replace(CONNECTION_URL, 'postgresql://<redacted>');
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('<redacted>');
  }
  return out;
}

/**
 * Runs an external tool without a shell. Refuses to start if a secret appears in argv,
 * and never includes argv in the error it throws (Node's default message would).
 */
export function runTool(
  command: string,
  args: readonly string[],
  options: RunToolOptions = {},
): Promise<{ stdout: string; stderr: string }> {
  const secrets = (options.secrets ?? []).filter((s) => s.length > 0);
  if (args.some((arg) => secrets.some((s) => arg.includes(s)))) {
    return Promise.reject(
      new ToolError(`${command}: Zugangsdaten dürfen nicht über die Kommandozeile übergeben werden.`),
    );
  }

  return new Promise((resolve, reject) => {
    execFile(
      command,
      [...args],
      { env: { ...process.env, ...options.env }, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
          return;
        }
        const errno = (error as NodeJS.ErrnoException).code;
        const exitCode = typeof errno === 'number' ? errno : undefined;
        const detail =
          String(stderr ?? '').trim() || (typeof errno === 'string' ? errno : 'Prozess fehlgeschlagen');
        const suffix = exitCode !== undefined ? ` (Exit ${exitCode})` : '';
        reject(
          new ToolError(
            `${command} fehlgeschlagen${suffix}: ${redactSecrets(detail, secrets).slice(0, 2000)}`,
            exitCode,
          ),
        );
      },
    );
  });
}

export interface PgConnection {
  /** Connection URI with the password removed. Safe for argv. */
  url: string;
  /** Child environment carrying the password as PGPASSWORD. */
  env: Record<string, string>;
  /** Raw and percent-encoded password, used for the argv guard and redaction. */
  secrets: string[];
}

/** Splits a DATABASE_URL into a password-free URI (for argv) and the password (for PGPASSWORD). */
export function pgConnection(dbUrl: string): PgConnection {
  let parsed: URL;
  try {
    parsed = new URL(dbUrl);
  } catch {
    // Do not chain the parser error: it echoes the input, which carries the password.
    throw new ToolError('DATABASE_URL ist kein gültiger Verbindungs-URL.');
  }
  let password: string;
  try {
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new ToolError('DATABASE_URL enthält ein ungültig kodiertes Passwort.');
  }
  parsed.password = '';
  return {
    url: parsed.toString(),
    env: password ? { PGPASSWORD: password } : {},
    secrets: password ? [password, encodeURIComponent(password)] : [],
  };
}

/** Full custom-format dump of the live database into outPath. Read-only. */
export async function runPgDump(dbUrl: string, outPath: string): Promise<void> {
  const conn = pgConnection(dbUrl);
  await runTool('pg_dump', ['-Fc', '--no-owner', '--no-acl', '-d', conn.url, '-f', outPath], {
    env: conn.env,
    secrets: conn.secrets,
  });
  // The safety dump contains the full pupil database. Do not rely on the process
  // umask: the backup directory may be readable by group members.
  try {
    fs.chmodSync(outPath, 0o600);
  } catch {
    // A chmod failure must not turn a usable safety dump into a failed restore.
  }
}

/**
 * Replaces the live database contents with the archive at archivePath.
 *
 * Any non-zero exit is a failure. Exit code 1 from pg_restore means it ran into
 * errors and continued past them ("errors ignored on restore") - a partially
 * applied restore, which the route's rollback contract must treat as damage.
 * --exit-on-error stops at the first failing statement instead.
 */
export async function runPgRestore(dbUrl: string, archivePath: string): Promise<void> {
  const conn = pgConnection(dbUrl);
  await runTool(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-acl',
      '--exit-on-error',
      '-d',
      conn.url,
      archivePath,
    ],
    { env: conn.env, secrets: conn.secrets },
  );
}
