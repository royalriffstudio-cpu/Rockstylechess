import { ECONOMY } from '@/lib/economy.generated';

export type MatchOutcome = 'win' | 'loss' | 'draw';

// Mirrors server/src/matchRewards.ts (online matches are credited
// authoritatively in persistMatchResult.ts, bot/local matches via POST
// /me/match-reward). Both read economy.config.json, so these numbers cannot
// drift from the server's. Display only (result-placeholder.tsx count-up).
export const MATCH_CHIP_REWARDS: Record<MatchOutcome, number> = { ...ECONOMY.matchRewards.online };


// Bot matches pay by difficulty; mirrors server/src/matchRewards.ts's botChipReward.
export function botChipReward(difficulty: keyof typeof ECONOMY.matchRewards.botWin, outcome: MatchOutcome): number {
  const win = ECONOMY.matchRewards.botWin[difficulty];
  if (outcome === 'win') return win;
  if (outcome === 'draw') return Math.round(win * ECONOMY.matchRewards.botDrawFraction);
  return 0;
}
