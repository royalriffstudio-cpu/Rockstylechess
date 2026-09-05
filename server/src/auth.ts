import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';

import { asyncHandler } from './asyncHandler.js';
import { requireAuth } from './authMiddleware.js';
import { BOARD_THEMES } from './boardThemes.js';
import { chargeForAnalysis } from './db/analysisCharge.js';
import { purchaseCosmetic } from './db/cosmetics.js';
import { getMessages, listConversations, markRead } from './db/directMessages.js';
import {
  acceptRequest,
  declineOrCancelRequest,
  friendProfileOf,
  listFriends,
  listRequests,
  lookupByCode,
  removeFriend,
  sendRequest,
} from './db/friends.js';
import { levelForXp } from './leveling.js';
import { allMatches } from './match.js';
import { PIECE_SETS } from './pieceSets.js';
import { claimDailyBonus, getDailyBonusStatus } from './db/dailyBonus.js';
import { db } from './db/client.js';
import { claimQuest, getQuestsStatus, reportMatchForQuests, reportPuzzleSolvedForQuests } from './db/quests.js';
import { matchParticipants, matches, playerProfiles, userCosmetics, users } from './db/schema/index.js';
import { getSpinStatus, performSpin } from './db/spin.js';
import { emitToUser, onlineAmong } from './realtime.js';
import { MATCH_CHIP_REWARDS, MATCH_XP_REWARDS, type MatchOutcome } from './matchRewards.js';

// Query-param limit shared by /me/matches and /leaderboard -- clamps to a
// sane range so a client can't ask for an unbounded result set.
function clampLimit(raw: unknown, fallback: number, max: number): number {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : fallback;
}

export const authRouter = Router();

// Signup/login are now served by better-auth at POST /api/auth/sign-up/email
// and POST /api/auth/sign-in/email (see betterAuth.ts + index.ts's mount of
// toNodeHandler(auth)) -- everything below is unchanged.

// Used by pick-rockstar.tsx's "Let's Rock" step -- the stage name + chosen
// avatar are collected one screen after the account itself is created.
authRouter.patch(
  '/me/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { displayName, avatarId, equippedBoardId, equippedPieceId } = req.body ?? {};
    const updates: {
      displayName?: string;
      avatarId?: string;
      equippedBoardId?: string;
      equippedPieceId?: string;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };
    if (typeof displayName === 'string') updates.displayName = displayName.slice(0, 40);
    if (typeof avatarId === 'string') updates.avatarId = avatarId.slice(0, 40);
    if (typeof equippedBoardId === 'string') {
      const theme = BOARD_THEMES.find((t) => t.id === equippedBoardId);
      if (!theme) {
        res.status(400).json({ error: 'invalid-board-theme' });
        return;
      }
      if (theme.locked) {
        const [owned] = await db
          .select({ itemId: userCosmetics.itemId })
          .from(userCosmetics)
          .where(and(eq(userCosmetics.userId, req.userId as string), eq(userCosmetics.itemId, theme.id)))
          .limit(1);
        if (!owned) {
          res.status(400).json({ error: 'board-theme-not-owned' });
          return;
        }
      }
      updates.equippedBoardId = equippedBoardId;
    }
    if (typeof equippedPieceId === 'string') {
      const set = PIECE_SETS.find((s) => s.id === equippedPieceId);
      if (!set) {
        res.status(400).json({ error: 'invalid-piece-set' });
        return;
      }
      if (set.locked) {
        const [owned] = await db
          .select({ itemId: userCosmetics.itemId })
          .from(userCosmetics)
          .where(and(eq(userCosmetics.userId, req.userId as string), eq(userCosmetics.itemId, set.id)))
          .limit(1);
        if (!owned) {
          res.status(400).json({ error: 'piece-set-not-owned' });
          return;
        }
      }
      updates.equippedPieceId = equippedPieceId;
    }

    await db.update(playerProfiles).set(updates).where(eq(playerProfiles.userId, req.userId as string));
    res.json({ ok: true });
  }),
);

