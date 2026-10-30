import { ECONOMY } from './economy.generated.js';

// Festival Run's rules, pure (no database). db/festival.ts persists and pays them.
// Every number is in economy.config.json (`festival`); check-economy.mjs asserts the
// purse ladders against estimated skill profiles.

export interface FestivalTier {
  id: string;
  name: string;
  tagline: string;
  unlockChapter: string;
  entry: number;
  sets: string[]; // bot ids, one per set
  purse: number[]; // what banking after clearing set k+1 pays
  title: { id: string; name: string };
}

export const FESTIVAL_TIERS: FestivalTier[] = ECONOMY.festival.tiers.map((t) => ({
  ...t,
  sets: [...t.sets],
  purse: [...t.purse],
})) as FestivalTier[];
export const FESTIVAL_TITLES = FESTIVAL_TIERS.map((t) => t.title);
export const REPEAT_SURCHARGE = ECONOMY.festival.repeatSurcharge;
export const STALE_RUN_MS = ECONOMY.festival.staleRunMinutes * 60_000;
// The human's clock for each set (the bot is never clocked).
export const FESTIVAL_SET_CLOCK_MS = 15 * 60_000;

export function tierById(id: unknown): FestivalTier | undefined {
  return typeof id === 'string' ? FESTIVAL_TIERS.find((t) => t.id === id) : undefined;
}

export function dailyRunsFor(tier: FestivalTier): number {
  return (ECONOMY.festival.dailyRuns as Record<string, number>)[tier.id] ?? 1;
}

/** The entry for a player's n-th run of this tier today (runsToday = runs already started). */
export function entryFee(tier: FestivalTier, runsToday: number): number {
  return Math.round(tier.entry * (1 + REPEAT_SURCHARGE * runsToday));
}

/** What banking pays after `setsCleared` sets (0 before the first set is won). */
export function bankedPurse(tier: FestivalTier, setsCleared: number): number {
  return setsCleared <= 0 ? 0 : tier.purse[Math.min(setsCleared, tier.purse.length) - 1];
}
