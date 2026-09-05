export type MatchOutcome = 'win' | 'loss' | 'draw';

// Mirrors src/lib/matchRewards.ts on the client (used there for the
// result-placeholder.tsx count-up display). This copy is the authoritative
// one -- both persistMatchResult.ts (online matches) and POST
// /me/match-reward (bot/local matches) credit chips and xp using these
// amounts, never a client-supplied number. Keep the two files in sync if
// these change.
export const MATCH_CHIP_REWARDS: Record<MatchOutcome, number> = {
  win: 475,
  loss: 0,
  draw: 50,
};

// Pacing against server/src/leveling.ts's curve (300*L^2): at 500 xp/win,
// L2 (1,200 total) takes ~3 wins, L10 (30,000) ~60, L50 (750,000) ~1,500,
// L100 (3,000,000) ~6,000. loss:0 mirrors the chip philosophy exactly;
// draw is a small consolation, same ~10%-of-win ratio chips uses.
export const MATCH_XP_REWARDS: Record<MatchOutcome, number> = {
  win: 500,
  loss: 0,
  draw: 50,
};
