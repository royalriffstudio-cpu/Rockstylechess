import { ECONOMY } from '@/lib/economy.generated';

// Backstage Gear, display side. The server (server/src/gear.ts) is the authority for every chip that
// moves; these mirror its numbers so the app can show a price before it asks.

export const GEAR_MAX_STOCK = ECONOMY.gear.maxStock;
export const GEAR_AMP_BONUS_PERCENT = Math.round(ECONOMY.gear.ampBonus * 100);
export const LUCKY_PICK_MIN_STREAK = ECONOMY.gear.minStreak;

// Safety Net: an optional add-on at a wagered venue. Same rounding as server/src/gear.ts.
export function safetyNetTerms(buyIn: number): { premium: number; cover: number } {
  return {
    premium: Math.round(buyIn * ECONOMY.gear.safetyNet.premiumFraction),
    cover: Math.round(buyIn * ECONOMY.gear.safetyNet.coverFraction),
  };
}
