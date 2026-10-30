import { eq, sql } from 'drizzle-orm';

import { ECONOMY } from '../economy.generated.js';
import { db } from './client.js';
import { playerProfiles, users } from './schema/index.js';

// The soft email gate. A NEW email/password account stays "unverified" until it enters the code mailed to it; until
// then it can play bots, puzzles and the Tour but not online matches, friends or chat, and its welcome bonus is held.
// Existing accounts (users.email_grandfathered, set by migration 0022), Google accounts and the local test domain
// are never gated. All of it hangs on EMAIL_GATE: with the flag off nothing here changes game behaviour, so the
// server can ship before the mail domain exists.

export function emailGateEnabled(): boolean {
  const v = process.env.EMAIL_GATE;
  return v === '1' || v === 'true';
}

const CACHE_MS = 15_000;
const cache = new Map<string, { needs: boolean; at: number }>();

/** True when this account must verify its email before using online features. */
export async function needsEmailVerification(userId: string, now = Date.now()): Promise<boolean> {
  if (!emailGateEnabled()) return false;
  const hit = cache.get(userId);
  if (hit && now - hit.at < CACHE_MS) return hit.needs;
  const [row] = await db
    .select({ verified: users.emailVerified, grandfathered: users.emailGrandfathered })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const needs = row ? !row.verified && !row.grandfathered : false;
  cache.set(userId, { needs, at: now });
  return needs;
}

export function forgetEmailGateCache(userId: string): void {
  cache.delete(userId);
}

/**
 * Pays the held welcome bonus exactly once. One conditional UPDATE both clears the flag and credits the chips, so
 * two verifications racing (or a repeat call) can never pay twice. Returns whether this call paid.
 */
export async function grantWelcomeBonus(userId: string): Promise<boolean> {
  const rows = await db
    .update(playerProfiles)
    .set({ chips: sql`${playerProfiles.chips} + ${ECONOMY.welcomeChips}`, welcomeBonusPending: false })
    .where(sql`${playerProfiles.userId} = ${userId} AND ${playerProfiles.welcomeBonusPending} = true`)
    .returning({ userId: playerProfiles.userId });
  return rows.length > 0;
}
