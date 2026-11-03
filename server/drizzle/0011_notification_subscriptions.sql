-- Teacher-selectable e-mail subscriptions for cards, time-outs and weekly digests.
CREATE TABLE IF NOT EXISTS "notification_preferences" (
  "user_id" uuid PRIMARY KEY NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "email" text NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "notification_subscriptions" (
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "class_id" integer NOT NULL REFERENCES "school_classes"("id") ON DELETE CASCADE,
  "green" boolean DEFAULT false NOT NULL,
  "yellow" boolean DEFAULT false NOT NULL,
  "red" boolean DEFAULT false NOT NULL,
  "timeout" boolean DEFAULT false NOT NULL,
  "cooldown" boolean DEFAULT false NOT NULL,
  "weekly_digest" boolean DEFAULT false NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "notification_subscriptions_user_class_pk" PRIMARY KEY ("user_id", "class_id")
);

CREATE INDEX IF NOT EXISTS "notification_subscriptions_user_idx"
  ON "notification_subscriptions" ("user_id");
CREATE INDEX IF NOT EXISTS "notification_subscriptions_class_idx"
  ON "notification_subscriptions" ("class_id");

CREATE TABLE IF NOT EXISTS "notification_digest_log" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "class_id" integer NOT NULL REFERENCES "school_classes"("id") ON DELETE CASCADE,
  "week_start" text NOT NULL,
  "sent_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_digest_user_class_week_uidx"
  ON "notification_digest_log" ("user_id", "class_id", "week_start");
