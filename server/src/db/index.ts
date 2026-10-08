import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';
import * as schema from './schema.js';
import { databaseUrl } from '../config.js';

/**
 * A single connection string, resolved from DATABASE_URL with no fallback.
 *
 * The previous version embedded the production password as a default, so a missing
 * .env silently connected to (and wrote to) the live school database.
 *
 * The pool is created lazily on first use. Importing this module therefore does not
 * require a valid DATABASE_URL, which lets pure helpers (guards, ranking) be unit
 * tested without a database, and defers the credential check to the first query.
 */
let poolInstance: pg.Pool | null = null;
let integrationTestPoolConfig: pg.PoolConfig | null = null;

/** Configure the isolated integration pool before the first connection is acquired. */
export function configureIntegrationTestPool(poolConfig: pg.PoolConfig): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('An integration test pool can only be configured under NODE_ENV=test.');
  }
  if (poolInstance) {
    throw new Error('The database pool has already been initialized.');
  }
  const host = typeof poolConfig.host === 'string' ? poolConfig.host.toLowerCase() : '';
  if (
    poolConfig.database !== 'smile_db_test' ||
    !['127.0.0.1', '::1'].includes(host) ||
    !Number.isInteger(poolConfig.port) || Number(poolConfig.port) < 1 || Number(poolConfig.port) > 65_535 ||
    !poolConfig.user ||
    poolConfig.ssl !== false ||
    poolConfig.options !== '-c search_path=public' ||
    poolConfig.connectionString !== undefined
  ) {
    throw new Error('Integration database pool requires explicit loopback host, test database, and role fields.');
  }
  integrationTestPoolConfig = { ...poolConfig };
}

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new pg.Pool({
      max: 20,
      idleTimeoutMillis: 30_000,
      // Bound how long a request waits for a connection before erroring out.
      connectionTimeoutMillis: 10_000,
      ...(integrationTestPoolConfig ?? { connectionString: databaseUrl() }),
    });
  }
  return poolInstance;
}

/** Drizzle handle. Proxies to the lazy pool so import order does not matter. */
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const real = getPool();
    const value = drizzle(real, { schema });
    return (value as any)[prop];
  },
});

/**
 * Path to the generated migration folder. Resolved relative to this module so it
 * works both from `src/` (tsx) and `dist/` (compiled), i.e. `server/drizzle`.
 */
const migrationsFolder = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../drizzle',
);

/** Run pending Drizzle migrations. Safe to call on every boot. */
export async function runMigrations(): Promise<void> {
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(getPool(), { schema }), { migrationsFolder });

  // Ensure table pupil_behavior_actions exists
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS pupil_behavior_actions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      pupil_id INTEGER NOT NULL REFERENCES pupils(id),
      stage_level INTEGER NOT NULL,
      stage_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      action_date TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
      teacher_id INTEGER NOT NULL REFERENCES teachers(id),
      notes TEXT,
      created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS pupil_behavior_actions_pupil_stage_idx
      ON pupil_behavior_actions (pupil_id, stage_level);
    CREATE INDEX IF NOT EXISTS pupil_behavior_actions_date_idx
      ON pupil_behavior_actions (action_date);
  `);
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}
