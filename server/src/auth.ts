import { and, asc, count, desc, eq, gt, inArray, sql } from 'drizzle-orm';
import { Router } from 'express';

import { asyncHandler } from './asyncHandler.js';
import { FREE_AVATAR_IDS, getPremiumAvatar, UNLOCK_ALL_AVATARS } from './avatars.js';
import { requireAuth } from './authMiddleware.js';
import { BOARD_THEMES } from './boardThemes.js';
import { isValidCountryCode } from './countryCodes.js';
import { ADS_REQUIRE_SSV, AD_PLACEMENTS } from './adRewards.js';
import { verifyAdMobSsv } from './adsSsv.js';
import { chargeForAnalysis } from './db/analysisCharge.js';
import { getAdStatus, recordVerifiedAdView, redeemAdReward } from './db/adEvents.js';
import {
  claimAchievement,
  getAchievementsStatus,
  reportMatchForAchievements,
  reportPuzzleSolvedForAchievements,
} from './db/achievements.js';
import { deleteUserAccount } from './db/accountDeletion.js';
import { purchaseCosmetic } from './db/cosmetics.js';
import { getMessages, listConversations, markRead } from './db/directMessages.js';
import { blockUser, isValidReportReason, listBlocked, submitReport, unblockUser } from './db/moderation.js';
import { creditVerifiedPurchase, grantEntitlement } from './db/purchases.js';
import { acknowledgeAndConsume, acknowledgePurchase, verifyProductPurchase } from './googlePlay.js';
import { getEntitlementProductById, getPackById } from './iapCatalog.js';
import {
  getNotifications,
  getUnreadNotificationCount,
  insertNotification,
  markAllNotificationsRead,
  markNotificationRead,
} from './db/notifications.js';
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
import { allMatches, liveClockRemaining } from './match.js';
import { PIECE_SETS } from './pieceSets.js';
import { claimDailyBonus, getDailyBonusStatus } from './db/dailyBonus.js';
import { db } from './db/client.js';
import { ENDED_BY, finishBotSession, startBotSession } from './db/botSessions.js';
import { applyTour, getTour } from './db/tour.js';
import { getOwnedTitleIds, getUnseenCelebrations, grantFame, markProgressionSeen, TITLES } from './db/progression.js';
import { claimQuest, getQuestsStatus, reportPuzzleSolvedForQuests } from './db/quests.js';
import { matchParticipants, matches, playerProfiles, userCosmetics, users } from './db/schema/index.js';
import { getSpinStatus, performSpin } from './db/spin.js';
import { emitToUser, onlineAmong } from './realtime.js';

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
    const { displayName, avatarId, equippedBoardId, equippedPieceId, country } = req.body ?? {};
    const updates: {
      displayName?: string;
      avatarId?: string;
      equippedBoardId?: string;
      equippedPieceId?: string;
      country?: string;
      updatedAt: Date;
    } = {
      updatedAt: new Date(),
    };
    if (typeof displayName === 'string') updates.displayName = displayName.slice(0, 40);
    // avatarId is validated against the avatar catalog: the 12 free Garage Band
    // badges are always equippable, premium (Main Stage / Hall of Fame) ones only
    // when owned. Re-saving the avatar the player already has is always allowed
    // so a legacy/unknown stored id can't wedge an unrelated profile edit.
    if (typeof avatarId === 'string') {
      const id = avatarId.slice(0, 40);
      if (!FREE_AVATAR_IDS.has(id)) {
        const [current] = await db
          .select({ avatarId: playerProfiles.avatarId })
          .from(playerProfiles)
          .where(eq(playerProfiles.userId, req.userId as string))
          .limit(1);
        if (current?.avatarId !== id) {
          if (!getPremiumAvatar(id)) {
            res.status(400).json({ error: 'invalid-avatar' });
            return;
          }
          if (!UNLOCK_ALL_AVATARS) {
            const [owned] = await db
              .select({ itemId: userCosmetics.itemId })
              .from(userCosmetics)
              .where(and(eq(userCosmetics.userId, req.userId as string), eq(userCosmetics.itemId, id)))
              .limit(1);
            if (!owned) {
              res.status(400).json({ error: 'avatar-not-owned' });
              return;
            }
          }
        }
      }
      updates.avatarId = id;
    }
    // Unlike the open-ended cosmetic ids, country is a closed ISO-3166-1
    // alpha-2 set -- reject anything that isn't a real code rather than
    // storing it blindly.
    if (typeof country === 'string') {
      const normalized = country.toUpperCase();
      if (!isValidCountryCode(normalized)) {
        res.status(400).json({ error: 'invalid-country-code' });
        return;
      }
      updates.country = normalized;
    }
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
// board themes, piece sets and premium avatars are purchasable this way. See
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
    if (result.status === 'not-purchasable') {
      res.status(400).json({ error: 'not-purchasable' });
      return;
    }
    if (result.status === 'currency-not-allowed') {
      res.status(400).json({ error: 'currency-not-allowed', currency: result.currency });
      return;
    }
    if (result.status === 'rating-too-low') {
      res.status(403).json({ error: 'rating-too-low', required: result.required, current: result.current });
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

// Real-money purchase (chip/gem packs, shop.tsx) -- packId identifies which
// pack the client believes it bought, purchaseToken is what react-native-iap
// hands back from Google Play after a completed purchase. Never trusts the
// client's claim alone: verifies the token against the Play Developer API
// before crediting anything, matching iapCatalog.ts's server-side-only
// pack/price list (the client's shop.tsx copy is display-only).
authRouter.post(
  '/me/purchases/verify',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const { packId, purchaseToken } = req.body ?? {};
    if (typeof packId !== 'string' || typeof purchaseToken !== 'string' || !purchaseToken) {
      res.status(400).json({ error: 'invalid-request' });
      return;
    }
    // One-time entitlement (Remove Ads) -- verified the same way, but flips a
    // profile flag instead of crediting currency and is acknowledged, NEVER
    // consumed (consuming would make Play let the player buy it again).
    const entitlementProduct = getEntitlementProductById(packId);
    if (entitlementProduct) {
      let entitlementVerification;
      try {
        entitlementVerification = await verifyProductPurchase(entitlementProduct.androidProductId, purchaseToken);
      } catch (error) {
        console.log('Google Play purchase verification failed', error);
        res.status(502).json({ error: 'verification-unavailable' });
        return;
      }
      if (entitlementVerification.status !== 'valid') {
        res.status(400).json({ error: 'purchase-not-valid' });
        return;
      }
      const granted = await grantEntitlement(userId, entitlementProduct, purchaseToken);
      if (granted.status === 'token-owned-by-other-user') {
        res.status(409).json({ error: 'purchase-belongs-to-another-account' });
        return;
      }
      try {
        await acknowledgePurchase(entitlementProduct.androidProductId, purchaseToken);
      } catch (error) {
        console.log('Google Play acknowledge failed', error);
      }
      res.json({ ok: true, adsRemoved: true });
      return;
    }

    const pack = getPackById(packId);
    if (!pack) {
      res.status(400).json({ error: 'unknown-pack' });
      return;
    }

    let verification;
    try {
      verification = await verifyProductPurchase(pack.androidProductId, purchaseToken);
    } catch (error) {
      console.log('Google Play purchase verification failed', error);
      res.status(502).json({ error: 'verification-unavailable' });
      return;
    }
    if (verification.status !== 'valid') {
      res.status(400).json({ error: 'purchase-not-valid' });
      return;
    }

    const credited = await creditVerifiedPurchase(userId, pack, purchaseToken);

    try {
      await acknowledgeAndConsume(pack.androidProductId, purchaseToken);
    } catch (error) {
      // The currency is already credited and won't be double-granted (the
      // providerTransactionId unique constraint holds regardless) -- a
      // failure here just means the SKU may not be repurchasable again
      // until it's consumed, worth logging but not worth failing the
      // response the player is waiting on.
      console.log('Google Play acknowledge/consume failed', error);
    }

    res.json({ ok: true, chips: credited.chips, gems: credited.gems });
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

// Bot matches are played on the device, so the server issues each one FIRST
// (which bot, which colour, when it started) and only pays out when the finished
// game's PGN replays as a legal game with a real result (db/botSessions.ts). This
// replaced the old "POST me a win" route, which anyone signed in could call in a loop.
authRouter.post(
  '/me/bot-matches',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await startBotSession(req.userId as string, req.body?.botId, req.body?.color);
    if (result.status === 'ok') {
      res.json({ ok: true, sessionId: result.sessionId });
      return;
    }
    res.status(result.status === 'profile-not-found' ? 404 : 400).json({ error: result.status });
  }),
);

