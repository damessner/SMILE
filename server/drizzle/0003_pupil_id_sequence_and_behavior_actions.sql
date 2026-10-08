-- Bring the pupil id sequence and the behaviour-action table under migration control.
--
-- Why this exists:
--
-- 1. `pupil_id_seq` was declared in server/src/db/schema.ts and allocated by
--    POST /api/pupils (`nextval('pupil_id_seq')`), but no committed migration ever
--    created it. Databases only have it if somebody ran `drizzle-kit push` by hand.
--    A database built from server/drizzle/*.sql alone therefore fails every pupil
--    creation with `relation "pupil_id_seq" does not exist`.
--
-- 2. `pupil_behavior_actions` was created by hand-written DDL inside runMigrations()
--    after the Drizzle migrator had already run. That is invisible to
--    `drizzle-kit generate`, absent from the migration history, and — worse — it
--    masked finding (1) from the integration suite, because that suite builds its
--    schema through runMigrations().
--
-- Both statements are idempotent. An existing deployment that already has either
-- object (created by the old runtime DDL or by an ad-hoc push) keeps it untouched;
-- this migration only fills in what is missing.
--
-- ID RANGE: pupil ids start at 9,000,000 so they can never collide with a WebUntis
-- import, matching the reserved block that migration 0002 uses for administrator
-- teacher records. No setval is needed here: starting at 9,000,000 is already above
-- every id a legacy roster holds, so the first nextval cannot collide. seed.ts still
-- performs its own setval to keep the value in step after a reseed.

CREATE SEQUENCE IF NOT EXISTS pupil_id_seq
  AS INTEGER
  START WITH 9000000
  INCREMENT BY 1
  MINVALUE 9000000;

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