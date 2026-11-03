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
let drizzleInstance: ReturnType<typeof drizzle> | null = null;
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    if (!drizzleInstance) {
      drizzleInstance = drizzle(getPool(), { schema });
    }
    return Reflect.get(drizzleInstance, prop);
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

/**
 * Run pending Drizzle migrations. Safe to call on every boot.
 *
 * Schema ownership lives in `server/drizzle/*.sql` and nowhere else. This function used
 * to follow the migrator with hand-written `CREATE TABLE IF NOT EXISTS
 * pupil_behavior_actions` DDL, which put a real table outside the migration history and,
 * because the integration suite builds its schema through this function, silently masked
 * the missing `pupil_id_seq` sequence. Both objects are now created by migration
 * `0003_pupil_id_sequence_and_behavior_actions`.
 */
export async function runMigrations(): Promise<void> {
  const { migrate } = await import('drizzle-orm/node-postgres/migrator');
  await migrate(drizzle(getPool(), { schema }), { migrationsFolder });
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
    drizzleInstance = null;
  }
}
