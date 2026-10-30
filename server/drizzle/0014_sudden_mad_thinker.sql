CREATE TABLE "daily_progress" (
	"user_id" uuid NOT NULL,
	"day_start" timestamp with time zone NOT NULL,
	"bot_fame" integer DEFAULT 0 NOT NULL,
	"first_win_done" boolean DEFAULT false NOT NULL,
	CONSTRAINT "daily_progress_user_id_day_start_pk" PRIMARY KEY("user_id","day_start")
);
--> statement-breakpoint
CREATE TABLE "level_rewards_granted" (
	"user_id" uuid NOT NULL,
	"level" integer NOT NULL,
	"chips" integer DEFAULT 0 NOT NULL,
	"gems" integer DEFAULT 0 NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "level_rewards_granted_user_id_level_pk" PRIMARY KEY("user_id","level")
);
--> statement-breakpoint
CREATE TABLE "progression_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"source" text NOT NULL,
	"match_id" text,
	"payload" jsonb NOT NULL,
	"celebratory" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "user_titles" (
	"user_id" uuid NOT NULL,
	"title_id" varchar(40) NOT NULL,
	"unlocked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_titles_user_id_title_id_pk" PRIMARY KEY("user_id","title_id")
);
--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "equipped_title_id" varchar(40);--> statement-breakpoint
ALTER TABLE "daily_progress" ADD CONSTRAINT "daily_progress_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "level_rewards_granted" ADD CONSTRAINT "level_rewards_granted_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progression_events" ADD CONSTRAINT "progression_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_titles" ADD CONSTRAINT "user_titles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "progression_events_unseen_idx" ON "progression_events" USING btree ("user_id","celebratory","seen_at");