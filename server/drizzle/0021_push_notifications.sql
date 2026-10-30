CREATE TABLE "push_devices" (
	"token" varchar(255) PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" varchar(16) NOT NULL,
	"tz_offset_min" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"social" boolean DEFAULT true NOT NULL,
	"invites" boolean DEFAULT true NOT NULL,
	"results" boolean DEFAULT true NOT NULL,
	"daily" boolean DEFAULT true NOT NULL,
	"last_daily_push_day" date
);
--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_preferences" ADD CONSTRAINT "push_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "push_devices_user_id_idx" ON "push_devices" USING btree ("user_id");