import { and, eq } from 'drizzle-orm';

import { db } from './client.js';
import { orderPair, profilesByIds, type FriendProfile } from './friends.js';
import { friendships, reportReasonEnum, reports } from './schema/index.js';

export type ReportReason = (typeof reportReasonEnum.enumValues)[number];

export function isValidReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (reportReasonEnum.enumValues as readonly string[]).includes(value);
}

export async function submitReport(
  reporterId: string,
  reportedUserId: string,
  reason: ReportReason,
  details?: string,
  matchId?: string,
): Promise<{ status: 'ok' }> {
  await db.insert(reports).values({
    reporterId,
    reportedUserId,
    reason,
    details: details?.slice(0, 1000) || null,
    matchId: matchId ?? null,
  });
  return { status: 'ok' };
}

// Blocking reuses the same friendships table/pair-row as friend requests --
// 'blocked' is a third status alongside 'pending'/'accepted' that's existed
// in the schema/enum since the start but had no code path setting it until
// now. requestedBy is reused to mean "who did the blocking" (same field
// that already means "who sent the request" for pending rows) so
// unblockUser can tell the two directions apart -- you can't unblock
// someone who blocked *you*.
export async function blockUser(me: string, targetUserId: string): Promise<{ status: 'ok' }> {
  const [lo, hi] = orderPair(me, targetUserId);
  const [existing] = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)))
    .limit(1);

  if (existing) {
    await db
      .update(friendships)
      .set({ status: 'blocked', requestedBy: me, updatedAt: new Date() })
      .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)));
  } else {
    await db.insert(friendships).values({ userId: lo, friendUserId: hi, status: 'blocked', requestedBy: me });
  }
  return { status: 'ok' };
}

export type UnblockResult = { status: 'ok' } | { status: 'not-blocked-by-you' };

export async function unblockUser(me: string, targetUserId: string): Promise<UnblockResult> {
  const [lo, hi] = orderPair(me, targetUserId);
  const [row] = await db
    .select({ status: friendships.status, requestedBy: friendships.requestedBy })
    .from(friendships)
    .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)))
    .limit(1);
  if (!row || row.status !== 'blocked' || row.requestedBy !== me) return { status: 'not-blocked-by-you' };

  await db.delete(friendships).where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)));
  return { status: 'ok' };
}

export async function isBlocked(a: string, b: string): Promise<boolean> {
  const [lo, hi] = orderPair(a, b);
  const [row] = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)))
    .limit(1);
  return row?.status === 'blocked';
}

export async function listBlocked(me: string): Promise<FriendProfile[]> {
  const rows = await db
    .select({ userId: friendships.userId, friendUserId: friendships.friendUserId })
    .from(friendships)
    .where(and(eq(friendships.status, 'blocked'), eq(friendships.requestedBy, me)));
  const otherIdOf = (r: (typeof rows)[number]) => (r.userId === me ? r.friendUserId : r.userId);
  const ids = rows.map(otherIdOf);
  const profiles = await profilesByIds(ids);
  return ids.map((id) => profiles.get(id)).filter((p): p is FriendProfile => p !== undefined);
}
