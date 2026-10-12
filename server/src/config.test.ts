import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'os';
import path from 'path';

/**
 * The server used to fall back to a hardcoded JWT secret that was identical to the
 * value committed in .env, so removing .env did not protect anything. These tests pin
 * the behaviour that makes that class of mistake fail loudly instead.
 */
describe('config secret validation', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Point config.ts at a file that does not exist, so dotenv does not repopulate the
    // variables we are about to delete from the developer's real .env values.
    process.env.SMILE_ENV_FILE = path.join(os.tmpdir(), 'smile-test-no-such-env-file');
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    delete process.env.SMILE_ENV_FILE;
    vi.resetModules();
  });

  async function loadConfig() {
    return import('./config.js');
  }

  it('rejects a missing JWT_SECRET instead of using a default', async () => {
    delete process.env.JWT_SECRET;
    const { jwtSecret, ConfigError } = await loadConfig();
    expect(() => jwtSecret()).toThrow(ConfigError);
    expect(() => jwtSecret()).toThrow(/JWT_SECRET is not set/);
  });

  it('rejects the previously leaked secret', async () => {
    process.env.JWT_SECRET = 'smile_super_secret_jwt_key_2026_telfs_weissenbach!';
    const { jwtSecret, ConfigError } = await loadConfig();
    expect(() => jwtSecret()).toThrow(ConfigError);
    expect(() => jwtSecret()).toThrow(/compromised/);
  });

  it('rejects a too-short secret', async () => {
    process.env.JWT_SECRET = 'short';
    const { jwtSecret } = await loadConfig();
    expect(() => jwtSecret()).toThrow(/at least 32 characters/);
  });

  it('accepts a strong random secret', async () => {
    process.env.JWT_SECRET = 'a'.repeat(48);
    const { jwtSecret } = await loadConfig();
    expect(jwtSecret()).toBe('a'.repeat(48));
  });

  it('rejects a missing DATABASE_URL rather than defaulting to the live database', async () => {
    delete process.env.DATABASE_URL;
    const { databaseUrl, ConfigError } = await loadConfig();
    expect(() => databaseUrl()).toThrow(ConfigError);
    expect(() => databaseUrl()).toThrow(/DATABASE_URL is not set/);
  });

  it('rejects the previously leaked database password inside a URL', async () => {
    process.env.DATABASE_URL =
      'postgres://smile_user:smile_secure_pass_2026!@192.168.178.54:5432/smile_db';
    const { databaseUrl, ConfigError } = await loadConfig();
    expect(() => databaseUrl()).toThrow(ConfigError);
    expect(() => databaseUrl()).toThrow(/compromised/);
  });

  it('rejects the leaked password when it is percent-encoded in the URL', async () => {
    // "!" survives url-encoding untouched, so an operator (or a well-meaning deploy
    // script) could smuggle the compromised password past a plain substring check.
    process.env.DATABASE_URL =
      'postgres://smile_user:smile_secure_pass_2026%21@192.168.178.54:5432/smile_db';
    const { databaseUrl, ConfigError } = await loadConfig();
    expect(() => databaseUrl()).toThrow(ConfigError);
    expect(() => databaseUrl()).toThrow(/compromised/);
  });

  it('still rejects a leaked secret that appears outside the password field', async () => {
    // Guards against the decode-then-compare fix weakening the original raw scan.
    process.env.DATABASE_URL =
      'postgres://smile:brandnew@db.internal:5432/smile_db?note=smile_secure_pass_2026!';
    const { databaseUrl, ConfigError } = await loadConfig();
    expect(() => databaseUrl()).toThrow(ConfigError);
    expect(() => databaseUrl()).toThrow(/compromised/);
  });

  it('accepts a percent-encoded password that is not a known leaked secret', async () => {
    process.env.DATABASE_URL = 'postgres://smile:brand%21new@db.internal:5432/smile_db';
    const { databaseUrl } = await loadConfig();
    expect(databaseUrl()).toBe('postgres://smile:brand%21new@db.internal:5432/smile_db');
  });

  it('accepts a normal connection string', async () => {
    process.env.DATABASE_URL = 'postgres://smile:brandnew@db.internal:5432/smile_db';
    const { databaseUrl } = await loadConfig();
    expect(databaseUrl()).toContain('brandnew');
  });

  it('refuses the shared bootstrap password as a secret value', async () => {
    delete process.env.INITIAL_USER_PASSWORD;
    const { initialBootstrapPassword, ConfigError } = await loadConfig();
    expect(() => initialBootstrapPassword()).toThrow(ConfigError);
  });
});

