// Ad placements. A placement is a *named spot in the app*, never a raw ad
// unit: the wrapper (index.ts) only shows an ad for a placement listed here,
// so a new call site has to be added to this file on purpose. That is how
// "never on /match or /matchmaking" is enforced by construction rather than by
// every caller remembering it (a late `queue:matched` on /matchmaking would
// router.replace('/match') under a visible ad and start the online clock).

export type InterstitialPlacement = 'result-exit' | 'puzzle-next';

// Server-side counterparts (caps, rewards) live in server/src/adRewards.ts;
// the string ids are the contract between the two.
export type RewardedPlacement = 'free-chips' | 'extra-spin' | 'daily-double' | 'venue-refill';

// earned      -> the player watched far enough; ask the server to redeem it
// dismissed   -> closed early, no reward
// unavailable -> no ad was loaded / the SDK errored, nothing was shown
export type RewardedResult = 'earned' | 'dismissed' | 'unavailable';
