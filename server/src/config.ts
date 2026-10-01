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
]);

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(parsed)) {
    throw new ConfigError(`Environment variable ${name} must be an integer, got "${raw}".`);
  }
  return parsed;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/** RFC3339 timestamp, validated. Used for the business deadlines. */
function readTimestamp(name: string, fallback: string): Date {
  const raw = process.env[name];
  const value = (raw && raw.trim()) || fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new ConfigError(`Environment variable ${name} must be an ISO-8601 timestamp, got "${value}".`);
  }
  return parsed;
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
  return pw;
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
  cookieSecure: readBool('COOKIE_SECURE', false),

  /** Empty = same-origin only. Populate for split-origin dev setups, e.g. http://localhost:5173. */
  corsAllowedOrigins: readOriginAllowlist(),

  /** Session lifetime. Deliberately short; the UI re-authenticates on expiry. */
  sessionTtlSeconds: readInt('SESSION_TTL_SECONDS', 8 * 60 * 60),
  /** Grace window so an in-flight request does not die mid-write at expiry. */
  sessionGraceSeconds: readInt('SESSION_GRACE_SECONDS', 60),

  loginRateLimit: {
    max: readInt('LOGIN_RATE_LIMIT_MAX', 10),
    windowSeconds: readInt('LOGIN_RATE_LIMIT_WINDOW_SECONDS', 300),
  },
  globalRateLimit: {
    max: readInt('GLOBAL_RATE_LIMIT_MAX', 600),
    windowSeconds: readInt('GLOBAL_RATE_LIMIT_WINDOW_SECONDS', 60),
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
  rankAggregation: (process.env.RANK_AGGREGATION?.trim() || 'total') === 'normalized'
    ? ('normalized' as const)
    : ('total' as const),
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
} as const;

export type AppConfig = typeof config;

/**
 * Validate everything the HTTP server needs. Called once at boot so a
 * misconfigured deployment fails loudly instead of silently using a default.
 */
export function assertServerConfig(): void {
  databaseUrl();
  jwtSecret();
  if (config.rankThresholds.meister <= config.rankThresholds.geselle) {
    throw new ConfigError(
      `RANK_THRESHOLD_MEISTER (${config.rankThresholds.meister}) must be greater than ` +
        `RANK_THRESHOLD_GESELLE (${config.rankThresholds.geselle}).`,
    );
  }
}