// The server has been computing rating/wins/losses/chips correctly since
// match persistence was wired up, but until now there was no way for the
// client to ever read any of it back -- signup/login/PATCH only ever wrote.
authRouter.get(
  '/me/profile',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [profile] = await db
      .select()
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, req.userId as string))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: 'profile-not-found' });
      return;
    }
    const owned = await db
      .select({ itemId: userCosmetics.itemId })
      .from(userCosmetics)
      .where(eq(userCosmetics.userId, req.userId as string));
    res.json({ profile: { ...profile, ownedCosmeticIds: owned.map((o) => o.itemId) } });
  }),
);

// Spend gems or chips (the client's choice) to own a locked cosmetic --
// currently only board themes are seeded/purchasable this way. See
// purchaseCosmetic for the atomic decrement + ownership-insert transaction.
authRouter.post(
  '/me/cosmetics/:itemId/unlock',
  requireAuth,
  asyncHandler(async (req, res) => {
    const currency = req.body?.currency;
    if (currency !== 'gems' && currency !== 'chips') {
      res.status(400).json({ error: 'invalid-currency' });
      return;
    }
    const result = await purchaseCosmetic(req.userId as string, req.params.itemId, currency);
    if (result.status === 'not-found') {
      res.status(400).json({ error: 'invalid-cosmetic-item' });
      return;
    }
    if (result.status === 'already-owned') {
      res.status(409).json({ error: 'already-owned' });
      return;
    }
    if (result.status === 'insufficient-funds') {
      res.status(400).json({
        error: 'insufficient-funds',
        currency: result.currency,
        price: result.price,
        balance: result.balance,
      });
      return;
    }
    res.json({
      ok: true,
      itemId: req.params.itemId,
      currency: result.currency,
      price: result.price,
      gems: result.gems,
      chips: result.chips,
    });
  }),
);

// Premium, paid action: Game Analysis (client-side Stockfish move review)
// charges chips or gems every time it's used -- no persistent "unlocked"
// record, deliberately (see analysisCharge.ts). Same response-mapping
// convention as /me/cosmetics/:itemId/unlock just above.
authRouter.post(
  '/me/analysis/charge',
  requireAuth,
  asyncHandler(async (req, res) => {
    const currency = req.body?.currency;
    if (currency !== 'chips' && currency !== 'gems') {
      res.status(400).json({ error: 'invalid-currency' });
      return;
    }
    const result = await chargeForAnalysis(req.userId as string, currency);
    if (result.status === 'insufficient-funds') {
      res.status(400).json({
        error: 'insufficient-funds',
        currency: result.currency,
        price: result.price,
        balance: result.balance,
      });
      return;
    }
    res.json({ ok: true, currency: result.currency, price: result.price, chips: result.chips, gems: result.gems });
  }),
);

