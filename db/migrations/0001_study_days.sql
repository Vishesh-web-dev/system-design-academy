CREATE TABLE "study_days" (
	"learner_id" text NOT NULL,
	"day" date NOT NULL,
	"seconds" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "study_days_learner_id_day_pk" PRIMARY KEY("learner_id","day")
);
--> statement-breakpoint
ALTER TABLE "study_days" ADD CONSTRAINT "study_days_learner_id_learners_id_fk" FOREIGN KEY ("learner_id") REFERENCES "public"."learners"("id") ON DELETE cascade ON UPDATE no action;