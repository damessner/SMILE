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

export function getPool(): pg.Pool {
  if (!poolInstance) {
    poolInstance = new pg.Pool({
      connectionString: databaseUrl(),
      max: 20,
      idleTimeoutMillis: 30_000,
      // Bound how long a request waits for a connection before erroring out.
      connectionTimeoutMillis: 10_000,
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
}

export async function closePool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
    poolInstance = null;
  }
}