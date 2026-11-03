CREATE TABLE "assessment_rubrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"mode" text DEFAULT 'rubric_levels' NOT NULL,
	"grade_boundaries" jsonb,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"actor_id" integer,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"payload" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "behavior_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pupil_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"teacher_id" integer NOT NULL,
	"card_type" text NOT NULL,
	"note" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"revoked_by" integer
);
--> statement-breakpoint
CREATE TABLE "evaluation_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"evaluation_id" uuid NOT NULL,
	"criterion_id" uuid NOT NULL,
	"item_key" text NOT NULL,
	"rating" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_by_teacher_id" integer,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"pupil_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"subject_code" text NOT NULL,
	"teacher_id" integer NOT NULL,
	"proposed_status" text,
	"next_step" text,
	"comment" text,
	"is_submitted" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp,
	"submitted_by_teacher_id" integer,
	"is_locked" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"superseded_by" uuid
);
--> statement-breakpoint
CREATE TABLE "final_ranks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"round_id" uuid NOT NULL,
	"pupil_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"rank" text NOT NULL,
	"votes_yes" integer,
	"votes_no" integer DEFAULT 0,
	"total_voters" integer,
	"algorithm_trace" jsonb,
	"confirmed_at" timestamp,
	"confirmed_by" integer,
	"overridden_from" text,
	"override_reason" text
);
--> statement-breakpoint
CREATE TABLE "observation_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"is_locked" boolean DEFAULT false NOT NULL,
	"starts_on" timestamp,
	"ends_on" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "password_resets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"requested_by" integer,
	"requested_at" timestamp DEFAULT now() NOT NULL,
	"completed_at" timestamp,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "pupils" (
	"id" integer PRIMARY KEY NOT NULL,
	"class_id" integer NOT NULL,
	"full_name" text NOT NULL,
	"is_archived" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rubric_criteria" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"rubric_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weight_percentage" numeric(5, 2),
	"position" integer NOT NULL,
	"items" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "school_classes" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"grade" integer NOT NULL,
	"head_teacher_1" text,
	"head_teacher_2" text,
	CONSTRAINT "school_classes_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "teachers" (
	"id" integer PRIMARY KEY NOT NULL,
	"short_name" text NOT NULL,
	"full_name" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teaching_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"teacher_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"subject_code" text NOT NULL,
	"subject_name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "timeout_escalations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pupil_id" integer NOT NULL,
	"milestone_count" integer NOT NULL,
	"handled_by" integer NOT NULL,
	"handled_at" timestamp DEFAULT now() NOT NULL,
	"notes" text
);
--> statement-breakpoint
CREATE TABLE "timeout_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pupil_id" integer NOT NULL,
	"class_id" integer NOT NULL,
	"sent_by_teacher_id" integer NOT NULL,
	"sent_at" timestamp DEFAULT now() NOT NULL,
	"task_assignment" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"resolved_at" timestamp,
	"resolved_by" integer,
	"resolution_note" text,
	"red_card_id" uuid
);
--> statement-breakpoint
CREATE TABLE "timetable_lessons" (
	"id" serial PRIMARY KEY NOT NULL,
	"lesson_id" integer,
	"class_id" integer NOT NULL,
	"class_name" text NOT NULL,
	"teacher_id" integer NOT NULL,
	"teacher_short" text NOT NULL,
	"subject_code" text NOT NULL,
	"subject_name" text NOT NULL,
	"room" text,
	"day_of_week" integer NOT NULL,
	"period" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" text DEFAULT 'teacher' NOT NULL,
	"teacher_id" integer,
	"pupil_id" integer,
	"must_change_password" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_username_unique" UNIQUE("username")
);
--> statement-breakpoint
ALTER TABLE "behavior_cards" ADD CONSTRAINT "behavior_cards_pupil_id_pupils_id_fk" FOREIGN KEY ("pupil_id") REFERENCES "public"."pupils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavior_cards" ADD CONSTRAINT "behavior_cards_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavior_cards" ADD CONSTRAINT "behavior_cards_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "behavior_cards" ADD CONSTRAINT "behavior_cards_revoked_by_teachers_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_evaluation_id_evaluations_id_fk" FOREIGN KEY ("evaluation_id") REFERENCES "public"."evaluations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_criterion_id_rubric_criteria_id_fk" FOREIGN KEY ("criterion_id") REFERENCES "public"."rubric_criteria"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_updated_by_teacher_id_teachers_id_fk" FOREIGN KEY ("updated_by_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_round_id_observation_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."observation_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_pupil_id_pupils_id_fk" FOREIGN KEY ("pupil_id") REFERENCES "public"."pupils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_submitted_by_teacher_id_teachers_id_fk" FOREIGN KEY ("submitted_by_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_ranks" ADD CONSTRAINT "final_ranks_round_id_observation_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."observation_rounds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_ranks" ADD CONSTRAINT "final_ranks_pupil_id_pupils_id_fk" FOREIGN KEY ("pupil_id") REFERENCES "public"."pupils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_ranks" ADD CONSTRAINT "final_ranks_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "final_ranks" ADD CONSTRAINT "final_ranks_confirmed_by_teachers_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_resets" ADD CONSTRAINT "password_resets_requested_by_teachers_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pupils" ADD CONSTRAINT "pupils_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rubric_criteria" ADD CONSTRAINT "rubric_criteria_rubric_id_assessment_rubrics_id_fk" FOREIGN KEY ("rubric_id") REFERENCES "public"."assessment_rubrics"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teaching_assignments" ADD CONSTRAINT "teaching_assignments_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeout_escalations" ADD CONSTRAINT "timeout_escalations_pupil_id_pupils_id_fk" FOREIGN KEY ("pupil_id") REFERENCES "public"."pupils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeout_escalations" ADD CONSTRAINT "timeout_escalations_handled_by_teachers_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeout_incidents" ADD CONSTRAINT "timeout_incidents_pupil_id_pupils_id_fk" FOREIGN KEY ("pupil_id") REFERENCES "public"."pupils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeout_incidents" ADD CONSTRAINT "timeout_incidents_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeout_incidents" ADD CONSTRAINT "timeout_incidents_sent_by_teacher_id_teachers_id_fk" FOREIGN KEY ("sent_by_teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeout_incidents" ADD CONSTRAINT "timeout_incidents_resolved_by_teachers_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeout_incidents" ADD CONSTRAINT "timeout_incidents_red_card_id_behavior_cards_id_fk" FOREIGN KEY ("red_card_id") REFERENCES "public"."behavior_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_lessons" ADD CONSTRAINT "timetable_lessons_class_id_school_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."school_classes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timetable_lessons" ADD CONSTRAINT "timetable_lessons_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_teacher_id_teachers_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."teachers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_pupil_id_pupils_id_fk" FOREIGN KEY ("pupil_id") REFERENCES "public"."pupils"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "behavior_cards_pupil_created_idx" ON "behavior_cards" USING btree ("pupil_id","created_at");--> statement-breakpoint
CREATE INDEX "behavior_cards_class_active_idx" ON "behavior_cards" USING btree ("class_id","revoked_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluation_items_evaluation_item_uidx" ON "evaluation_items" USING btree ("evaluation_id","item_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evaluations_round_pupil_class_subject_uidx" ON "evaluations" USING btree ("round_id","pupil_id","class_id","subject_code");--> statement-breakpoint
CREATE INDEX "evaluations_class_round_idx" ON "evaluations" USING btree ("class_id","round_id");--> statement-breakpoint
CREATE UNIQUE INDEX "final_ranks_round_pupil_uidx" ON "final_ranks" USING btree ("round_id","pupil_id");--> statement-breakpoint
CREATE INDEX "final_ranks_class_round_idx" ON "final_ranks" USING btree ("class_id","round_id");--> statement-breakpoint
CREATE INDEX "teaching_assignments_teacher_class_idx" ON "teaching_assignments" USING btree ("teacher_id","class_id");--> statement-breakpoint
CREATE INDEX "teaching_assignments_class_idx" ON "teaching_assignments" USING btree ("class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "timeout_escalations_pupil_milestone_uidx" ON "timeout_escalations" USING btree ("pupil_id","milestone_count");--> statement-breakpoint
CREATE INDEX "timeout_incidents_pupil_idx" ON "timeout_incidents" USING btree ("pupil_id");--> statement-breakpoint
CREATE INDEX "timeout_incidents_status_sent_idx" ON "timeout_incidents" USING btree ("status","sent_at");--> statement-breakpoint
CREATE INDEX "timetable_lessons_teacher_day_idx" ON "timetable_lessons" USING btree ("teacher_id","day_of_week");