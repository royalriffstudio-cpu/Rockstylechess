import { and, eq, lt, sql } from 'drizzle-orm';

import { ECONOMY } from '../economy.generated.js';
import { reportError } from '../monitoring.js';
import { safetyNetTerms } from '../gear.js';
import { db } from './client.js';
import { playerProfiles, wagers } from './schema/index.js';

// Chip wagers on online venues. The whole feature is three guarantees:
//   1. ESCROW is atomic: both buy-ins leave both balances in ONE transaction,
//      or neither does (a short balance on either side rolls both back).
//   2. SETTLEMENT is idempotent: the held -> settled/refunded status flip is a
//      conditional UPDATE, so a second call (retry, race, sweeper) finds
//      nothing to do and credits nothing.
//   3. Chips are never created: payout + rake always equals the pot, and every
//      failure path ends in a refund, never a silent loss.
// ONE deliberate exception: the optional SAFETY NET (an add-on a player buys at pairing). Its
// premium is paid in the same escrow transaction; a LOSS pays back `cover`, which is the only
// chips this file ever pays that were not in the pot. The premium is returned if the match is
// voided, kept on a win or a draw. economy.config.json -> gear.safetyNet; check-economy.mjs
// asserts a player (or two colluding accounts) can never come out ahead on it.
// All numbers come from economy.config.json (see ECONOMY.venues / venueRake).

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface VenueStake {
  buyIn: number;
  prize: number; // what the winner receives (pot minus the house rake)
  minRating: number;
}

const VENUES = ECONOMY.venues as Record<string, VenueStake>;

/** The stake for a venue, or null for an unknown venue or a free one (Garage). */
export function stakeFor(venueTier: string): VenueStake | null {
  const venue = VENUES[venueTier];
  return venue && venue.buyIn > 0 ? venue : null;
}

