ALTER TYPE "public"."quest_metric" ADD VALUE 'online_games';--> statement-breakpoint
CREATE TABLE "bot_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"bot_id" varchar(40) NOT NULL,
	"difficulty" varchar(40) NOT NULL,
	"color" varchar(1) NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"result" varchar(20)
);
--> statement-breakpoint
CREATE TABLE "tour_progress" (
	"user_id" uuid NOT NULL,
	"gig_id" varchar(60) NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "tour_progress_user_id_gig_id_pk" PRIMARY KEY("user_id","gig_id")
);
--> statement-breakpoint
CREATE TABLE "tour_state" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"encore_progress" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD CONSTRAINT "bot_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_progress" ADD CONSTRAINT "tour_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tour_state" ADD CONSTRAINT "tour_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bot_sessions_user_idx" ON "bot_sessions" USING btree ("user_id","finished_at");