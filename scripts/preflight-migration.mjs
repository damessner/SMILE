// READ-ONLY pre-flight check against the live database.
// The new code adds UNIQUE indexes. If existing data violates them, the
// migration aborts partway and the service will not start.
import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.PROBE_URL,
  max: 1,
  connectionTimeoutMillis: 8000,
});

const CHECKS = [
  ['evaluations (round,pupil,class,subject)', `
     SELECT count(*) AS dup_groups FROM (
       SELECT 1 FROM evaluations
        GROUP BY round_id, pupil_id, class_id, subject_code
       HAVING count(*) > 1) t`],
  ['evaluation_items (evaluation,item_key)', `
     SELECT count(*) AS dup_groups FROM (
       SELECT 1 FROM evaluation_items
        GROUP BY evaluation_id, item_key
       HAVING count(*) > 1) t`],
  ['final_ranks (round,pupil)', `
     SELECT count(*) AS dup_groups FROM (
       SELECT 1 FROM final_ranks
        GROUP BY round_id, pupil_id
       HAVING count(*) > 1) t`],
  ['timeout_escalations (pupil,milestone)', `
     SELECT count(*) AS dup_groups FROM (
       SELECT 1 FROM timeout_escalations
        GROUP BY pupil_id, milestone_count
       HAVING count(*) > 1) t`],
];

try {
  const applied = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename`,
  );
  console.log('existing tables:', applied.rows.map((r) => r.tablename).join(', '));

  const done = await pool.query(
    `SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename='__drizzle_migrations'`,
  );
  console.log('\nmigration history table present:', done.rows.length > 0
    ? 'YES (migrations already tracked)'
    : 'NO (no migrations have ever run)');

  console.log('\n--- duplicate check for new UNIQUE indexes ---');
  let blocking = 0;
  for (const [label, sql] of CHECKS) {
    try {
      const r = await pool.query(sql);
      const n = r.rows[0].dup_groups;
      if (n > 0) blocking++;
      console.log(`  ${n === 0 ? 'OK   ' : 'BLOCK'} ${label}: ${n} duplicate group(s)`);
    } catch (e) {
      console.log(`  SKIP  ${label}: ${e.code || e.message}`);
    }
  }

  const missing = await pool.query(
    `SELECT t AS missing FROM unnest(ARRAY[
       'password_resets','timeout_incidents','timeout_escalations','timetable_lessons'
     ]) t WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema='public' AND table_name = t)`,
  );
  console.log('\ntables the migration must create:',
    missing.rows.length ? missing.rows.map((r) => r.missing).join(', ') : 'none');

  const cols = await pool.query(
    `SELECT c AS missing FROM unnest(ARRAY[
       'users.must_change_password','evaluations.is_submitted',
       'final_ranks.votes_yes','final_ranks.total_voters'
     ]) c WHERE NOT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND (table_name||'.'||column_name) = c)`,
  );
  console.log('columns the migration must add:',
    cols.rows.length ? cols.rows.map((r) => r.missing).join(', ') : 'none');

  console.log(`\nVERDICT: ${blocking === 0 ? 'migration can proceed' : 'MIGRATION WILL ABORT — duplicates present'}`);
} catch (err) {
  console.error('pre-flight failed:', err.message);
} finally {
  await pool.end();
}