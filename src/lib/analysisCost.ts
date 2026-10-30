import { ECONOMY } from '@/lib/economy.generated';

// Read-only mirror of server/src/analysisCost.ts -- both read
// economy.config.json. Used to render the confirm-and-charge prompt without a
// network round trip; the server's own copy is what actually gets charged.
export const ANALYSIS_COST = { chips: ECONOMY.analysis.chips, gems: ECONOMY.analysis.gems } as const;

// Review Pack: ten reviews at once for less than ten singles (stored as credits on the player).
export const ANALYSIS_PACK = {
  reviews: ECONOMY.analysis.pack.reviews,
  chips: ECONOMY.analysis.pack.chips,
  gems: ECONOMY.analysis.pack.gems,
  maxCredits: ECONOMY.analysis.pack.maxCredits,
} as const;

// What a pack saves per currency, as whole percent and in currency units (for "save 20%" copy).
export function packSavings(currency: 'chips' | 'gems'): { percent: number; amount: number; each: number } {
  const singles = ANALYSIS_COST[currency] * ANALYSIS_PACK.reviews;
  const amount = singles - ANALYSIS_PACK[currency];
  return { percent: Math.round((amount / singles) * 100), amount, each: ANALYSIS_PACK[currency] / ANALYSIS_PACK.reviews };
}
