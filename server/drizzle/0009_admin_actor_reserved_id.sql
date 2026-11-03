-- Move administrator placeholder teacher rows into the reserved 9,000,000+ range.
--
-- Migration 0002 used COALESCE(MAX(id), 9000000) + 1 over the *real* personId
-- range, so an existing database received ADM-315 instead of ADM-9000000. A later
-- WebUntis import can legitimately issue personId 315, and updating that row would
-- silently re-link the administrator's ratings to a real colleague.
--
-- This is deliberately idempotent: on a fresh database 0002 now creates the row in
-- the reserved range and this block finds nothing to move.

DO $$
DECLARE
  old_row RECORD;
  new_id INTEGER;
  fk RECORD;
  teacher_id_attnum SMALLINT;
BEGIN
  SELECT attnum INTO teacher_id_attnum
    FROM pg_attribute
   WHERE attrelid = 'teachers'::regclass
     AND attname = 'id';

  FOR old_row IN
    SELECT id, full_name
      FROM teachers
     WHERE id < 9000000
       AND active = false
       AND short_name LIKE 'ADM-%'
       AND full_name LIKE 'Administratorkonto %'
     ORDER BY id
  LOOP
    SELECT COALESCE(MAX(id), 8999999) + 1
      INTO new_id
      FROM teachers
     WHERE id >= 9000000;

    -- The new row must exist before the foreign keys are repointed; PostgreSQL
    -- checks each FK statement immediately.
    INSERT INTO teachers (id, short_name, full_name, active)
    VALUES (new_id, 'ADM-' || new_id, old_row.full_name, false);

    FOR fk IN
      SELECT c.conrelid::regclass AS table_name, a.attname AS column_name
        FROM pg_constraint c
        JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid
         AND a.attnum = k.attnum
       WHERE c.contype = 'f'
         AND c.confrelid = 'teachers'::regclass
         AND c.confkey = ARRAY[teacher_id_attnum]
    LOOP
      EXECUTE format(
        'UPDATE %s SET %I = $1 WHERE %I = $2',
        fk.table_name,
        fk.column_name,
        fk.column_name
      ) USING new_id, old_row.id;
    END LOOP;

    -- audit_logs.actor_id intentionally has no FK (it must survive teacher
    -- deletion), so it is not covered by the pg_constraint loop.
    UPDATE audit_logs SET actor_id = new_id WHERE actor_id = old_row.id;

    DELETE FROM teachers WHERE id = old_row.id;

    RAISE NOTICE 'Moved administrator placeholder teacher % to reserved id %',
      old_row.id, new_id;
  END LOOP;
END $$;
