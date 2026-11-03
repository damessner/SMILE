-- Add automatic timeout release (release at the bell).
--
-- Stamps an expiry on timeout_incidents when a pupil is sent to Lernwerkstatt.
-- The sweeper task and GET /api/timeouts/active use this to release pupils at the end of the period.

ALTER TABLE timeout_incidents ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP WITHOUT TIME ZONE;

CREATE INDEX IF NOT EXISTS timeout_incidents_expires_at_active_idx
  ON timeout_incidents (expires_at)
  WHERE status = 'active';
