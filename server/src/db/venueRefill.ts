import { eq } from 'drizzle-orm';

import { refillAmount } from '../adRewards.js';
import { redeemAdReward } from './adEvents.js';
import { db } from './client.js';
import { playerProfiles } from './schema/index.js';

export type RefillResult =
  | { status: 'ok'; chipsGranted: number; chips: number; gems: number }
  | { status: 'refill-not-needed' | 'daily-cap-reached' | 'not-verified' | 'profile-not-found' };

// Out-of-chips lifeline (see adRewards.ts: refillAmount). ONE transaction: the profile row is locked, the
// shortfall is computed from the LIVE balance, and only then is the watched ad redeemed (so an ad is never
// used up when nothing would be paid) and the chips credited. A player who can afford the cheapest venue
// gets 'refill-not-needed'; the daily cap and (in SSV mode) the verified view are enforced by redeemAdReward.
export async function redeemVenueRefill(userId: string, now = new Date()): Promise<RefillResult> {
  return db.transaction(async (tx): Promise<RefillResult> => {
    const [profile] = await tx.select({ chips: playerProfiles.chips }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).for('update');
    if (!profile) return { status: 'profile-not-found' };
    const amount = refillAmount(profile.chips);
    if (amount <= 0) return { status: 'refill-not-needed' };

    const outcome = await redeemAdReward(tx, userId, 'venue-refill', now);
    if (outcome !== 'ok') return { status: outcome };

    const [credited] = await tx
      .update(playerProfiles)
      .set({ chips: profile.chips + amount, updatedAt: now })
      .where(eq(playerProfiles.userId, userId))
      .returning({ chips: playerProfiles.chips, gems: playerProfiles.gems });
    return { status: 'ok', chipsGranted: amount, chips: credited.chips, gems: credited.gems };
  });
}
