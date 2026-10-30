import { ECONOMY } from './economy.generated.js';

// Mirrored read-only client-side in src/lib/analysisCost.ts (same pattern as
// matchRewards.ts); both read economy.config.json. One review costs about one
// online win (200 chips) or 5 gems -- the same 40:1 chip-to-gem rate as every
// other price -- so analysing a game is a real decision, not pocket change.
export const ANALYSIS_COST = { chips: ECONOMY.analysis.chips, gems: ECONOMY.analysis.gems } as const;

// Review Pack: `reviews` reviews bought at once for less than that many singles (one fixed
// discount step, see economy.config.json -> analysis.pack). Stored as credits on the player.
export const ANALYSIS_PACK = {
  reviews: ECONOMY.analysis.pack.reviews,
  chips: ECONOMY.analysis.pack.chips,
  gems: ECONOMY.analysis.pack.gems,
  maxCredits: ECONOMY.analysis.pack.maxCredits,
} as const;
