import { ECONOMY, type BotRewardDifficulty } from './economy.generated.js';

export type MatchOutcome = 'win' | 'loss' | 'draw';

// Mirrors src/lib/matchRewards.ts on the client (used there for the
// result-placeholder.tsx count-up display). This copy is the authoritative
// one -- persistMatchResult.ts (online matches) and db/botSessions.ts (verified
// bot matches) credit chips using these amounts, never a client-supplied number. The numbers themselves live in
// economy.config.json.
export const MATCH_CHIP_REWARDS: Record<MatchOutcome, number> = { ...ECONOMY.matchRewards.online };

// Bot matches pay by difficulty (an easy-bot win is not worth a win over the
// strongest engine). Draws pay a fixed fraction of that bot's win; losses 0.
export const BOT_DIFFICULTIES = Object.keys(ECONOMY.matchRewards.botWin) as BotRewardDifficulty[];

export function isBotDifficulty(value: unknown): value is BotRewardDifficulty {
  return typeof value === 'string' && (BOT_DIFFICULTIES as string[]).includes(value);
}

export function botChipReward(difficulty: BotRewardDifficulty, outcome: MatchOutcome): number {
  const win = ECONOMY.matchRewards.botWin[difficulty];
  if (outcome === 'win') return win;
  if (outcome === 'draw') return Math.round(win * ECONOMY.matchRewards.botDrawFraction);
  return 0;
}