authRouter.post(
  '/me/bot-matches/:sessionId/finish',
  requireAuth,
  asyncHandler(async (req, res) => {
    const sessionId = String(req.params.sessionId);
    const endedBy = req.body?.endedBy;
    if (!/^[0-9a-f-]{36}$/i.test(sessionId) || typeof endedBy !== 'string' || !(ENDED_BY as string[]).includes(endedBy)) {
      res.status(400).json({ error: 'invalid-request' });
      return;
    }
    const result = await finishBotSession(req.userId as string, sessionId, { pgn: req.body?.pgn, endedBy });
    if (result.status === 'ok') {
      res.json({
        ok: true,
        outcome: result.outcome,
        chipsGranted: result.chipsGranted,
        chips: result.chips,
        progression: result.progression,
      });
    } else if (result.status === 'no-result') {
      // A game that cannot be verified pays nothing -- 200 so the app just shows "no reward".
      res.json({ ok: true, noResult: true, reason: result.reason });
    } else {
      res.status(result.status === 'not-found' ? 404 : 409).json({ error: result.status });
    }
  }),
);

// The Tour (campaign): chapters, gigs, bosses and the player's progress.
authRouter.get(
  '/me/tour',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await getTour(req.userId as string));
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
    // `doubleWithAd`: claim x2 after watching a rewarded ad (see adRewards.ts).
    const result = await claimDailyBonus(req.userId as string, { doubleWithAd: req.body?.doubleWithAd === true });
    if ('adBlocked' in result) {
      res.status(409).json({ error: result.adBlocked === 'not-verified' ? 'ad-not-verified' : 'ad-daily-cap-reached' });
      return;
    }
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
    // `withAd`: the one extra daily spin earned by a rewarded ad.
    const result = await performSpin(req.userId as string, { withAd: req.body?.withAd === true });
    if ('adBlocked' in result) {
      res.status(409).json({ error: result.adBlocked === 'not-verified' ? 'ad-not-verified' : 'ad-daily-cap-reached' });
      return;
    }
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

