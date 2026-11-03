import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// SMILE_ENV_FILE lets an operator point at an alternative file, and lets the test
// suite load without picking up the developer's real .env.
const envFile = process.env.SMILE_ENV_FILE
  ? path.resolve(process.env.SMILE_ENV_FILE)
  : path.resolve(__dirname, '../../.env');

dotenv.config({ path: envFile });

/**
 * Secrets that were committed to source control (and documented in README.md) before
 * the hardening pass. They must never be accepted again, even if present in the
 * environment. See docs/SECURITY.md for the rotation procedure.
 */
export const LEAKED_SECRETS: ReadonlySet<string> = new Set([
  'smile_super_secret_jwt_key_2026_telfs_weissenbach!',
  'smile_secure_pass_2026!',
  '8JG1V6S28pQl6NZYqLjuHQ1d7hIeWY5h',
]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

/** True when the variable is present and not blank. */
export function isEnvSet(name: string): boolean {
  const raw = process.env[name];
  return raw !== undefined && raw.trim() !== '';
}

export function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const trimmed = raw.trim();
  if (!/^-?\d+$/.test(trimmed)) {
    throw new ConfigError(`Environment variable ${name} must be an integer.`);
  }
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isSafeInteger(parsed)) {
    throw new ConfigError(`Environment variable ${name} must be a safe integer.`);
  }
  return parsed;
}

export function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const lower = raw.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(lower)) return true;
  if (['0', 'false', 'no', 'off'].includes(lower)) return false;
  throw new ConfigError(`Environment variable ${name} must be a boolean (true/false, 1/0, yes/no, on/off).`);
}

