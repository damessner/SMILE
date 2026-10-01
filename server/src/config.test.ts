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