// Rewarded ads (see adRewards.ts for the placements, caps and reward sizes).
// Display-only status so the client can show "Watch ad" vs "Come back tomorrow";
// redeemAdReward() inside each reward path is the real enforcement.
authRouter.get(
  '/me/ads/status',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ placements: await getAdStatus(req.userId as string), ssvRequired: ADS_REQUIRE_SSV });
  }),
);

// Free-chips placement. extra-spin / daily-double ride on POST /me/spin and
// POST /me/daily-bonus/claim instead, inside those routes' own transactions.
authRouter.post(
  '/me/ads/redeem',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    if (req.body?.placement !== 'free-chips') {
      res.status(400).json({ error: 'invalid-placement' });
      return;
    }
    const rule = AD_PLACEMENTS['free-chips'];
    const result = await db.transaction(async (tx) => {
      const outcome = await redeemAdReward(tx, userId, 'free-chips');
      if (outcome !== 'ok') return { outcome } as const;
      const [profile] = await tx
        .update(playerProfiles)
        .set({ chips: sql`${playerProfiles.chips} + ${rule.rewardChips}`, updatedAt: new Date() })
        .where(eq(playerProfiles.userId, userId))
        .returning({ chips: playerProfiles.chips, gems: playerProfiles.gems });
      return { outcome, chips: profile.chips, gems: profile.gems } as const;
    });
    if (result.outcome === 'daily-cap-reached') {
      res.status(409).json({ error: 'ad-daily-cap-reached' });
      return;
    }
    if (result.outcome === 'not-verified') {
      res.status(409).json({ error: 'ad-not-verified' });
      return;
    }
    res.json({ ok: true, chipsGranted: rule.rewardChips, chips: result.chips, gems: result.gems });
  }),
);

// AdMob server-side-verification callback -- called by Google (no auth header),
// authenticated instead by the ECDSA signature over the query string.
authRouter.get(
  '/ads/ssv',
  asyncHandler(async (req, res) => {
    const rawQuery = req.originalUrl.split('?')[1] ?? '';
    const verified = await verifyAdMobSsv(rawQuery);
    if (!verified) {
      res.status(403).json({ error: 'invalid-signature' });
      return;
    }
    try {
      await recordVerifiedAdView(verified.userId, verified.transactionId);
    } catch (error) {
      // Unknown user id / malformed uuid: nothing to retry, so still answer 200
      // (a non-200 makes Google keep re-sending the same callback).
      console.log('Ad SSV callback could not be recorded', error);
    }
    res.sendStatus(200);
  }),
);

