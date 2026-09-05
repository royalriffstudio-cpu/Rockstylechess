ALTER TABLE "player_profiles" ALTER COLUMN "chips" SET DEFAULT 10000;--> statement-breakpoint
-- Chips economy rescaled 1000x (match rewards, spin/daily/quest payouts,
-- cosmetic prices, shop packs and the welcome bonus were all divided by
-- 1000). Bring every existing balance onto the new scale to match.
UPDATE "player_profiles" SET "chips" = "chips" / 1000;
