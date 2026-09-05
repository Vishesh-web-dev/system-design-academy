CREATE TABLE "achievements" (
	"learner_id" text NOT NULL,
	"code" text NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "achievements_learner_id_code_pk" PRIMARY KEY("learner_id","code")
);
--> statement-breakpoint
CREATE TABLE "exercise_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"exercise_id" text NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response" text NOT NULL,
	"self_rating" integer,
	"rubric_hits" text[] DEFAULT '{}' NOT NULL,
	"ai_feedback" jsonb
);
--> statement-breakpoint
CREATE TABLE "exercises" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"rubric" text[] NOT NULL,
	"model_answer" text NOT NULL,
	"estimated_minutes" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "flashcard_progress" (
	"learner_id" text NOT NULL,
	"flashcard_id" text NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"interval_days" integer DEFAULT 0 NOT NULL,
	"repetitions" integer DEFAULT 0 NOT NULL,
	"lapses" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_grade" integer,
	"last_reviewed_at" timestamp with time zone,
	CONSTRAINT "flashcard_progress_learner_id_flashcard_id_pk" PRIMARY KEY("learner_id","flashcard_id")
);
--> statement-breakpoint
CREATE TABLE "flashcards" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"front" text NOT NULL,
	"back" text NOT NULL,
	"topic" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interview_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"position" integer NOT NULL,
	"level" text NOT NULL,
	"question" text NOT NULL,
	"guidance" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learners" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_progress" (
	"learner_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"status" text DEFAULT 'not_started' NOT NULL,
	"sections_seen" text[] DEFAULT '{}' NOT NULL,
	"time_spent_seconds" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"last_viewed_at" timestamp with time zone,
	CONSTRAINT "lesson_progress_learner_id_lesson_id_pk" PRIMARY KEY("learner_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" text PRIMARY KEY NOT NULL,
	"module_id" text NOT NULL,
	"phase_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"difficulty" text NOT NULL,
	"estimated_minutes" integer NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"prerequisites" text[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "lessons_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "mock_interview_evaluations" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"overall_score" integer NOT NULL,
	"rubric" jsonb NOT NULL,
	"strengths" text[] DEFAULT '{}' NOT NULL,
	"weaknesses" text[] DEFAULT '{}' NOT NULL,
	"missed_concepts" text[] DEFAULT '{}' NOT NULL,
	"recommended_lessons" text[] DEFAULT '{}' NOT NULL,
	"summary" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mock_interview_evaluations_interview_id_unique" UNIQUE("interview_id")
);
--> statement-breakpoint
CREATE TABLE "mock_interview_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"interview_id" text NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mock_interviews" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"mode" text NOT NULL,
	"problem_key" text NOT NULL,
	"company_style" text,
	"difficulty" text DEFAULT 'core' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phase" text DEFAULT 'clarify' NOT NULL,
	"hints_used" integer DEFAULT 0 NOT NULL,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"time_budget_seconds" integer DEFAULT 2700 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "modules" (
	"id" text PRIMARY KEY NOT NULL,
	"phase_id" text NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"lesson_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "phases" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"position" integer NOT NULL,
	"summary" text NOT NULL,
	"outcome" text NOT NULL,
	"weeks" text NOT NULL,
	CONSTRAINT "phases_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "quiz_attempts" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"score" integer DEFAULT 0 NOT NULL,
	"total" integer DEFAULT 0 NOT NULL,
	"answers" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quiz_questions" (
	"id" text PRIMARY KEY NOT NULL,
	"lesson_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"prompt" text NOT NULL,
	"options" jsonb NOT NULL,
	"correct" text[] NOT NULL,
	"explanation" text NOT NULL,
	"difficulty" text NOT NULL,
	"topic" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "resources" (
	"key" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"section" text,
	"publisher" text NOT NULL,
	"url" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"verified_at" date,
	"topics" text[] DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_items" (
	"learner_id" text NOT NULL,
	"lesson_id" text NOT NULL,
	"due_at" timestamp with time zone DEFAULT now() NOT NULL,
	"interval_days" integer DEFAULT 1 NOT NULL,
	"ease" real DEFAULT 2.5 NOT NULL,
	"reason" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"last_reviewed_at" timestamp with time zone,
	CONSTRAINT "review_items_learner_id_lesson_id_pk" PRIMARY KEY("learner_id","lesson_id")
);
--> statement-breakpoint
CREATE TABLE "topic_mastery" (
	"learner_id" text NOT NULL,
	"topic" text NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"confidence" real DEFAULT 0 NOT NULL,
	"signals" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "topic_mastery_learner_id_topic_pk" PRIMARY KEY("learner_id","topic")
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"learner_id" text PRIMARY KEY NOT NULL,
	"start_date" date NOT NULL,
	"target_weeks" integer DEFAULT 14 NOT NULL,
	"daily_goal_minutes" integer DEFAULT 70 NOT NULL,
	"study_days" text[] DEFAULT '{"mon","tue","wed","thu","fri","sat"}' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"unlock_mode" text DEFAULT 'strict' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "xp_events" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_attempts" ADD CONSTRAINT "exercise_attempts_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_progress" ADD CONSTRAINT "flashcard_progress_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcard_progress" ADD CONSTRAINT "flashcard_progress_flashcard_id_flashcards_id_fk" FOREIGN KEY ("flashcard_id") REFERENCES "public"."flashcards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flashcards" ADD CONSTRAINT "flashcards_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interview_questions" ADD CONSTRAINT "interview_questions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_progress" ADD CONSTRAINT "lesson_progress_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_module_id_modules_id_fk" FOREIGN KEY ("module_id") REFERENCES "public"."modules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_interview_evaluations" ADD CONSTRAINT "mock_interview_evaluations_interview_id_mock_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."mock_interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_interview_messages" ADD CONSTRAINT "mock_interview_messages_interview_id_mock_interviews_id_fk" FOREIGN KEY ("interview_id") REFERENCES "public"."mock_interviews"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mock_interviews" ADD CONSTRAINT "mock_interviews_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "modules" ADD CONSTRAINT "modules_phase_id_phases_id_fk" FOREIGN KEY ("phase_id") REFERENCES "public"."phases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_attempts" ADD CONSTRAINT "quiz_attempts_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quiz_questions" ADD CONSTRAINT "quiz_questions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_items" ADD CONSTRAINT "review_items_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "topic_mastery" ADD CONSTRAINT "topic_mastery_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "xp_events" ADD CONSTRAINT "xp_events_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exercise_attempts_idx" ON "exercise_attempts" USING btree ("learner_id","exercise_id");--> statement-breakpoint
CREATE INDEX "exercises_lesson_idx" ON "exercises" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "flashcard_due_idx" ON "flashcard_progress" USING btree ("learner_id","due_at");--> statement-breakpoint
CREATE INDEX "flashcards_lesson_idx" ON "flashcards" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "iq_lesson_idx" ON "interview_questions" USING btree ("lesson_id");--> statement-breakpoint
CREATE INDEX "lesson_progress_status_idx" ON "lesson_progress" USING btree ("learner_id","status");--> statement-breakpoint
CREATE INDEX "lessons_position_idx" ON "lessons" USING btree ("position");--> statement-breakpoint
CREATE INDEX "lessons_phase_pos_idx" ON "lessons" USING btree ("phase_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "mock_msg_pos_idx" ON "mock_interview_messages" USING btree ("interview_id","position");--> statement-breakpoint
CREATE INDEX "mock_learner_started_idx" ON "mock_interviews" USING btree ("learner_id","started_at");--> statement-breakpoint
CREATE INDEX "modules_phase_pos_idx" ON "modules" USING btree ("phase_id","position");--> statement-breakpoint
CREATE INDEX "notes_lesson_idx" ON "notes" USING btree ("learner_id","lesson_id");--> statement-breakpoint
CREATE INDEX "quiz_attempts_lesson_idx" ON "quiz_attempts" USING btree ("learner_id","lesson_id","completed_at");--> statement-breakpoint
CREATE INDEX "quiz_lesson_pos_idx" ON "quiz_questions" USING btree ("lesson_id","position");--> statement-breakpoint
CREATE INDEX "review_due_idx" ON "review_items" USING btree ("learner_id","due_at","priority");--> statement-breakpoint
CREATE INDEX "xp_learner_time_idx" ON "xp_events" USING btree ("learner_id","created_at");