// Bot/local matches never reach the server otherwise (pure client-side
// chess.js, called from match.tsx's handleGameOver) -- this is the only
// point a reward gets persisted for those modes. Only the outcome claim is
// trusted, never a client-supplied amount, but there's no server-side match
// record for bot/local play to validate the claim itself against, unlike
// online matches (credited authoritatively in persistMatchResult.ts, which
// never calls this route). Acceptable for now since chips aren't redeemable
// for anything real anywhere in the app.
authRouter.post(
  '/me/match-reward',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { outcome } = req.body ?? {};
    if (outcome !== 'win' && outcome !== 'loss' && outcome !== 'draw') {
      res.status(400).json({ error: 'invalid-outcome' });
      return;
    }

    const chipsGranted = MATCH_CHIP_REWARDS[outcome as MatchOutcome];
    const xpGranted = MATCH_XP_REWARDS[outcome as MatchOutcome];
    const [updated] = await db
      .update(playerProfiles)
      .set({
        chips: sql`${playerProfiles.chips} + ${chipsGranted}`,
        xp: sql`${playerProfiles.xp} + ${xpGranted}`,
        updatedAt: new Date(),
      })
      .where(eq(playerProfiles.userId, req.userId as string))
      .returning({ chips: playerProfiles.chips, xp: playerProfiles.xp });
    if (!updated) {
      res.status(404).json({ error: 'profile-not-found' });
      return;
    }
    // level is purely derivative of xp -- recomputed from the post-increment
    // value returned above rather than folded into the same SQL expression,
    // so the curve formula (leveling.ts) has exactly one implementation, not
    // a second copy embedded in a raw SQL expression. This is a second
    // statement rather than one transaction: a race between two concurrent
    // grants for the same user could leave level briefly behind what xp
    // implies, which self-corrects on the next grant. Accepted deliberately,
    // same tradeoff spin.ts/dailyBonus.ts already accept for grants (as
    // opposed to purchaseCosmetic's transaction, which is a genuine spend
    // that can't tolerate it).
    const level = levelForXp(updated.xp);
    await db.update(playerProfiles).set({ level }).where(eq(playerProfiles.userId, req.userId as string));
    res.json({ ok: true, chipsGranted, chips: updated.chips, xpGranted, xp: updated.xp, level });
  }),
);

authRouter.get(
  '/me/daily-bonus/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getDailyBonusStatus(req.userId as string));
  }),
);

authRouter.post(
  '/me/daily-bonus/claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimDailyBonus(req.userId as string);
    if (result.alreadyClaimed) {
      res.status(409).json({ error: 'already-claimed-today', day: result.day, streak: result.streak });
      return;
    }
    res.json({
      ok: true,
      day: result.day,
      streak: result.streak,
      chipsGranted: result.chipsGranted,
      gemsGranted: result.gemsGranted,
      chips: result.chips,
      gems: result.gems,
    });
  }),
);

authRouter.get(
  '/me/spin/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getSpinStatus(req.userId as string));
  }),
);

authRouter.post(
  '/me/spin',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await performSpin(req.userId as string);
    if (result.alreadySpun) {
      res.status(409).json({ error: 'already-spun-today' });
      return;
    }
    res.json({
      ok: true,
      prizeId: result.prize.id,
      label: result.prize.label,
      rewardType: result.prize.rewardType,
      rewardAmount: result.prize.rewardAmount,
      chips: result.chips,
      gems: result.gems,
    });
  }),
);

authRouter.get(
  '/me/quests',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ quests: await getQuestsStatus(req.userId as string) });
  }),
);

authRouter.post(
  '/me/quests/:questId/claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimQuest(req.userId as string, req.params.questId);
    if (result.status === 'not-found') {
      res.status(404).json({ error: 'quest-not-found' });
      return;
    }
    if (result.status === 'not-complete') {
      res.status(400).json({ error: 'quest-not-complete' });
      return;
    }
    if (result.status === 'already-claimed') {
      res.status(409).json({ error: 'already-claimed' });
      return;
    }
    res.json({ ok: true, chipsGranted: result.rewardChips, chips: result.chips });
  }),
);