authRouter.get(
  '/me/quests',
  requireAuth,
  asyncHandler(async (req, res) => {
    const type = req.query.type === 'weekly' ? 'weekly' : 'daily';
    res.json({ quests: await getQuestsStatus(req.userId as string, type) });
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

// Celebrations (level up / new title) the player has not seen yet -- the live
// socket push (`progression:update`) can be missed while offline or backgrounded,
// so every event is stored and replayed from here until it is marked seen.
authRouter.get(
  '/me/progression/unseen',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ events: await getUnseenCelebrations(req.userId as string) });
  }),
);

authRouter.post(
  '/me/progression/:eventId/seen',
  requireAuth,
  asyncHandler(async (req, res) => {
    const eventId = String(req.params.eventId);
    // A malformed id (not a uuid) would make Postgres throw; treat it as not found.
    if (!/^[0-9a-f-]{36}$/i.test(eventId)) {
      res.status(404).json({ error: 'not-found' });
      return;
    }
    await markProgressionSeen(req.userId as string, eventId);
    res.json({ ok: true });
  }),
);

// Titles the player owns plus the full catalog (so the profile can show locked
// ones). Equipping a chosen title is a later phase; today the newest is auto-equipped.
authRouter.get(
  '/me/titles',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ owned: await getOwnedTitleIds(req.userId as string), catalog: TITLES });
  }),
);

const PUZZLE_REPORT_MIN_GAP_MS = 4_000;
const lastPuzzleReport = new Map<string, number>();

authRouter.post(
  '/me/quests/report-puzzle-solved',
  requireAuth,
  asyncHandler(async (req, res) => {
    // Puzzles are still solved (and reported) on the device. Until the server
    // knows the puzzle catalog, a minimum gap between reports at least stops a
    // tight loop from farming quests, achievements and Tour gigs.
    const userId = req.userId as string;
    const last = lastPuzzleReport.get(userId) ?? 0;
    if (Date.now() - last < PUZZLE_REPORT_MIN_GAP_MS) {
      res.status(429).json({ error: 'too-fast' });
      return;
    }
    lastPuzzleReport.set(userId, Date.now());
    await Promise.all([reportPuzzleSolvedForQuests(userId), reportPuzzleSolvedForAchievements(userId)]);
    await applyTour(userId, { puzzle: true });
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me/achievements',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ achievements: await getAchievementsStatus(req.userId as string) });
  }),
);

