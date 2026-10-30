import { and, desc, eq, gte, isNotNull, sql } from 'drizzle-orm';

import { ECONOMY } from '../economy.generated.js';

import { redeemAdReward } from './adEvents.js';
import { db } from './client.js';
import { playerProfiles, spinPrizes, userSpinLog } from './schema/index.js';
import { utcDayDiff, utcDayStart } from './utcDay.js';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Chip-priced extra spins (economy.config.json -> spinExtra): one price per allowed paid spin that UTC
// day, stepping up, so the daily cap is the number of prices. Every price is above the wheel's expected
// value (asserted by check-economy.mjs), so a paid spin is a net sink on average.
const PAID_PRICES: readonly number[] = ECONOMY.spinExtra.prices;

async function paidSpinsToday(tx: Tx | typeof db, userId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(userSpinLog)
    .where(and(eq(userSpinLog.userId, userId), gte(userSpinLog.spunAt, utcDayStart(now)), isNotNull(userSpinLog.paidChips)));
  return row?.n ?? 0;
}

export async function getSpinStatus(userId: string) {
  const [latest] = await db
    .select({ spunAt: userSpinLog.spunAt })
    .from(userSpinLog)
    .where(eq(userSpinLog.userId, userId))
    .orderBy(desc(userSpinLog.spunAt))
    .limit(1);
  const now = new Date();
  const canSpin = !latest || utcDayDiff(latest.spunAt, now) !== 0;
  const used = await paidSpinsToday(db, userId, now);
  // nextPrice: what the next chip-priced spin costs (null once today's are used up). Only offered after
  // the free spin, so the client shows it when canSpin is false.
  return { canSpin, paid: { used, cap: PAID_PRICES.length, nextPrice: used < PAID_PRICES.length ? PAID_PRICES[used] : null } };
}

function pickWeighted<T extends { weight: number }>(rows: T[]): T {
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  let roll = Math.random() * total;
  for (const row of rows) {
    roll -= row.weight;
    if (roll < 0) return row;
  }
  return rows[rows.length - 1]; // float-rounding fallback
}

// No row lock (see dailyBonus.ts's claimDailyBonus for the same accepted
// tradeoff on the double-request race window).
//
// `withAd`: the player watched a rewarded ad for their one extra daily spin.
// Only honoured when they have ALREADY spun today (a player who can spin for
// free never burns an ad), at most one extra per day (the ad cap), and the ad is
// redeemed inside this same transaction so a failed spin never costs the ad.
//
// `withChips`: a chip-priced extra spin. Only after the free daily spin, at the next price on the ladder
// (see PAID_PRICES), debited in this same transaction so a failed spin never costs the chips. The user's
// spins are serialised by an advisory lock so two quick taps can't both read the same paid count.
export async function performSpin(userId: string, options: { withAd?: boolean; withChips?: boolean } = {}) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`spin:${userId}`}))`);
    const [latest] = await tx
      .select({ spunAt: userSpinLog.spunAt })
      .from(userSpinLog)
      .where(eq(userSpinLog.userId, userId))
      .orderBy(desc(userSpinLog.spunAt))
      .limit(1);
    const now = new Date();
    const spunToday = !!latest && utcDayDiff(latest.spunAt, now) === 0;
    let paidChips: number | null = null;

    if (options.withChips) {
      if (!spunToday) return { freeSpinAvailable: true as const };
      const used = await paidSpinsToday(tx, userId, now);
      if (used >= PAID_PRICES.length) return { paidCapReached: true as const };
      const price = PAID_PRICES[used];
      const [debited] = await tx
        .update(playerProfiles)
        .set({ chips: sql`${playerProfiles.chips} - ${price}`, updatedAt: now })
        .where(and(eq(playerProfiles.userId, userId), gte(playerProfiles.chips, price)))
        .returning({ chips: playerProfiles.chips });
      if (!debited) return { insufficientChips: price };
      paidChips = price;
    } else if (spunToday) {
      if (!options.withAd) return { alreadySpun: true as const };
      const outcome = await redeemAdReward(tx, userId, 'extra-spin', now);
      if (outcome !== 'ok') return { adBlocked: outcome };
    }

    const prizes = await tx.select().from(spinPrizes);
    if (prizes.length === 0) {
      // Loud failure (surfaces as a 500 via asyncHandler) rather than a
      // silent no-op -- confirms `npm run seed:spin` hasn't been run yet.
      throw new Error('spin-prizes-not-seeded');
    }
    const prize = pickWeighted(prizes);

    await tx.insert(userSpinLog).values({ userId, prizeId: prize.id, spunAt: now, paidChips });

    const increment =
      prize.rewardType === 'chips'
        ? { chips: sql`${playerProfiles.chips} + ${prize.rewardAmount}` }
        : prize.rewardType === 'gems'
          ? { gems: sql`${playerProfiles.gems} + ${prize.rewardAmount}` }
          : { xp: sql`${playerProfiles.xp} + ${prize.rewardAmount}` }; // defensive: no seed row uses 'xp' today

    const [profile] = await tx
      .update(playerProfiles)
      .set({ ...increment, updatedAt: now })
      .where(eq(playerProfiles.userId, userId))
      .returning({ chips: playerProfiles.chips, gems: playerProfiles.gems });

    return { alreadySpun: false as const, prize, paidChips, chips: profile.chips, gems: profile.gems };
  });
}