// Bot/local matches never reach the server otherwise (pure client-side
// chess.js), same reason POST /me/match-reward exists -- see that route's
// comment for the accepted trust tradeoff (client-reported, not validated
// against a server-side match record). Never called for online matches:
// those get their quest progress from persistMatchResult.ts instead, computed
// server-side from the authoritative PGN.
authRouter.post(
  '/me/quests/report-match',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { won, checkmate, capturedCount } = req.body ?? {};
    if (typeof won !== 'boolean' || typeof checkmate !== 'boolean' || typeof capturedCount !== 'number') {
      res.status(400).json({ error: 'invalid-report' });
      return;
    }
    await reportMatchForQuests(req.userId as string, { won, checkmate, capturedCount: Math.max(0, Math.floor(capturedCount)) });
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/me/quests/report-puzzle-solved',
  requireAuth,
  asyncHandler(async (req, res) => {
    await reportPuzzleSolvedForQuests(req.userId as string);
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me/matches',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const limit = clampLimit(req.query.limit, 20, 100);

    const rows = await db
      .select({
        matchId: matchParticipants.matchId,
        color: matchParticipants.color,
        outcome: matchParticipants.outcome,
        ratingBefore: matchParticipants.ratingBefore,
        ratingAfter: matchParticipants.ratingAfter,
        ratingDelta: matchParticipants.ratingDelta,
        playedAt: matches.endedAt,
        mode: matches.mode,
        resultType: matches.resultType,
        whiteUserId: matches.whiteUserId,
        blackUserId: matches.blackUserId,
      })
      .from(matchParticipants)
      .innerJoin(matches, eq(matchParticipants.matchId, matches.id))
      .where(eq(matchParticipants.userId, userId))
      .orderBy(desc(matches.endedAt))
      .limit(limit);

    // Batched second query for opponent display names rather than an outer
    // join per row -- there are at most `limit` distinct opponents to look up.
    const opponentIds = [
      ...new Set(
        rows
          .map((row) => (row.color === 'w' ? row.blackUserId : row.whiteUserId))
          .filter((id): id is string => id !== null),
      ),
    ];
    const opponentProfiles = opponentIds.length
      ? await db
          .select({ userId: playerProfiles.userId, displayName: playerProfiles.displayName })
          .from(playerProfiles)
          .where(inArray(playerProfiles.userId, opponentIds))
      : [];
    const opponentNameByUserId = new Map(opponentProfiles.map((p) => [p.userId, p.displayName]));

    res.json({
      matches: rows.map((row) => {
        const opponentUserId = row.color === 'w' ? row.blackUserId : row.whiteUserId;
        return {
          matchId: row.matchId,
          playedAt: row.playedAt,
          mode: row.mode,
          resultType: row.resultType,
          color: row.color,
          outcome: row.outcome,
          ratingBefore: row.ratingBefore,
          ratingAfter: row.ratingAfter,
          ratingDelta: row.ratingDelta,
          opponentDisplayName: (opponentUserId && opponentNameByUserId.get(opponentUserId)) || 'Unknown',
        };
      }),
    });
  }),
);

// Backs the replay screen -- deliberately minimal (just the two columns a
// future replay needs), since everything else about the match (opponent
// name, result, color, date) is already in the MatchHistoryEntry the client
// tapped to get here, passed through as route params instead of re-fetched.
// Authorization mirrors /me/matches above: joins through matchParticipants
// rather than comparing matches.whiteUserId/blackUserId directly, since
// those get nulled out on account deletion (see DELETE /me below) while the
// OTHER player's matchParticipants row still correctly references the match.
authRouter.get(
  '/me/matches/:matchId/replay',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const { matchId } = req.params;

    const [participant] = await db
      .select({ matchId: matchParticipants.matchId })
      .from(matchParticipants)
      .where(and(eq(matchParticipants.matchId, matchId), eq(matchParticipants.userId, userId)))
      .limit(1);
    if (!participant) {
      res.status(404).json({ error: 'not-found' });
      return;
    }

    const [match] = await db
      .select({ pgn: matches.pgn, moveElapsedMs: matches.moveElapsedMs })
      .from(matches)
      .where(eq(matches.id, matchId))
      .limit(1);

    res.json({ pgn: match?.pgn ?? null, moveElapsedMs: match?.moveElapsedMs ?? null });
  }),
);