authRouter.post(
  '/me/achievements/:achievementId/claim',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await claimAchievement(req.userId as string, req.params.achievementId);
    if (result.status === 'not-found') {
      res.status(404).json({ error: 'achievement-not-found' });
      return;
    }
    if (result.status === 'not-complete') {
      res.status(400).json({ error: 'achievement-not-complete' });
      return;
    }
    if (result.status === 'already-claimed') {
      res.status(409).json({ error: 'already-claimed' });
      return;
    }
    res.json({
      ok: true,
      rewardType: result.rewardType,
      rewardAmount: result.rewardAmount,
      chips: result.chips,
      gems: result.gems,
      xp: result.xp,
    });
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
        chipsDelta: matchParticipants.chipsDelta,
        venueTier: matches.venueTier,
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
          .select({
            userId: playerProfiles.userId,
            displayName: playerProfiles.displayName,
            country: playerProfiles.country,
          })
          .from(playerProfiles)
          .where(inArray(playerProfiles.userId, opponentIds))
      : [];
    const opponentProfileByUserId = new Map(opponentProfiles.map((p) => [p.userId, p]));

    res.json({
      matches: rows.map((row) => {
        const opponentUserId = row.color === 'w' ? row.blackUserId : row.whiteUserId;
        const opponentProfile = opponentUserId ? opponentProfileByUserId.get(opponentUserId) : undefined;
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
          // Net chips from the wager (null on unwagered/Garage matches).
          chipsDelta: row.chipsDelta,
          venueTier: row.venueTier,
          opponentDisplayName: opponentProfile?.displayName || 'Unknown',
          opponentCountry: opponentProfile?.country ?? null,
          opponentUserId: opponentUserId ?? null,
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

// Maps account-security.tsx's "Delete Account" button. See
// db/accountDeletion.ts's deleteUserAccount for what this actually deletes --
// also called from deleteAccountByEmail.ts, the CLI fallback for a web/email
// deletion request made by someone without app access (docs/data-deletion.html).
authRouter.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteUserAccount(req.userId as string);
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
        country: playerProfiles.country,
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

// Public -- no requireAuth, same posture as /leaderboard above. Front Row's
// spectate browsing needs this reachable by guests, same as guest play
// itself never requires an account. Snapshot only -- live updates (moves,
// clocks ticking, match ending) come from the spectate:* socket protocol in
// index.ts once a client joins a specific match's room.
authRouter.get(
  '/me/live-matches',
  asyncHandler(async (_req, res) => {
    const liveMatches = [...allMatches()].map((match) => ({
      matchId: match.id,
      players: {
        w: { displayName: match.players.w.displayName, avatarId: match.players.w.avatarId, country: match.players.w.country },
        b: { displayName: match.players.b.displayName, avatarId: match.players.b.avatarId, country: match.players.b.country },
      },
      fen: match.chess.fen(),
      turn: match.chess.turn(),
      clocks: liveClockRemaining(match),
      createdAt: match.createdAt.toISOString(),
    }));
    res.json({ liveMatches });
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
        country: f.country,
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
      user: {
        userId: user.userId,
        displayName: user.displayName,
        avatarId: user.avatarId,
        country: user.country,
        rating: user.rating,
      },
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
      const name = me.displayName ?? 'A player';
      if (result.accepted) {
        await insertNotification(result.friend.userId, 'friend_request_accepted', 'Friend request accepted', `${name} accepted your friend request.`, { fromUserId: userId });
      } else {
        await insertNotification(result.friend.userId, 'friend_request_received', 'New friend request', `${name} sent you a friend request.`, { fromUserId: userId });
      }
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
    if (me) {
      emitToUser(req.params.userId, 'friend:request:accepted', { friend: me });
      await insertNotification(req.params.userId, 'friend_request_accepted', 'Friend request accepted', `${me.displayName ?? 'A player'} accepted your friend request.`, { fromUserId: userId });
    }
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

// Blocking reuses the friendships table's existing 'blocked' status (see
// db/moderation.ts) -- once set, it also stops DMs/challenges between the
// pair, since both already gate on live friendship status on every attempt,
// not just at connection time.
authRouter.post(
  '/me/block/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    await blockUser(userId, req.params.userId);
    res.json({ ok: true });
  }),
);

authRouter.delete(
  '/me/block/:userId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const result = await unblockUser(userId, req.params.userId);
    if (result.status === 'not-blocked-by-you') {
      res.status(404).json({ error: 'not-blocked-by-you' });
      return;
    }
    res.json({ ok: true });
  }),
);

authRouter.get(
  '/me/blocked',
  requireAuth,
  asyncHandler(async (req, res) => {
    const blocked = await listBlocked(req.userId as string);
    res.json({ blocked });
  }),
);

// No admin/review workflow yet -- rows are queried directly for now (see
// db/schema/moderation.ts's comment).
authRouter.post(
  '/me/reports',
  requireAuth,
  asyncHandler(async (req, res) => {
    const userId = req.userId as string;
    const { reportedUserId, reason, details, matchId } = req.body ?? {};
    if (typeof reportedUserId !== 'string' || !reportedUserId) {
      res.status(400).json({ error: 'missing-reported-user' });
      return;
    }
    if (!isValidReportReason(reason)) {
      res.status(400).json({ error: 'invalid-reason' });
      return;
    }
    await submitReport(
      userId,
      reportedUserId,
      reason,
      typeof details === 'string' ? details : undefined,
      typeof matchId === 'string' ? matchId : undefined,
    );
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
        country: s.user.country,
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

// ---------------------------------------------------------------------------
// Notifications ("Backstage Alerts") -- real events (friend requests/
// challenges, match results) persisted in the notifications table, merged
// with quest/achievement/daily-bonus "ready to claim" items synthesized live
// at read time (see db/notifications.ts's syntheticNotifications).
// ---------------------------------------------------------------------------

authRouter.get(
  '/me/notifications',
  requireAuth,
  asyncHandler(async (req, res) => {
    const result = await getNotifications(req.userId as string, {
      limit: req.query.limit !== undefined ? Number(req.query.limit) : undefined,
      before: typeof req.query.before === 'string' ? req.query.before : undefined,
    });
    res.json(result);
  }),
);

authRouter.get(
  '/me/notifications/unread-count',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ unreadCount: await getUnreadNotificationCount(req.userId as string) });
  }),
);

authRouter.post(
  '/me/notifications/:id/read',
  requireAuth,
  asyncHandler(async (req, res) => {
    await markNotificationRead(req.userId as string, req.params.id);
    res.json({ ok: true });
  }),
);

authRouter.post(
  '/me/notifications/read-all',
  requireAuth,
  asyncHandler(async (req, res) => {
    await markAllNotificationsRead(req.userId as string);
    res.json({ ok: true });
  }),
);
