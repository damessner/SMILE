-- Guard retroactive time-out duplicate check atomically in PostgreSQL.
CREATE UNIQUE INDEX IF NOT EXISTS "timeout_incidents_retroactive_slot_uidx"
  ON "timeout_incidents" ("pupil_id", "class_id", "kind", "sent_at")
  WHERE "retroactive" = true;
