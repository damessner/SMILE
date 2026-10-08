-- Give every admin account a real teacher record so ratings it writes can be attributed.
--
-- Why: `evaluations.teacher_id` is NOT NULL REFERENCES teachers(id). An `admin` account is
-- not a teacher, so it had no valid id to write, and the pre-hardening code used the
-- sentinel 0 — a legal primary key that points at a phantom row. The write paths now fail
-- closed with SYSTEM_ACTOR_NOT_CONFIGURED instead, which is safe but blocks a legitimate
-- workflow (a principal correcting a rating).
--
-- This migration creates one inactive teacher row per admin account and links it. `active =
-- false` keeps these rows out of timetables, assignment pickers and staffing lists; they
-- exist solely to satisfy the foreign key and to record who actually entered a value.
--
-- Idempotent: re-running creates nothing new, and existing links are left alone.
--
-- ID RANGE: teachers.id is the WebUntis personId, so real ids are small and sparse.
-- 9000000 is used here because it is the base of the pupil_id_seq range, which is far
-- outside any personId a school timetable would issue, and because the preflight below
-- refuses to proceed if any of these ids is already taken.

DO $$
DECLARE
  admin_row RECORD;
  next_id INTEGER;
  taken BOOLEAN;
  created_count INTEGER := 0;
BEGIN
  -- Refuse to guess. If a real teacher already occupies a placeholder id, linking an admin
  -- to it would attribute their ratings to a colleague.
  SELECT EXISTS (SELECT 1 FROM teachers WHERE id >= 9000000) INTO taken;
  IF taken THEN
    RAISE EXCEPTION
      'Placeholder teacher id range 9000000+ is already in use. Inspect teachers.id >= 9000000 and choose a free range before applying this migration.';
  END IF;

  SELECT COALESCE(MAX(id), 9000000) + 1 INTO next_id FROM teachers WHERE id < 9000000;

  FOR admin_row IN
    SELECT id, username FROM users WHERE role = 'admin' AND teacher_id IS NULL
  LOOP
    INSERT INTO teachers (id, short_name, full_name, active)
    VALUES (next_id, 'ADM-' || next_id, 'Administratorkonto ' || admin_row.username, false);

    UPDATE users
    SET teacher_id = next_id
    WHERE id = admin_row.id;

    created_count := created_count + 1;
    next_id := next_id + 1;
  END LOOP;

  IF created_count > 0 THEN
    RAISE NOTICE 'Created % placeholder teacher record(s) for admin accounts.', created_count;
  END IF;
END $$;

-- The fabricated tallies are gone: a confirmation records the rank, who confirmed it and
-- when. The tally is derived at read time from the evaluations that were actually
-- submitted. Existing rows keep whatever was stored, but nothing reads these columns any
-- more, so no code path can present them as a real vote count.
--
-- The columns are left in place rather than dropped so this migration stays reversible;
-- dropping them is a separate cleanup once no deployment reads the old code.