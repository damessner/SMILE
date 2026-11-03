-- Distinguish a consequence-free Cool-Down from a disciplinary Time-Out.
-- Existing rows are real Time-Outs, so the default keeps their behaviour.
ALTER TABLE "timeout_incidents"
  ADD COLUMN IF NOT EXISTS "kind" text NOT NULL DEFAULT 'timeout';
