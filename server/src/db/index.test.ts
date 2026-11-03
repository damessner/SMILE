import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const poolConfigs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('pg', () => ({
  default: {
    Pool: class TestPool {
      constructor(options: Record<string, unknown>) {
        poolConfigs.push(options);
      }

      async end(): Promise<void> {}
    },
  },
}));

describe('integration database pool binding', () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    process.env.NODE_ENV = 'test';
    process.env.SMILE_ENV_FILE = 'no-such-env-file-for-pool-binding-test';
    process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused_db';
    poolConfigs.length = 0;
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in savedEnv)) delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it('uses explicit validated fields instead of DATABASE_URL for the migration pool', async () => {
    const db = await import('./index.js');
    db.configureIntegrationTestPool({
      host: '127.0.0.1',
      port: 5544,
      database: 'smile_db_test',
      user: 'smile_test',
      password: 'synthetic-password',
      ssl: false,
      options: '-c search_path=public',
      connectionTimeoutMillis: 2000,
    });

    db.getPool();

    expect(poolConfigs).toHaveLength(1);
    expect(poolConfigs[0]).toMatchObject({
      host: '127.0.0.1',
      port: 5544,
      database: 'smile_db_test',
      user: 'smile_test',
      ssl: false,
      options: '-c search_path=public',
    });
    expect(poolConfigs[0].connectionString).toBeUndefined();
  });
});
