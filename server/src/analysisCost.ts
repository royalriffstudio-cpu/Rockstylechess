// Mirrored read-only client-side in src/lib/analysisCost.ts (same pattern
// as matchRewards.ts) -- keep both in sync if this changes. Chips is the
// abundant currency (10M starting balance, ~475K/win), gems the scarce one
// (starts at 0, earned via spin/daily bonus or purchased) -- the gem price
// is deliberately much smaller in absolute terms since gems are worth more.
export const ANALYSIS_COST = { chips: 250, gems: 15 } as const;