// Maps account-security.tsx's "Delete Account" button.
authRouter.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;

    // matches.white/blackUserId deliberately has no onDelete cascade (see
    // db/schema/matches.ts) -- deleting a user who's played matches should
    // preserve the match/rating record for whoever they played against,
    // not force it to vanish too. Null out the reference on those rows
    // instead of deleting them; everything else that's actually this
    // user's own data (profile, their own match_participants rows, and
    // any future purchases/social rows -- all `onDelete: 'cascade'`) goes
    // via the users row cascade below. One transaction so a mid-way
    // failure can't leave a half-deleted account.
    await db.transaction(async (tx) => {
      await tx.update(matches).set({ whiteUserId: null }).where(eq(matches.whiteUserId, userId));
      await tx.update(matches).set({ blackUserId: null }).where(eq(matches.blackUserId, userId));
      await tx.delete(users).where(eq(users.id, userId));
    });

    res.json({ ok: true });
  }),
);

// Public -- no requireAuth. Plain ORDER BY on player_profiles.rating, per
// the original schema design (no separate leaderboard table to keep in sync).
// Secondary sort on userId -- rating alone has no deterministic order for
// ties, which would otherwise let equal-rated players visibly reshuffle
// between requests.
authRouter.get(
  '/leaderboard',
  asyncHandler(async (req, res) => {
    const limit = clampLimit(req.query.limit, 50, 100);
    const rows = await db
      .select({
        userId: playerProfiles.userId,
        displayName: playerProfiles.displayName,
        avatarId: playerProfiles.avatarId,
        rating: playerProfiles.rating,
        wins: playerProfiles.wins,
        losses: playerProfiles.losses,
        draws: playerProfiles.draws,
      })
      .from(playerProfiles)
      .orderBy(desc(playerProfiles.rating), asc(playerProfiles.userId))
      .limit(limit);
    res.json({ leaderboard: rows });
  }),
);

// Reports the caller's own position even when it falls outside /leaderboard's
// top page -- deliberately minimal (just rank + total) since every other
// field the "YOU" card needs (rating, displayName, avatarId, wins/losses/
// draws) already comes from GET /me/profile; the client combines both
// rather than this endpoint duplicating profile fields.
authRouter.get(
  '/leaderboard/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const [profile] = await db
      .select({ rating: playerProfiles.rating })
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, userId))
      .limit(1);
    if (!profile) {
      res.status(404).json({ error: 'profile-not-found' });
      return;
    }

    const [{ higherRated }] = await db
      .select({ higherRated: count() })
      .from(playerProfiles)
      .where(gt(playerProfiles.rating, profile.rating));
    const [{ totalPlayers }] = await db.select({ totalPlayers: count() }).from(playerProfiles);

    res.json({ rank: higherRated + 1, totalPlayers });
  }),
);

// ---------------------------------------------------------------------------
// Friends + direct messages
//
// Friendship rows are stored canonically ordered in db/friends.ts; DM threads
// live in db/directMessages.ts. Realtime deltas (a request arriving, a friend
// coming online, a DM) are pushed via realtime.ts's emitToUser -- the socket
// handlers for challenges and dm:send live in index.ts. Guests can't reach any
// of this (requireAuth 401s; the client hides the screens).
// ---------------------------------------------------------------------------

// userIds currently seated in a live match -- drives the friends list's
// "in-game" status. Cheap: at most a few dozen live matches in memory.
function inGameUserIds(): Set<string> {
  const ids = new Set<string>();
  for (const match of allMatches()) {
    for (const color of ['w', 'b'] as const) {
      const uid = match.players[color].userId;
      if (uid) ids.add(uid);
    }
  }
  return ids;
}

authRouter.get(
  '/me/friends',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const friends = await listFriends(userId);
    const online = onlineAmong(friends.map((f) => f.userId));
    const inGame = inGameUserIds();
    res.json({
      friends: friends.map((f) => ({
        userId: f.userId,
        displayName: f.displayName,
        avatarId: f.avatarId,
        rating: f.rating,
        level: f.level,
        online: online.has(f.userId),
        inGame: inGame.has(f.userId),
      })),
    });
  }),
);

authRouter.get(
  '/me/friends/requests',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await listRequests(req.userId as string));
  }),
);

