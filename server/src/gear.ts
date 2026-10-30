import { ECONOMY } from './economy.generated.js';

// Backstage Gear, pure (no database): the catalog and the Safety Net terms. Numbers live in
// economy.config.json (`gear`); db/boosts.ts stocks and spends the items, db/progression.ts spends an
// Amp Boost charge, db/persistMatchResult.ts spends a Lucky Pick, db/wagers.ts pays the Safety Net.

export type GearItemId = 'amp-boost' | 'lucky-pick';

export interface GearItem {
  id: GearItemId;
  name: string;
  tagline: string;
  chips: number;
  charges: number; // uses on one activated copy
}

export const GEAR_ITEMS: GearItem[] = ECONOMY.gear.items.map((i) => ({ ...i })) as GearItem[];
export const GEAR_MAX_STOCK = ECONOMY.gear.maxStock;
export const AMP_BONUS = ECONOMY.gear.ampBonus; // added to the Fame multiplier, e.g. 0.5 = +50% of base
export const LUCKY_PICK_MIN_STREAK = ECONOMY.gear.minStreak;

export function gearById(id: unknown): GearItem | undefined {
  return typeof id === 'string' ? GEAR_ITEMS.find((i) => i.id === id) : undefined;
}

// Safety Net: an optional add-on at a wagered venue. The premium is paid at pairing on top of the
// buy-in; a LOSS pays `cover` back. Rounded to whole chips, once, here -- the app mirrors this in
// src/lib/gear.ts for display, the server's numbers are the ones that move chips.
export function safetyNetTerms(buyIn: number): { premium: number; cover: number } {
  return {
    premium: Math.round(buyIn * ECONOMY.gear.safetyNet.premiumFraction),
    cover: Math.round(buyIn * ECONOMY.gear.safetyNet.coverFraction),
  };
}
