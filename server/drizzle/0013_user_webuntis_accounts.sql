CREATE TABLE IF NOT EXISTS "user_webuntis_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"untis_username" text NOT NULL,
	"encrypted_secret" text NOT NULL,
	"secret_iv" text NOT NULL,
	"secret_auth_tag" text NOT NULL,
	"school" text NOT NULL,
	"server" text NOT NULL,
	"person_id" integer NOT NULL,
	"teacher_short" text NOT NULL,
	"auth_method" text DEFAULT 'password' NOT NULL,
	"last_verified_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_webuntis_accounts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_webuntis_accounts" ADD CONSTRAINT "user_webuntis_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_webuntis_accounts_user_idx" ON "user_webuntis_accounts" ("user_id");
