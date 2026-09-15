CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "learners" ADD COLUMN "email" text;--> statement-breakpoint
ALTER TABLE "learners" ADD COLUMN "password_hash" text;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sessions_learner_idx" ON "sessions" USING btree ("learner_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "learners_email_idx" ON "learners" USING btree ("email");