describe('strict config parsing', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    // Never let dotenv read the developer's local .env from a parser unit test.
    process.env.SMILE_ENV_FILE = path.join(os.tmpdir(), 'smile-test-no-such-env-file');
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...savedEnv };
    vi.resetModules();
  });

  it('readInt rejects partial and decimal forms and non-integers', async () => {
    const { readInt, ConfigError } = await import('./config.js');
    process.env.TEST_INT = '12abc';
    expect(() => readInt('TEST_INT', 0)).toThrow(ConfigError);
    expect(() => readInt('TEST_INT', 0)).toThrow('Environment variable TEST_INT must be an integer.');

    process.env.TEST_INT = '12.5';
    expect(() => readInt('TEST_INT', 0)).toThrow(ConfigError);

    process.env.TEST_INT = 'not-a-number';
    expect(() => readInt('TEST_INT', 0)).toThrow(ConfigError);

    process.env.TEST_INT = '42';
    expect(readInt('TEST_INT', 0)).toBe(42);

    process.env.TEST_INT = '-5';
    expect(readInt('TEST_INT', 0)).toBe(-5);

    delete process.env.TEST_INT;
    expect(readInt('TEST_INT', 100)).toBe(100);
  });

  it('readBool rejects typos and non-boolean strings', async () => {
    const { readBool, ConfigError } = await import('./config.js');
    process.env.TEST_BOOL = 'tru';
    expect(() => readBool('TEST_BOOL', false)).toThrow(ConfigError);
    expect(() => readBool('TEST_BOOL', false)).toThrow(
      'Environment variable TEST_BOOL must be a boolean (true/false, 1/0, yes/no, on/off).',
    );

    process.env.TEST_BOOL = 'falze';
    expect(() => readBool('TEST_BOOL', false)).toThrow(ConfigError);

    process.env.TEST_BOOL = 'true';
    expect(readBool('TEST_BOOL', false)).toBe(true);

    process.env.TEST_BOOL = 'false';
    expect(readBool('TEST_BOOL', true)).toBe(false);

    process.env.TEST_BOOL = '1';
    expect(readBool('TEST_BOOL', false)).toBe(true);

    process.env.TEST_BOOL = '0';
    expect(readBool('TEST_BOOL', true)).toBe(false);

    delete process.env.TEST_BOOL;
    expect(readBool('TEST_BOOL', true)).toBe(true);
  });

  it('readTimestamp validates ISO-8601 formatting', async () => {
    const { readTimestamp, ConfigError } = await import('./config.js');
    process.env.TEST_TS = '2026-10-30T21:59:59.000Z';
    expect(readTimestamp('TEST_TS', '').toISOString()).toBe('2026-10-30T21:59:59.000Z');

    process.env.TEST_TS = '2026-10-30T22:59:59+01:00';
    expect(readTimestamp('TEST_TS', '').toISOString()).toBe('2026-10-30T21:59:59.000Z');

    process.env.TEST_TS = 'invalid-date-string';
    expect(() => readTimestamp('TEST_TS', '')).toThrow(ConfigError);
    expect(() => readTimestamp('TEST_TS', '')).toThrow(
      'Environment variable TEST_TS must be an ISO-8601 timestamp.',
    );

    process.env.TEST_TS = '30.10.2026';
    expect(() => readTimestamp('TEST_TS', '')).toThrow(ConfigError);

    process.env.TEST_TS = '2026-10-30T21:59:59';
    expect(() => readTimestamp('TEST_TS', '')).toThrow(ConfigError);

    process.env.TEST_TS = '2026-02-30T21:59:59Z';
    expect(() => readTimestamp('TEST_TS', '')).toThrow(ConfigError);

    process.env.TEST_TS = '2026-10-30T21:59:59+25:00';
    expect(() => readTimestamp('TEST_TS', '')).toThrow(ConfigError);
  });

  it('readRankAggregation rejects invalid rank modes', async () => {
    const { readRankAggregation, ConfigError } = await import('./config.js');
    process.env.RANK_AGGREGATION = 'total';
    expect(readRankAggregation('RANK_AGGREGATION')).toBe('total');

    process.env.RANK_AGGREGATION = 'normalized';
    expect(readRankAggregation('RANK_AGGREGATION')).toBe('normalized');

    process.env.RANK_AGGREGATION = 'unbounded';
    expect(() => readRankAggregation('RANK_AGGREGATION')).toThrow(ConfigError);
    expect(() => readRankAggregation('RANK_AGGREGATION')).toThrow(
      "Environment variable RANK_AGGREGATION must be 'total' or 'normalized'.",
    );
  });

  it.each([
    ['PORT', '0'],
    ['LOGIN_RATE_LIMIT_MAX', '0'],
    ['LOGIN_RATE_LIMIT_WINDOW_SECONDS', '-1'],
    ['GLOBAL_RATE_LIMIT_MAX', '0'],
    ['GLOBAL_RATE_LIMIT_WINDOW_SECONDS', '0'],
    ['SESSION_TTL_SECONDS', '0'],
    ['BODY_LIMIT_BYTES', '0'],
    ['WS_ROOM_MAX_CLIENTS', '0'],
    ['WS_SOFT_LOCK_TTL_MS', '0'],
    ['WS_RATE_LIMIT_PER_SECOND', '0'],
    ['WS_RATE_LIMIT_BURST', '0'],
    ['YELLOW_CARD_ALERT_THRESHOLD', '0'],
    ['YELLOW_CARD_ALERT_WINDOW_DAYS', '0'],
    ['ESCALATION_STEP', '0'],
    ['RUBRIC_ITEM_COUNT', '0'],
    ['RANK_THRESHOLD_GESELLE', '-1'],
  ])('assertServerConfig rejects out-of-range %s', async (name, value) => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-to-pass-validation-1234';
    process.env.DATABASE_URL = 'postgres://test:test@127.0.0.1:1/smile_db_test';
    process.env[name] = value;
    vi.resetModules();
    const { assertServerConfig, ConfigError } = await import('./config.js');
    expect(() => assertServerConfig()).toThrow(ConfigError);
  });
});

describe('insecureConfigWarnings', () => {
  it('warns when the session cookie travels without the Secure flag', async () => {
    const { insecureConfigWarnings } = await import('./config.js');
    const warnings = insecureConfigWarnings({ cookieSecure: false });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('COOKIE_SECURE');
  });

  it('returns no warnings when the cookie is secure', async () => {
    const { insecureConfigWarnings } = await import('./config.js');
    expect(insecureConfigWarnings({ cookieSecure: true })).toEqual([]);
  });
});
