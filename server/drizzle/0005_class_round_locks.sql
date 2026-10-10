-- Class-scoped conference locks.
--
-- Locks evaluation mutations for a specific class and observation round,
-- while leaving other classes writable and conference decisions available.

CREATE TABLE IF NOT EXISTS class_round_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id UUID NOT NULL REFERENCES observation_rounds(id),
  class_id INTEGER NOT NULL REFERENCES school_classes(id),
  is_locked BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
  CONSTRAINT class_round_locks_round_class_uidx UNIQUE (round_id, class_id)
);

CREATE INDEX IF NOT EXISTS class_round_locks_class_round_idx
  ON class_round_locks (class_id, round_id);
