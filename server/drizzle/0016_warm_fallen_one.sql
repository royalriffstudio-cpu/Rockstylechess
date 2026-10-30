CREATE TABLE "festival_clears" (
	"user_id" uuid NOT NULL,
	"tier_id" text NOT NULL,
	"cleared_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "festival_clears_user_id_tier_id_pk" PRIMARY KEY("user_id","tier_id")
);
--> statement-breakpoint
CREATE TABLE "festival_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tier_id" text NOT NULL,
	"entry_paid" bigint NOT NULL,
	"set_index" integer DEFAULT 0 NOT NULL,
	"sets_cleared" integer DEFAULT 0 NOT NULL,
	"replays_used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"phase" text DEFAULT 'ready' NOT NULL,
	"current_match_id" uuid,
	"payout" bigint,
	"utc_day" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "festival_clears" ADD CONSTRAINT "festival_clears_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "festival_runs" ADD CONSTRAINT "festival_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "festival_runs_one_active_idx" ON "festival_runs" USING btree ("user_id") WHERE "festival_runs"."status" = 'active';--> statement-breakpoint
CREATE INDEX "festival_runs_user_day_idx" ON "festival_runs" USING btree ("user_id","tier_id","utc_day");--> statement-breakpoint
CREATE INDEX "festival_runs_status_idx" ON "festival_runs" USING btree ("status","updated_at");