export async function getEntryProfile(userId: string): Promise<{ chips: number; rating: number } | null> {
  const [row] = await db
    .select({ chips: playerProfiles.chips, rating: playerProfiles.rating })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

class InsufficientChips extends Error {
  constructor(public readonly userId: string) {
    super('insufficient-chips');
  }
}

export type EscrowResult = { status: 'ok' } | { status: 'insufficient-chips'; userId: string };

// Takes both buy-ins and records the held wager, or does nothing at all.
// Debits run in userId order so two matches that ever share a player cannot
// deadlock each other. The conditional `chips >= buyIn` UPDATE is the same
// atomic-spend idiom as db/analysisCharge.ts and db/cosmetics.ts.
export async function escrowWager(
  matchId: string,
  venueTier: string,
  whiteUserId: string,
  blackUserId: string,
  insured: { white: boolean; black: boolean } = { white: false, black: false },
): Promise<EscrowResult> {
  const stake = stakeFor(venueTier);
  if (!stake) throw new Error(`not a wagered venue: ${venueTier}`);
  const terms = safetyNetTerms(stake.buyIn);
  const premiumOf = (isInsured: boolean) => (isInsured ? terms.premium : 0);
  const premiumByUser = new Map([
    [whiteUserId, premiumOf(insured.white)],
    [blackUserId, premiumOf(insured.black)],
  ]);
  try {
    await db.transaction(async (tx) => {
      for (const userId of [whiteUserId, blackUserId].sort()) {
        const due = stake.buyIn + (premiumByUser.get(userId) ?? 0);
        const debited = await tx
          .update(playerProfiles)
          .set({ chips: sql`${playerProfiles.chips} - ${due}`, updatedAt: new Date() })
          .where(and(eq(playerProfiles.userId, userId), sql`${playerProfiles.chips} >= ${due}`))
          .returning({ chips: playerProfiles.chips });
        // Throwing (not returning) is what rolls the first debit back too.
        if (debited.length === 0) throw new InsufficientChips(userId);
      }
      await tx.insert(wagers).values({
        matchId,
        venueTier,
        buyIn: stake.buyIn,
        whiteUserId,
        blackUserId,
        whitePremium: premiumOf(insured.white),
        blackPremium: premiumOf(insured.black),
        whiteCover: insured.white ? terms.cover : 0,
        blackCover: insured.black ? terms.cover : 0,
      });
    });
    return { status: 'ok' };
  } catch (error) {
    if (error instanceof InsufficientChips) return { status: 'insufficient-chips', userId: error.userId };
    throw error;
  }
}

export interface SettleInput {
  resultType: string; // checkmate | stalemate | draw | resignation | forfeit | timeout
  winnerUserId: string | null;
  plies: number;
  // Server restart / stale sweep: give both stakes back whatever the result was.
  forceRefund?: boolean;
}

export interface SettledWager {
  matchId: string;
  venueTier: string;
  buyIn: number;
  outcome: 'win' | 'draw' | 'void';
  // Per participant: signed net result and the balance after settling. `premium` is what they paid
  // for the Safety Net (0 = not insured) and `coverPaid` what it paid back on a loss.
  players: Record<string, { net: number; chipsAfter: number; payout: number; premium: number; coverPaid: number }>;
  payout: number;
  rake: number;
  whiteUserId: string | null;
  blackUserId: string | null;
}

// An ending that carries no real contest: someone left before 3 moves each.
// Checkmate and flag-fall are NOT void -- a quick mate is a real result, and a
// player who never moves loses on time (see the plan's known-gaps list).
export function isVoidEnding(resultType: string, plies: number): boolean {
  return plies < ECONOMY.wagerVoidPlies && ['resignation', 'draw', 'forfeit'].includes(resultType);
}

async function credit(tx: Tx, userId: string, amount: number): Promise<number> {
  const [row] = await tx
    .update(playerProfiles)
    .set({ chips: sql`${playerProfiles.chips} + ${amount}`, updatedAt: new Date() })
    .where(eq(playerProfiles.userId, userId))
    .returning({ chips: playerProfiles.chips });
  return row?.chips ?? 0;
}

async function balance(tx: Tx, userId: string): Promise<number> {
  const [row] = await tx
    .select({ chips: playerProfiles.chips })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  return row?.chips ?? 0;
}

// Returns null when there is nothing to settle (not a wagered match, or it was
// already settled) -- callers treat that as "done", which is what makes retries
// and the sweeper safe.
export async function settleWager(matchId: string, input: SettleInput): Promise<SettledWager | null> {
  return db.transaction(async (tx) => {
    const [held] = await tx.select().from(wagers).where(eq(wagers.matchId, matchId)).for('update');
    if (!held || held.status !== 'held') return null;

    const stake = VENUES[held.venueTier];
    const seats = [held.whiteUserId, held.blackUserId];
    const winnerIsSeated = input.winnerUserId !== null && seats.includes(input.winnerUserId);

    let outcome: SettledWager['outcome'];
    if (input.forceRefund || isVoidEnding(input.resultType, input.plies)) outcome = 'void';
    else if (winnerIsSeated) outcome = 'win';
    else outcome = 'draw'; // draw, stalemate, or a result with no winner

    const pot = held.buyIn * 2;
    const payout = outcome === 'win' ? stake.prize : 0;
    const rake = outcome === 'win' ? pot - stake.prize : 0;

    const players: SettledWager['players'] = {};
    const seated = [
      { userId: held.whiteUserId, premium: held.whitePremium, cover: held.whiteCover },
      { userId: held.blackUserId, premium: held.blackPremium, cover: held.blackCover },
    ];
    for (const { userId, premium, cover } of seated) {
      if (!userId) continue; // account deleted mid-match: nothing to credit
      let received = 0;
      let coverPaid = 0;
      if (outcome === 'win') {
        if (userId === input.winnerUserId) received = payout;
        else {
          coverPaid = cover; // the Safety Net: a loss gets part of the buy-in back
          received = cover;
        }
      } else if (outcome === 'void') {
        received = held.buyIn + premium; // nothing was contested: the premium goes back too
      } else {
        received = held.buyIn; // a real draw returns the stake; the premium was spent
      }
      const chipsAfter = received > 0 ? await credit(tx, userId, received) : await balance(tx, userId);
      players[userId] = { net: received - held.buyIn - premium, chipsAfter, payout: received, premium, coverPaid };
    }

    await tx
      .update(wagers)
      .set({
        status: outcome === 'win' ? 'settled' : 'refunded',
        resultType: input.resultType,
        winnerUserId: outcome === 'win' ? input.winnerUserId : null,
        payout,
        rake,
        plies: input.plies,
        settledAt: new Date(),
      })
      .where(eq(wagers.matchId, matchId));

    return {
      matchId,
      venueTier: held.venueTier,
      buyIn: held.buyIn,
      outcome,
      players,
      payout,
      rake,
      whiteUserId: held.whiteUserId,
      blackUserId: held.blackUserId,
    };
  });
}

// Retries a failed settlement a few times (a transient DB hiccup must not leave
// chips in limbo); if it still fails the row stays 'held' and the sweeper below
// refunds it later, so nobody loses chips they did not lose in play.
export async function settleWagerWithRetry(matchId: string, input: SettleInput): Promise<SettledWager | null> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await settleWager(matchId, input);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  reportError(lastError, { area: 'wager-settle-failed', matchId });
  return null;
}

// Refunds every held wager older than `olderThanMs` that no live match owns.
// Covers a hard crash (matches live only in memory) and any settlement that
// kept failing. 35 minutes outlasts the longest possible match (10 min clock
// each side) plus the 60 s reconnect grace.
export async function sweepStaleWagers(olderThanMs: number, isLive: (matchId: string) => boolean): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const stale = await db
    .select({ matchId: wagers.matchId })
    .from(wagers)
    .where(and(eq(wagers.status, 'held'), lt(wagers.createdAt, cutoff)));
  let refunded = 0;
  for (const { matchId } of stale) {
    if (isLive(matchId)) continue;
    const result = await settleWager(matchId, { resultType: 'draw', winnerUserId: null, plies: 0, forceRefund: true });
    if (result) refunded++;
  }
  return refunded;
}
