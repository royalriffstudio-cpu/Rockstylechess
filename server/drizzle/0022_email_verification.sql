ALTER TABLE "player_profiles" ADD COLUMN "welcome_bonus_pending" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "email_grandfathered" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Every account that exists when this migration runs keeps working exactly as before: unverified emails are
-- grandfathered, so the new verification gate never applies to them.
UPDATE "users" SET "email_grandfathered" = true WHERE "email_verified" = false;
