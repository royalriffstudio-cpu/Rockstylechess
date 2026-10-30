import { ECONOMY } from '@/lib/economy.generated';

// Display mirror of server/src/adRewards.ts refillAmount: the out-of-chips lifeline pays the shortfall to
// the CHEAPEST paid venue's buy-in, at most `rewardChips` per ad, and nothing to a player who can already
// afford that venue. The server's number is the one that is paid.
export const REFILL_FLOOR = Math.min(...Object.values(ECONOMY.venues).map((v) => v.buyIn).filter((b) => b > 0));

export function refillAmount(balance: number): number {
  if (balance >= REFILL_FLOOR) return 0;
  return Math.min(ECONOMY.ads['venue-refill'].rewardChips, REFILL_FLOOR - balance);
}
