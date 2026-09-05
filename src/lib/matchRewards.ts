export type MatchOutcome = 'win' | 'loss' | 'draw';

// Mirrors server/src/matchRewards.ts's own copy (online matches are credited
// authoritatively in persistMatchResult.ts, bot/local matches via POST
// /me/match-reward). These are the same numbers result-placeholder.tsx
// already displayed as a purely decorative animation before this was wired
// up to a real balance. Keep in sync with the server if the amounts change.
export const MATCH_CHIP_REWARDS: Record<MatchOutcome, number> = {
  win: 475,
  loss: 0,
  draw: 50,
};

export const MATCH_XP_REWARDS: Record<MatchOutcome, number> = {
  win: 500,
  loss: 0,
  draw: 50,
};
