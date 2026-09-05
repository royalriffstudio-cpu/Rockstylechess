ALTER TABLE "player_profiles" ADD COLUMN "friend_code" varchar(12);--> statement-breakpoint
-- Backfill a friend code for every pre-existing profile before the unique
-- constraint below is enforced. 8 hex chars from a fresh uuid; the unique
-- index catches the astronomically unlikely collision (re-run if it fires).
UPDATE "player_profiles" SET "friend_code" = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)) WHERE "friend_code" IS NULL;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "pair_key" varchar(73);--> statement-breakpoint
ALTER TABLE "friendships" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "friendships_friend_user_id_idx" ON "friendships" USING btree ("friend_user_id");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages" USING btree ("conversation_id","sent_at");--> statement-breakpoint
ALTER TABLE "player_profiles" ADD CONSTRAINT "player_profiles_friend_code_unique" UNIQUE("friend_code");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_pair_key_unique" UNIQUE("pair_key");