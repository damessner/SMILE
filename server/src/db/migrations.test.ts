import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Schema must be owned by the committed migrations, and only by them.
 *
 * Why this file exists: `POST /api/pupils` allocates ids with `nextval('pupil_id_seq')`,
 * but that sequence was declared in schema.ts and never created by any migration — only
 * present on databases where somebody had once run `drizzle-kit push`. Meanwhile
 * `pupil_behavior_actions` was created by hand-written DDL inside `runMigrations()`,
 * *after* the Drizzle migrator had run. Because the PostgreSQL integration suite builds
 * its schema by calling `runMigrations()`, that out-of-band DDL hid the missing sequence
 * from CI: the suite went green against a schema the migrations could not reproduce.
 *
 * These are structural assertions over the migration files, not behaviour tests. They
 * cannot prove a migration executes; they prove the far more common failure — that an
 * object the runtime depends on is absent from migration history — cannot come back
 * unnoticed. `db:generate` and the integration suite cover the rest.
 */

// Same anchor db/index.ts uses to locate the migration folder, so the test cannot
// drift away from where the application actually looks.
const here = path.dirname(fileURLToPath(import.meta.url));
const drizzleDir = path.resolve(here, '../../drizzle');
const serverRoot = path.resolve(here, '../..');
const schemaPath = path.join(serverRoot, 'src', 'db', 'schema.ts');

const migrationSql = readdirSync(drizzleDir)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(path.join(drizzleDir, f), 'utf-8'))
  .join('\n');

const schemaSource = readFileSync(schemaPath, 'utf-8');

/** `pgTable('name', ...)` / `pgSequence('name', ...)` as declared in schema.ts. */
function declaredObjects(kind: 'pgTable' | 'pgSequence'): string[] {
  return [...schemaSource.matchAll(new RegExp(`${kind}\\(\\s*'([a-z0-9_]+)'`, 'g'))].map((m) => m[1]!);
}

const declaredTables = declaredObjects('pgTable');
const declaredSequences = declaredObjects('pgSequence');

describe('schema is owned by the committed migrations', () => {
  it('finds the schema and the migration folder (guard against a silent no-op)', () => {
    expect(declaredTables.length).toBeGreaterThan(10);
    expect(declaredSequences.length).toBeGreaterThan(0);
    expect(migrationSql.length).toBeGreaterThan(0);
  });

  it.each(declaredTables)('migration history creates table %s', (table) => {
    const created = new RegExp(`CREATE\\s+TABLE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?"?${table}"?\\b`, 'i');
    expect(created.test(migrationSql)).toBe(true);
  });

  it.each(declaredSequences)('migration history creates sequence %s', (sequence) => {
    const created = new RegExp(`CREATE\\s+SEQUENCE\\s+(IF\\s+NOT\\s+EXISTS\\s+)?"?${sequence}"?\\b`, 'i');
    expect(created.test(migrationSql)).toBe(true);
  });

  it('runMigrations() issues no DDL of its own', () => {
    const dbIndex = readFileSync(path.join(serverRoot, 'src', 'db', 'index.ts'), 'utf-8');
    // Slice the function body out of the module: hand-written schema statements here are
    // invisible to drizzle-kit and outside the migration history.
    const start = dbIndex.indexOf('export async function runMigrations');
    expect(start).toBeGreaterThan(-1);
    const body = dbIndex.slice(start, dbIndex.indexOf('\n}', start));
    expect(body).not.toMatch(/CREATE\s+(TABLE|SEQUENCE|INDEX|ALTER)/i);
  });

  it('every migration journal entry points at a file that exists', () => {
    const journal = JSON.parse(readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf-8'));
    expect(Array.isArray(journal.entries)).toBe(true);
    expect(journal.entries.length).toBeGreaterThan(0);
    for (const entry of journal.entries) {
      expect(readdirSync(drizzleDir)).toContain(`${entry.tag}.sql`);
    }
  });

  it('migration history creates class_round_locks with unique (round_id, class_id)', () => {
    expect(migrationSql).toMatch(/CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?"?class_round_locks"?/i);
    expect(migrationSql).toMatch(/UNIQUE\s*\(\s*round_id\s*,\s*class_id\s*\)/i);
  });
});