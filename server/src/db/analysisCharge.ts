import { and, eq, gte, gt, sql } from 'drizzle-orm';

import { ANALYSIS_COST, ANALYSIS_PACK } from '../analysisCost.js';
import { db } from './client.js';
import { playerProfiles } from './schema/index.js';

// How a Game Review is paid: a credit from a Review Pack, or chips, or gems.
export type ChargeCurrency = 'chips' | 'gems' | 'credit';
export type PackCurrency = 'chips' | 'gems';

type Balances = { chips: number; gems: number; credits: number };

export type ChargeResult =
  | ({ status: 'ok'; currency: ChargeCurrency; price: number } & Balances)
  | { status: 'insufficient-funds'; currency: ChargeCurrency; price: number; balance: number };

// Mirrors purchaseCosmetic's (cosmetics.ts) race-safe technique -- the
// conditional UPDATE ... WHERE balance >= price is itself the atomic guard
// against overspend, no separate SELECT-then-UPDATE race window. No
// transaction wrapper needed here (unlike purchaseCosmetic), since there's
// no second row (an "ownership"/idempotency insert) to keep atomic with
// the decrement -- Game Analysis charges every time it's used, it doesn't
// grant a persistent unlock record.
// A 'credit' spends one stored review (bought in a Review Pack) instead of currency: price 0.
export async function chargeForAnalysis(userId: string, currency: ChargeCurrency): Promise<ChargeResult> {
  const price = currency === 'credit' ? 0 : ANALYSIS_COST[currency];
  const guard =
    currency === 'credit'
      ? gt(playerProfiles.analysisCredits, 0)
      : gte(currency === 'gems' ? playerProfiles.gems : playerProfiles.chips, price);
  const spend =
    currency === 'credit'
      ? { analysisCredits: sql`${playerProfiles.analysisCredits} - 1` }
      : currency === 'gems'
        ? { gems: sql`${playerProfiles.gems} - ${price}` }
        : { chips: sql`${playerProfiles.chips} - ${price}` };

  const [debited] = await db
    .update(playerProfiles)
    .set({ ...spend, updatedAt: new Date() })
    .where(and(eq(playerProfiles.userId, userId), guard))
    .returning({ chips: playerProfiles.chips, gems: playerProfiles.gems, credits: playerProfiles.analysisCredits });

  if (!debited) {
    const [current] = await db
      .select({ chips: playerProfiles.chips, gems: playerProfiles.gems, credits: playerProfiles.analysisCredits })
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, userId))
      .limit(1);
    const balance = currency === 'credit' ? (current?.credits ?? 0) : currency === 'gems' ? (current?.gems ?? 0) : (current?.chips ?? 0);
    return { status: 'insufficient-funds', currency, price, balance };
  }

  return { status: 'ok', currency, price, ...debited };
}

export type PackResult =
  | ({ status: 'ok'; currency: PackCurrency; price: number; reviews: number } & Balances)
  | { status: 'insufficient-funds'; currency: PackCurrency; price: number; balance: number }
  | { status: 'stock-full'; credits: number; maxCredits: number }
  | { status: 'profile-not-found' };

// Buys a Review Pack: the chips/gems leave and the credits arrive in ONE conditional UPDATE (the
// price guard and the cap guard are both in its WHERE, so a double-tap or two devices can neither
// overspend nor push the stock past the cap). Nothing is debited when it is refused.
export async function buyAnalysisPack(userId: string, currency: PackCurrency): Promise<PackResult> {
  const price = ANALYSIS_PACK[currency];
  const balanceColumn = currency === 'gems' ? playerProfiles.gems : playerProfiles.chips;

  const [bought] = await db
    .update(playerProfiles)
    .set({
      ...(currency === 'gems' ? { gems: sql`${playerProfiles.gems} - ${price}` } : { chips: sql`${playerProfiles.chips} - ${price}` }),
      analysisCredits: sql`${playerProfiles.analysisCredits} + ${ANALYSIS_PACK.reviews}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(playerProfiles.userId, userId),
        gte(balanceColumn, price),
        sql`${playerProfiles.analysisCredits} + ${ANALYSIS_PACK.reviews} <= ${ANALYSIS_PACK.maxCredits}`,
      ),
    )
    .returning({ chips: playerProfiles.chips, gems: playerProfiles.gems, credits: playerProfiles.analysisCredits });
  if (bought) return { status: 'ok', currency, price, reviews: ANALYSIS_PACK.reviews, ...bought };

  // Refused: say why (a full bag is a different message from a short balance).
  const [current] = await db
    .select({ chips: playerProfiles.chips, gems: playerProfiles.gems, credits: playerProfiles.analysisCredits })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  if (!current) return { status: 'profile-not-found' };
  if (current.credits + ANALYSIS_PACK.reviews > ANALYSIS_PACK.maxCredits) {
    return { status: 'stock-full', credits: current.credits, maxCredits: ANALYSIS_PACK.maxCredits };
  }
  return { status: 'insufficient-funds', currency, price, balance: currency === 'gems' ? current.gems : current.chips };
}
