import { and, eq, inArray, or } from 'drizzle-orm';

import { randomCode } from '../codeAlphabet.js';
import { db } from './client.js';
import { friendships, playerProfiles } from './schema/index.js';

const FRIEND_CODE_LENGTH = 8;

// A friendship row is stored with the smaller UUID first (see
// schema/social.ts) so A<->B is one row no matter who asked. Every read/write
// below normalises through this.
export function orderPair(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

export interface FriendProfile {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  rating: number;
  level: number;
}

const FRIEND_PROFILE_COLUMNS = {
  userId: playerProfiles.userId,
  displayName: playerProfiles.displayName,
  avatarId: playerProfiles.avatarId,
  rating: playerProfiles.rating,
  level: playerProfiles.level,
} as const;

async function profilesByIds(ids: string[]): Promise<Map<string, FriendProfile>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select(FRIEND_PROFILE_COLUMNS)
    .from(playerProfiles)
    .where(inArray(playerProfiles.userId, ids));
  return new Map(rows.map((r) => [r.userId, r]));
}

/** Generate a fresh unique friend code. Collision odds are negligible at
 *  this scale; the retry loop + column unique constraint cover it anyway. */
export async function generateFriendCode(): Promise<string> {
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode(FRIEND_CODE_LENGTH);
    const [taken] = await db
      .select({ userId: playerProfiles.userId })
      .from(playerProfiles)
      .where(eq(playerProfiles.friendCode, code))
      .limit(1);
    if (!taken) return code;
  }
  // Astronomically unlikely; fall back to a longer code rather than throw.
  return randomCode(FRIEND_CODE_LENGTH + 4);
}

export async function friendProfileOf(userId: string): Promise<FriendProfile | null> {
  return (await profilesByIds([userId])).get(userId) ?? null;
}

export async function friendCodeFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ friendCode: playerProfiles.friendCode })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  return row?.friendCode ?? null;
}

export async function lookupByCode(code: string): Promise<FriendProfile | null> {
  const normalized = code.trim().toUpperCase();
  if (!normalized) return null;
  const [row] = await db
    .select(FRIEND_PROFILE_COLUMNS)
    .from(playerProfiles)
    .where(eq(playerProfiles.friendCode, normalized))
    .limit(1);
  return row ?? null;
}

export async function areFriends(a: string, b: string): Promise<boolean> {
  const [lo, hi] = orderPair(a, b);
  const [row] = await db
    .select({ status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)))
    .limit(1);
  return row?.status === 'accepted';
}

/** userIds of everyone `me` has an accepted friendship with. */
export async function friendIdsOf(me: string): Promise<string[]> {
  const rows = await db
    .select({ userId: friendships.userId, friendUserId: friendships.friendUserId })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'accepted'),
        or(eq(friendships.userId, me), eq(friendships.friendUserId, me)),
      ),
    );
  return rows.map((r) => (r.userId === me ? r.friendUserId : r.userId));
}

export async function listFriends(me: string): Promise<FriendProfile[]> {
  const ids = await friendIdsOf(me);
  const profiles = await profilesByIds(ids);
  return ids
    .map((id) => profiles.get(id))
    .filter((p): p is FriendProfile => p !== undefined)
    .sort((a, b) => b.rating - a.rating);
}

export interface PendingRequest extends FriendProfile {
  requestedAt: Date;
}

export async function listRequests(me: string): Promise<{ incoming: PendingRequest[]; outgoing: PendingRequest[] }> {
  const rows = await db
    .select({
      userId: friendships.userId,
      friendUserId: friendships.friendUserId,
      requestedBy: friendships.requestedBy,
      createdAt: friendships.createdAt,
    })
    .from(friendships)
    .where(
      and(
        eq(friendships.status, 'pending'),
        or(eq(friendships.userId, me), eq(friendships.friendUserId, me)),
      ),
    );

  const otherIdOf = (r: (typeof rows)[number]) => (r.userId === me ? r.friendUserId : r.userId);
  const profiles = await profilesByIds(rows.map(otherIdOf));

  const build = (predicate: (r: (typeof rows)[number]) => boolean): PendingRequest[] =>
    rows
      .filter(predicate)
      .map((r) => {
        const profile = profiles.get(otherIdOf(r));
        return profile ? { ...profile, requestedAt: r.createdAt } : null;
      })
      .filter((p): p is PendingRequest => p !== null)
      .sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());

  return {
    incoming: build((r) => r.requestedBy !== me),
    outgoing: build((r) => r.requestedBy === me),
  };
}

