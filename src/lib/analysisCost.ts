// Read-only mirror of server/src/analysisCost.ts (same pattern as
// matchRewards.ts) -- keep both in sync if this changes. Used to render the
// confirm-and-charge prompt without a network round trip; the server's own
// copy is what actually gets charged, this is display-only.
export const ANALYSIS_COST = { chips: 250, gems: 15 } as const;
