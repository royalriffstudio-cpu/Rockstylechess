import { and, eq } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { ratingTier, type RatingTier } from '../tier.js';
import { isUserOnline } from '../realtime.js';
import { db } from './client.js';
import { orderPair } from './friends.js';
import { titleById } from './progression.js';
import { friendships, matchParticipants, playerProfiles } from './schema/index.js';

// What one player may see of another (tap an opponent's name in a match, on the result screen, in the
// friends list or the rankings). Deliberately public-only: no chips, gems, friend code, e-mail or
// anything that could be spent or abused. A blocked pair (either direction) sees nothing: the profile
// answers "not found", so blocking cannot be probed.

export type Relation = 'self' | 'friends' | 'outgoing' | 'incoming' | 'none';

export interface PublicProfile {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number;
  tier: RatingTier;
  level: number;
  title: { id: string; name: string } | null;
  wins: number;
  losses: number;
  draws: number;
  gamesPlayed: number;
  winRate: number | null; // 0..1, null before the first finished game
  online: boolean;
  relation: Relation;
  // Every finished online game between the viewer and this player (rated, wagered or friendly).
  headToHead: null | { games: number; yourWins: number; theirWins: number; draws: number };
}

export async function getPublicProfile(viewerId: string, targetId: string): Promise<PublicProfile | null> {
  const [profile] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, targetId)).limit(1);
  if (!profile) return null;

  let relation: Relation = 'none';
  if (viewerId === targetId) {
    relation = 'self';
  } else {
    const [lo, hi] = orderPair(viewerId, targetId);
    const [row] = await db
      .select({ status: friendships.status, requestedBy: friendships.requestedBy })
      .from(friendships)
      .where(and(eq(friendships.userId, lo), eq(friendships.friendUserId, hi)))
      .limit(1);
    if (row?.status === 'blocked') return null;
    if (row?.status === 'accepted') relation = 'friends';
    else if (row?.status === 'pending') relation = row.requestedBy === viewerId ? 'outgoing' : 'incoming';
  }

  let headToHead: PublicProfile['headToHead'] = null;
  if (relation !== 'self') {
    const mine = alias(matchParticipants, 'mine');
    const theirs = alias(matchParticipants, 'theirs');
    const rows = await db
      .select({ outcome: mine.outcome })
      .from(mine)
      .innerJoin(theirs, eq(theirs.matchId, mine.matchId))
      .where(and(eq(mine.userId, viewerId), eq(theirs.userId, targetId)));
    if (rows.length > 0) {
      headToHead = {
        games: rows.length,
        yourWins: rows.filter((r) => r.outcome === 'win').length,
        theirWins: rows.filter((r) => r.outcome === 'loss').length,
        draws: rows.filter((r) => r.outcome === 'draw').length,
      };
    }
  }

  const gamesPlayed = profile.wins + profile.losses + profile.draws;
  const title = titleById(profile.equippedTitleId);
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    avatarId: profile.avatarId,
    country: profile.country,
    rating: profile.rating,
    tier: ratingTier(profile.rating),
    level: profile.level,
    title: title ? { id: title.id, name: title.name } : null,
    wins: profile.wins,
    losses: profile.losses,
    draws: profile.draws,
    gamesPlayed,
    winRate: gamesPlayed > 0 ? profile.wins / gamesPlayed : null,
    online: isUserOnline(targetId),
    relation,
    headToHead,
  };
}