// Preview a friend code before actually sending a request, so the "Add Friend"
// UI can show who it's about to add. Never leaks the code back or anything not
// already public on the leaderboard.
authRouter.get(
  '/me/friends/lookup',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    if (!code.trim()) {
      res.status(400).json({ error: 'missing-code' });
      return;
    }
    const user = await lookupByCode(code);
    if (!user || user.userId === userId) {
      res.json({ user: null });
      return;
    }
    res.json({
      user: { userId: user.userId, displayName: user.displayName, avatarId: user.avatarId, rating: user.rating },
    });
  }),
);

authRouter.post(
  '/me/friends/request',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const friendCode = typeof req.body?.friendCode === 'string' ? req.body.friendCode : undefined;
    const targetUserId = typeof req.body?.userId === 'string' ? req.body.userId : undefined;
    if (!friendCode && !targetUserId) {
      res.status(400).json({ error: 'missing-target' });
      return;
    }

    const result = await sendRequest(userId, { code: friendCode, userId: targetUserId });
    if (result.status === 'not-found') {
      res.status(404).json({ error: 'user-not-found' });
      return;
    }
    if (result.status === 'self') {
      res.status(400).json({ error: 'cannot-friend-self' });
      return;
    }
    if (result.status === 'already-friends') {
      res.status(409).json({ error: 'already-friends' });
      return;
    }
    if (result.status === 'already-pending') {
      res.status(409).json({ error: 'already-pending' });
      return;
    }
    if (result.status === 'blocked') {
      res.status(403).json({ error: 'blocked' });
      return;
    }

    const me = await friendProfileOf(userId);
    if (me) {
      // accepted === true means the target had already requested us -- tell
      // them it's now a friendship, not a fresh incoming request.
      emitToUser(result.friend.userId, result.accepted ? 'friend:request:accepted' : 'friend:request', { friend: me });
    }
    res.json({ ok: true, accepted: result.accepted, friend: result.friend });
  }),
);

authRouter.post(
  '/me/friends/:userId/accept',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const result = await acceptRequest(userId, req.params.userId);
    if (result.status === 'no-request') {
      res.status(404).json({ error: 'no-request' });
      return;
    }
    const me = await friendProfileOf(userId);
    if (me) emitToUser(req.params.userId, 'friend:request:accepted', { friend: me });
    res.json({ ok: true, friend: result.friend });
  }),
);

// Decline an incoming request OR cancel one you sent -- same effect, drop the
// pending row. Idempotent.
authRouter.post(
  '/me/friends/:userId/decline',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    await declineOrCancelRequest(userId, req.params.userId);
    emitToUser(req.params.userId, 'friend:request:withdrawn', { userId });
    res.json({ ok: true });
  }),
);

authRouter.delete(
  '/me/friends/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    await removeFriend(userId, req.params.userId);
    emitToUser(req.params.userId, 'friend:removed', { userId });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me/conversations',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const summaries = await listConversations(userId);
    const online = onlineAmong(summaries.map((s) => s.user.userId));
    res.json({
      conversations: summaries.map((s) => ({
        userId: s.user.userId,
        displayName: s.user.displayName,
        avatarId: s.user.avatarId,
        rating: s.user.rating,
        online: online.has(s.user.userId),
        lastMessage: s.lastMessage,
        unreadCount: s.unreadCount,
      })),
    });
  }),
);

authRouter.get(
  '/me/conversations/:userId/messages',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const result = await getMessages(userId, req.params.userId, {
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      before: typeof req.query.before === 'string' ? req.query.before : undefined,
    });
    if (result.status === 'not-friends') {
      res.status(403).json({ error: 'not-friends' });
      return;
    }
    res.json({
      messages: result.messages.map((m) => ({
        id: m.id,
        senderUserId: m.senderUserId,
        text: m.text,
        sentAt: m.sentAt,
        readAt: m.readAt,
        mine: m.senderUserId === userId,
      })),
    });
  }),
);

authRouter.post(
  '/me/conversations/:userId/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    await markRead(req.userId as string, req.params.userId);
    res.json({ ok: true });
  }),
);
