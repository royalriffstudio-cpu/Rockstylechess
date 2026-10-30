CREATE TABLE "tour_boss_attempts" (
	"user_id" uuid NOT NULL,
	"chapter_id" varchar(40) NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"free_kits_used" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tour_boss_attempts_user_id_chapter_id_pk" PRIMARY KEY("user_id","chapter_id")
);
--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "kit_paid" integer;--> statement-breakpoint
ALTER TABLE "bot_sessions" ADD COLUMN "kit_chapter_id" varchar(40);--> statement-breakpoint
ALTER TABLE "tour_boss_attempts" ADD CONSTRAINT "tour_boss_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;