export type SendRequestResult =
  | { status: 'ok'; accepted: boolean; friend: FriendProfile }
  | { status: 'not-found' }
  | { status: 'self' }
  | { status: 'already-friends' }
  | { status: 'already-pending' }
  | { status: 'blocked' };

/** Send a friend request by friend code or by explicit userId (the latter for
 *  the leaderboard / post-game "Add Friend" buttons). If the target has
 *  already requested `me`, this accepts instead (`accepted: true`). */
export async function sendRequest(me: string, target: { code?: string; userId?: string }): Promise<SendRequestResult> {
  let targetProfile: FriendProfile | null = null;
  if (target.userId) {
    targetProfile = (await profilesByIds([target.userId])).get(target.userId) ?? null;
  } else if (target.code) {
    targetProfile = await lookupByCode(target.code);
  }
  if (!targetProfile) return { status: 'not-found' };
  if (targetProfile.userId === me) return { status: 'self' };

  const [lo, hi] = orderPair(me, targetProfile.userId);
  const [existing] = await db
    .select({ status: friendships.status, requestedBy: friendships.requestedBy })
    .from(friendships)
    .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)))
    .limit(1);

  if (existing) {
    if (existing.status === 'accepted') return { status: 'already-friends' };
    if (existing.status === 'blocked') return { status: 'blocked' };
    // pending
    if (existing.requestedBy === me) return { status: 'already-pending' };
    // They already asked -- treat "add them back" as accepting.
    await db
      .update(friendships)
      .set({ status: 'accepted', updatedAt: new Date() })
      .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)));
    return { status: 'ok', accepted: true, friend: targetProfile };
  }

  await db.insert(friendships).values({ userId: lo, friendUserId: hi, status: 'pending', requestedBy: me });
  return { status: 'ok', accepted: false, friend: targetProfile };
}

export type RespondResult = { status: 'ok'; friend: FriendProfile } | { status: 'no-request' };

/** Accept a pending request the other user sent to `me`. */
export async function acceptRequest(me: string, otherUserId: string): Promise<RespondResult> {
  const [lo, hi] = orderPair(me, otherUserId);
  const [row] = await db
    .select({ requestedBy: friendships.requestedBy, status: friendships.status })
    .from(friendships)
    .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)))
    .limit(1);
  if (!row || row.status !== 'pending' || row.requestedBy === me) return { status: 'no-request' };

  await db
    .update(friendships)
    .set({ status: 'accepted', updatedAt: new Date() })
    .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)));

  const friend = (await profilesByIds([otherUserId])).get(otherUserId);
  if (!friend) return { status: 'no-request' };
  return { status: 'ok', friend };
}

/** Decline an incoming request or cancel an outgoing one -- either way, drop
 *  the pending row. Returns ok even if there was nothing to drop (idempotent). */
export async function declineOrCancelRequest(me: string, otherUserId: string): Promise<{ status: 'ok' }> {
  const [lo, hi] = orderPair(me, otherUserId);
  await db
    .delete(friendships)
    .where(
      and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi), eq(friendships.status, 'pending')),
    );
  return { status: 'ok' };
}

export async function removeFriend(me: string, otherUserId: string): Promise<{ status: 'ok' }> {
  const [lo, hi] = orderPair(me, otherUserId);
  await db
    .delete(friendships)
    .where(
      and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi), eq(friendships.status, 'accepted')),
    );
  return { status: 'ok' };
}
