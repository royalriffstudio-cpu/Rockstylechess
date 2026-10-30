// Authoritative rewarded-ad rules -- placements, daily caps and reward sizes
// live ONLY here; the client (src/lib/ads/types.ts) just names the placements
// and shows whatever the server returns. Same pattern as questCatalog.ts.
//
// (A fourth placement, 'venue-refill', is the out-of-chips lifeline: see refillAmount below.)
//
// Sizing (numbers in economy.config.json): a free-chips ad pays 60, three a day
// is 180 -- under one online win (200) -- so watching ads never out-earns
// actually playing. extra-spin and daily-double reward the *existing*
// spin/daily-bonus tables rather than a number here.
import { ECONOMY } from './economy.generated.js';

export type AdPlacement = 'free-chips' | 'extra-spin' | 'daily-double' | 'venue-refill';

export interface AdPlacementRule {
  dailyCap: number;
  // Only 'free-chips' pays out directly; the others multiply/extend an
  // existing reward inside spin.ts / dailyBonus.ts.
  rewardChips: number;
}

export const AD_PLACEMENTS: Record<AdPlacement, AdPlacementRule> = {
  'free-chips': { ...ECONOMY.ads['free-chips'] },
  'extra-spin': { ...ECONOMY.ads['extra-spin'] },
  'daily-double': { ...ECONOMY.ads['daily-double'] },
  'venue-refill': { ...ECONOMY.ads['venue-refill'] },
};

// Venue refill: an out-of-chips lifeline. Offered only while the balance is below the CHEAPEST wagered
// buy-in (the player can enter no paid venue); each ad pays the shortfall to that buy-in, at most
// `rewardChips`. Anyone who can already afford the cheapest venue gets 0: it is a way back in, never a faucet.
export const REFILL_FLOOR = Math.min(...Object.values(ECONOMY.venues).map((v) => v.buyIn).filter((b) => b > 0));
export function refillAmount(balance: number): number {
  if (balance >= REFILL_FLOOR) return 0;
  return Math.min(AD_PLACEMENTS['venue-refill'].rewardChips, REFILL_FLOOR - balance);
}

export function isAdPlacement(value: unknown): value is AdPlacement {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AD_PLACEMENTS, value);
}

// A verified view stays redeemable for this long (SSV callbacks can lag the
// on-device "reward earned" event by a few seconds, never minutes).
export const AD_EVENT_TTL_MS = 10 * 60 * 1000;

// false (default): the test-ID phase -- the client's "ad finished" report is
// trusted, but still capped per user per UTC day. true: a reward is only
// redeemable against a row inserted by Google's signed SSV callback, so a
// modified client can't claim rewards without watching ads. Flip on in the
// server's env once real ad units + the SSV callback URL exist in AdMob.
export const ADS_REQUIRE_SSV = process.env.ADS_REQUIRE_SSV === 'true';
