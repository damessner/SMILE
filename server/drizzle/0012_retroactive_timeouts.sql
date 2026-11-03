-- Retroactive time-outs: keep the original lesson time separate from the entry time.
ALTER TABLE "timeout_incidents"
  ADD COLUMN IF NOT EXISTS "recorded_at" timestamp;
UPDATE "timeout_incidents" SET "recorded_at" = "sent_at" WHERE "recorded_at" IS NULL;
ALTER TABLE "timeout_incidents"
  ALTER COLUMN "recorded_at" SET DEFAULT now(),
  ALTER COLUMN "recorded_at" SET NOT NULL;

ALTER TABLE "timeout_incidents"
  ADD COLUMN IF NOT EXISTS "retroactive" boolean NOT NULL DEFAULT false;
