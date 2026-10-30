CREATE TABLE "player_items" (
	"user_id" uuid NOT NULL,
	"item_id" text NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"charges" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_items_user_id_item_id_pk" PRIMARY KEY("user_id","item_id")
);
--> statement-breakpoint
ALTER TABLE "player_profiles" ADD COLUMN "win_run" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wagers" ADD COLUMN "white_premium" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wagers" ADD COLUMN "black_premium" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wagers" ADD COLUMN "white_cover" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "wagers" ADD COLUMN "black_cover" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "player_items" ADD CONSTRAINT "player_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;