/** Strict RFC3339 timestamp (explicit timezone required), used for business dates. */
export function readTimestamp(name: string, fallback: string): Date {
  const raw = process.env[name];
  const value = (raw && raw.trim()) || fallback;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) {
    throw new ConfigError(`Environment variable ${name} must be an ISO-8601 timestamp.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const zone = match[8];
  const offset = zone === 'Z' ? null : /[+-](\d{2}):(\d{2})$/.exec(zone);
  const offsetIsValid = !offset || (Number(offset[1]) <= 23 && Number(offset[2]) <= 59);
  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth[month - 1] ||
    hour > 23 || minute > 59 || second > 59 ||
    !offsetIsValid
  ) {
    throw new ConfigError(`Environment variable ${name} must be a valid ISO-8601 timestamp.`);
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ConfigError(`Environment variable ${name} must be a valid ISO-8601 timestamp.`);
  }
  return parsed;
}

export function readRankAggregation(name: string = 'RANK_AGGREGATION', fallback: 'total' | 'normalized' = 'total'): 'total' | 'normalized' {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const trimmed = raw.trim().toLowerCase();
  if (trimmed === 'total' || trimmed === 'normalized') return trimmed;
  throw new ConfigError(`Environment variable ${name} must be 'total' or 'normalized'.`);
}

function readOriginAllowlist(): string[] {
  const raw = process.env.CORS_ALLOWED_ORIGINS;
  if (!raw || !raw.trim()) {
    // Same-origin only. The app ships its own bundle from the same Fastify origin,
    // so an empty allowlist is correct for the default LAN deployment.
    return [];
  }
  return raw
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Secrets — validated lazily so that non-server entry points (seed, drizzle-kit,
// tests) can load configuration without needing the JWT signing key.
// ---------------------------------------------------------------------------

function containsLeakedSecret(value: string): boolean {
  for (const leaked of LEAKED_SECRETS) {
    if (value.includes(leaked)) return true;
  }
  return false;
}

/** Percent-decoded password of a connection string, or "" when it cannot be parsed. */
function decodedPasswordFromUrl(url: string): string {
  try {
    return decodeURIComponent(new URL(url).password);
  } catch {
    // Malformed URL: the pool will report it later. Never throw from here, so the
    // caller still sees the raw scan result rather than an opaque parse error.
    return '';
  }
}

export function databaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new ConfigError(
      'DATABASE_URL is not set. Copy .env.example to .env and fill in the credentials.\n' +
        'There is deliberately no fallback value: the old hardcoded fallback leaked the production password.',
    );
  }
  // Refuse a URL still carrying the password published in README.md, so nobody
  // redeploys with the compromised credential after a rotate-and-forget.
  for (const leaked of LEAKED_SECRETS) {
    if (url.includes(leaked)) {
      throw new ConfigError(
        'DATABASE_URL contains a password that was previously committed to source control and ' +
          'is therefore compromised. Set a new database password before starting the server.',
      );
    }
  }
  // A password may be percent-encoded in the connection string ("%21" for "!"), which a raw
  // substring scan cannot see. Decode the parsed password as well, otherwise the check is
  // trivially bypassable by re-encoding a single character.
  if (containsLeakedSecret(decodedPasswordFromUrl(url))) {
    throw new ConfigError(
      'DATABASE_URL contains a password that was previously committed to source control and ' +
        'is therefore compromised. Set a new database password before starting the server.',
    );
  }
  return url;
}

export function jwtSecret(): string {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret) {
    throw new ConfigError(
      'JWT_SECRET is not set. Generate one with:\n' +
        '  node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'base64url\'))"',
    );
  }
  if (LEAKED_SECRETS.has(secret)) {
    throw new ConfigError(
      'JWT_SECRET matches a value that was previously committed to source control and is therefore ' +
        'compromised. Generate a new random secret before starting the server.',
    );
  }
  if (secret.length < 32) {
    throw new ConfigError('JWT_SECRET must be at least 32 characters long.');
  }
  return secret;
}

/**
 * The bootstrap password used only for brand-new accounts that have never had a
 * password set. Every seeded teacher is flagged `must_change_password`, so this is
 * a one-time value that must be changed at first login.
 */
export function initialBootstrapPassword(): string {
  const pw = process.env.INITIAL_USER_PASSWORD?.trim();
  if (!pw) {
    throw new ConfigError(
      'INITIAL_USER_PASSWORD is not set. It seeds the first-login password for new accounts.\n' +
        'The old shared default ("smile2026") is banned because every teacher shared it.',
    );
  }
  if (pw.length < 12) {
    throw new ConfigError('INITIAL_USER_PASSWORD must be at least 12 characters long.');
  }
  if (pw.toLowerCase() === 'smile2026') {
    throw new ConfigError(
      'INITIAL_USER_PASSWORD is set to the previously published shared default. Choose a new value.',
    );
  }
  return pw;
}

/**
 * Directory holding encrypted backup files. Read on each call (not cached) so that
 * the value can change without a module reload; validated here in one place.
 */
export function backupDirectory(): string {
  const raw = process.env.BACKUP_DIR;
  const trimmed = raw?.trim() ?? '';
  if (!trimmed) return '/var/backups/smile';
  if (trimmed.includes('\0')) {
    throw new ConfigError('Environment variable BACKUP_DIR must not contain NUL bytes.');
  }
  return trimmed;
}

/**
 * Passphrase used to decrypt M365 backups. The value is returned exactly as set (no
 * trimming: a passphrase may legitimately contain spaces). Undefined when unset or empty.
 */
export function backupEncryptionPassphrase(): string | undefined {
  const raw = process.env.BACKUP_ENCRYPTION_PASSPHRASE;
  return raw ? raw : undefined;
}

/** Password for the single `admin` account, if the operator chooses to set one. */
export function adminBootstrapPassword(): string | undefined {
  const pw = process.env.ADMIN_PASSWORD?.trim();
  if (!pw) return undefined;
  if (LEAKED_SECRETS.has(pw)) {
    throw new ConfigError(
      'ADMIN_PASSWORD matches a value that was previously published in README.md. Choose a new one.',
    );
  }
  if (pw.length < 12) {
    throw new ConfigError('ADMIN_PASSWORD must be at least 12 characters long.');
  }
  return pw;
}

// ---------------------------------------------------------------------------
// Non-secret configuration
// ---------------------------------------------------------------------------

export const config = {
  env: process.env.NODE_ENV?.trim() || 'development',
  port: readInt('PORT', 3000),
  host: process.env.HOST?.trim() || '0.0.0.0',

  /** Set when running behind a TLS-terminating reverse proxy so cookies get the Secure flag. */
  trustProxy: readBool('TRUST_PROXY', false),
  /**
   * Default false because the LAN deployment serves plain HTTP. Setting it true also
   * makes the CSRF origin check reject every non-https Origin, so it must only be enabled
   * behind TLS. See productionCookieError() for the production signal.
   */
  cookieSecure: readBool('COOKIE_SECURE', false),
  /** True when COOKIE_SECURE was explicitly provided (even as false). */
  cookieSecureConfigured: isEnvSet('COOKIE_SECURE'),

  /** Apply pending schema migrations at boot. Set false only when migrations run out of band. */
  runMigrations: readBool('RUN_MIGRATIONS', true),

  /** Empty = same-origin only. Populate for split-origin dev setups, e.g. http://localhost:5173. */
  corsAllowedOrigins: readOriginAllowlist(),

  /** Session lifetime. Deliberately short; the UI re-authenticates on expiry. */
  sessionTtlSeconds: readInt('SESSION_TTL_SECONDS', 8 * 60 * 60),
  /**
   * SESSION_GRACE_SECONDS was removed.
   *
   * It was read, validated and advertised in .env.example as a window that keeps an
   * in-flight request alive past token expiry, but nothing ever referenced it. An
   * operator who set it was configuring a behaviour that did not exist. Either implement
   * the grace window or leave it out; a knob that only reads as a feature is worse than
   * no knob.
   */

  loginRateLimit: {
    max: readInt('LOGIN_RATE_LIMIT_MAX', 10),
    windowSeconds: readInt('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 300),
  },
  globalRateLimit: {
    max: readInt('GLOBAL_RATE_LIMIT_MAX', 600),
    windowSeconds: readInt('GLOBAL_RATE_LIMIT_WINDOW_SECONDS', 60),
  },
  /**
   * Inbound WebSocket message limit, per socket (token bucket). WebSocket frames are
   * not HTTP requests, so the global HTTP limiter never saw them; a connected client
   * could flood UPDATE_RATING without any throttle.
   */
  wsRateLimit: {
    perSecond: readInt('WS_RATE_LIMIT_PER_SECOND', 10),
    burst: readInt('WS_RATE_LIMIT_BURST', 40),
  },
  /** Max JSON request body. Assessment payloads are small; this is a cheap DoS guard. */
  bodyLimitBytes: readInt('BODY_LIMIT_BYTES', 256 * 1024),

  /** Per-class WebSocket room cap. Bounds memory if clients leak connections. */
  wsRoomMaxClients: readInt('WS_ROOM_MAX_CLIENTS', 200),
  /** How long a CELL_FOCUS soft-lock stays valid without a matching blur, in ms. */
  wsSoftLockTtlMs: readInt('WS_SOFT_LOCK_TTL_MS', 5000),

  /**
   * Deadlines that were previously hardcoded in route handlers. Kept in configuration
   * so a new school year is a config change, not a source edit.
   */
  submissionDeadline: readTimestamp('SUBMISSION_DEADLINE', '2026-10-30T21:59:59.000Z'),
  officialConferenceDate: readTimestamp('OFFICIAL_CONFERENCE_DATE', '2026-11-03T21:59:00.000Z'),

  /**
   * Rank thresholds over the 18-item Beobachtungsraster.
   *
   * RANK_AGGREGATION=total      (default, preserves historical behaviour) counts every
   *   positive item across all of a pupil's evaluations. Note this is unbounded: a pupil
   *   rated by three core-subject teachers can reach 54 items, so 14/18 is easier to reach
   *   than with a single teacher. This matches what the system has always reported.
   * RANK_AGGREGATION=normalized scales each core-subject evaluation back to an 18-item
   *   scale before averaging, so the threshold always means "14 of 18".
   */
  rankAggregation: readRankAggregation(),
  rankThresholds: {
    meister: readInt('RANK_THRESHOLD_MEISTER', 14),
    geselle: readInt('RANK_THRESHOLD_GESELLE', 8),
  },
  /** Denominator for the 18-item raster. */
  rubricItemCount: readInt('RUBRIC_ITEM_COUNT', 18),

  /** Behaviour-card counts that trigger an alert. */
  yellowCardAlertThreshold: readInt('YELLOW_CARD_ALERT_THRESHOLD', 2),
  yellowCardAlertWindowDays: readInt('YELLOW_CARD_ALERT_WINDOW_DAYS', 7),
  /** Timeout counts that trigger a headmaster escalation (3, 6, 9, ...). */
  escalationStep: readInt('ESCALATION_STEP', 3),

  // --- Statistics visibility -------------------------------------------------
  /**
   * School decision: every teacher may view the school-wide and per-class
   * statistics. The endpoint is read-only — it is a GET with no write path.
   *
   * Set to false to restrict teachers back to their own classes.
   */
  statisticsSchoolWide: readBool('STATISTICS_SCHOOL_WIDE', true),

  /**
   * Whether a teacher sees the individual `comment` and `nextStep` that OTHER
   * teachers wrote about a pupil. Rank counts and teacher attributions are
   * returned either way.
   *
   * Defaults to true: staff under the same controller may legitimately share
   * professional judgements, and this is the school's call. Set to false if
   * private notes should stay with their author.
   */
  statisticsShowForeignComments: readBool('STATISTICS_SHOW_FOREIGN_COMMENTS', true),

  // --- Microsoft Teams staff-channel notifications --------------------------
  /**
   * Incoming-webhook URL from a Teams Workflow ("Send webhook alerts to a
   * channel"). Empty disables the feature. The URL contains a bearer secret,
   * so it lives in .env and must never be logged or committed.
   */
  teams: {
    webhookUrl: (process.env.TEAMS_WEBHOOK_URL ?? '').trim(),
    /** Explicit switch; a missing URL also disables sending. */
    notificationsEnabled: readBool('TEAMS_NOTIFICATIONS_ENABLED', true),
    /** Link used by the card's "In SMILE öffnen" action. */
    appUrl: (process.env.PUBLIC_APP_URL ?? '').trim() || 'https://172.16.1.11',
  },
} as const;

export type AppConfig = typeof config;

/**
 * Validate everything the HTTP server needs. Called once at boot so a
 * misconfigured deployment fails loudly instead of silently using a default.
 */
export function assertServerConfig(): void {
  databaseUrl();
  jwtSecret();
  backupDirectory();

  const positiveSettings: Array<[string, number]> = [
    ['PORT', config.port],
    ['SESSION_TTL_SECONDS', config.sessionTtlSeconds],
    ['LOGIN_RATE_LIMIT_MAX', config.loginRateLimit.max],
    ['LOGIN_RATE_LIMIT_WINDOW_SECONDS', config.loginRateLimit.windowSeconds],
    ['GLOBAL_RATE_LIMIT_MAX', config.globalRateLimit.max],
    ['GLOBAL_RATE_LIMIT_WINDOW_SECONDS', config.globalRateLimit.windowSeconds],
    ['WS_RATE_LIMIT_PER_SECOND', config.wsRateLimit.perSecond],
    ['WS_RATE_LIMIT_BURST', config.wsRateLimit.burst],
    ['BODY_LIMIT_BYTES', config.bodyLimitBytes],
    ['WS_ROOM_MAX_CLIENTS', config.wsRoomMaxClients],
    ['WS_SOFT_LOCK_TTL_MS', config.wsSoftLockTtlMs],
    ['RUBRIC_ITEM_COUNT', config.rubricItemCount],
    ['YELLOW_CARD_ALERT_THRESHOLD', config.yellowCardAlertThreshold],
    ['YELLOW_CARD_ALERT_WINDOW_DAYS', config.yellowCardAlertWindowDays],
    ['ESCALATION_STEP', config.escalationStep],
  ];
  for (const [name, value] of positiveSettings) {
    if (value <= 0) {
      throw new ConfigError(`Environment variable ${name} must be greater than 0.`);
    }
  }

  if (config.port > 65_535) {
    throw new ConfigError('Environment variable PORT must be between 1 and 65535.');
  }
  if (config.rankThresholds.geselle < 0) {
    throw new ConfigError('RANK_THRESHOLD_GESELLE must be 0 or greater.');
  }
  if (config.rankThresholds.meister <= config.rankThresholds.geselle) {
    throw new ConfigError(
      `RANK_THRESHOLD_MEISTER (${config.rankThresholds.meister}) must be greater than ` +
        `RANK_THRESHOLD_GESELLE (${config.rankThresholds.geselle}).`,
    );
  }
}

/**
 * Non-fatal deployment warnings, logged once at boot. These describe known-accepted
 * states on the current LAN deployment (plain HTTP), so they must not fail startup —
 * but an operator should see them in the journal rather than discover them later.
 */
export function insecureConfigWarnings(
  cfg: { cookieSecure: boolean; trustProxy?: boolean } = config,
): string[] {
  const warnings: string[] = [];
  if (!cfg.cookieSecure) {
    warnings.push(
      'COOKIE_SECURE is disabled: the session cookie travels without the Secure flag. ' +
        'Set COOKIE_SECURE=true once the app is served over HTTPS (for example behind a TLS reverse proxy).',
    );
  }
  if (cfg.cookieSecure && !cfg.trustProxy) {
    warnings.push(
      'COOKIE_SECURE=true with TRUST_PROXY=false: an HTTPS Origin will be compared with ' +
        'request.protocol=http and state-changing requests will be rejected. Set TRUST_PROXY=true ' +
        'only when a reverse proxy you control sets X-Forwarded-Proto/Host, or terminate TLS in the app.',
    );
  }
  return warnings;
}

/**
 * Error-level startup signal for production when COOKIE_SECURE was never set. The
 * default is false (plain-HTTP LAN), so an unset value in production is almost always an
 * oversight rather than a decision. Setting COOKIE_SECURE=false explicitly silences this
 * error while keeping the boot warning. Returns undefined when no error applies.
 */
export function productionCookieError(
  cfg: Pick<AppConfig, 'env' | 'cookieSecureConfigured'> = config,
): string | undefined {
  if (cfg.env !== 'production' || cfg.cookieSecureConfigured) return undefined;
  return (
    'COOKIE_SECURE is not set while NODE_ENV=production. Session cookies are sent without the ' +
    'Secure flag. Set COOKIE_SECURE=true and TRUST_PROXY=true if TLS terminates in front of the app, ' +
    'or COOKIE_SECURE=false to acknowledge plain-HTTP serving. See docs/SECURITY.md (Known limitations).'
  );
}
