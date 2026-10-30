import { emitEmailGate } from './emailGate';

const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

interface RequestOptions {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  token?: string;
}

async function request<T>(path: string, options: RequestOptions): Promise<T> {
  const response = await fetch(`${SERVER_URL}${path}`, {
    method: options.method,
    headers: {
      'Content-Type': 'application/json',
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    // New email/password account that has not entered its code yet: open the "verify your email" prompt.
    if (data.error === 'email-not-verified') emitEmailGate();
    throw new Error(data.error ?? `request failed (${response.status})`);
  }
  return data;
}

// Signup/login now go through authClient.ts (better-auth) instead of this
// plain fetch wrapper -- everything below is still a regular REST call
// guarded by the bearer token that produces, validated server-side via
// auth.api.getSession instead of jwt.verify.

export function updateProfile(
  token: string,
  updates: { displayName?: string; avatarId?: string; equippedBoardId?: string; equippedPieceId?: string; country?: string },
): Promise<{ ok: true }> {
  return request('/me/profile', { method: 'PATCH', body: updates, token });
}

// Maps account-security.tsx's "Delete Account" button.
export function deleteAccount(token: string): Promise<{ ok: true }> {
  return request('/me', { method: 'DELETE', token });
}

// Spend gems or chips (caller's choice) to own a locked cosmetic (currently
// only board themes). Rejects with Error('insufficient-funds') or
// Error('already-owned') -- callers catch those specifically.
export function unlockCosmetic(
  token: string,
  itemId: string,
  currency: 'gems' | 'chips',
): Promise<{ ok: true; itemId: string; currency: 'gems' | 'chips'; price: number; gems: number; chips: number }> {
  return request(`/me/cosmetics/${encodeURIComponent(itemId)}/unlock`, {
    method: 'POST',
    body: { currency },
    token,
  });
}

// Real-money purchase (shop.tsx's chip/gem packs). purchaseToken is what
// react-native-iap hands back after a completed Google Play purchase --
// the server independently verifies it against the Play Developer API
// before crediting anything (see server/src/iapCatalog.ts's authoritative
// pack list; the client never dictates price or amount). Rejects with
// Error('unknown-pack' | 'purchase-not-valid' | 'verification-unavailable').
export function verifyPurchase(
  token: string,
  packId: string,
  purchaseToken: string,
): Promise<{ ok: true; chips: number; gems: number; adsRemoved?: boolean }> {
  return request('/me/purchases/verify', { method: 'POST', body: { packId, purchaseToken }, token });
}

// Premium action: charges chips or gems every time Game Analysis is used
// (no persistent "unlocked" record). Rejects with Error('insufficient-funds')
// -- callers catch that specifically, same pattern as unlockCosmetic.
// currency 'credit' spends one review stored from a Review Pack (price 0).
export function chargeForAnalysis(
  token: string,
  currency: 'chips' | 'gems' | 'credit',
): Promise<{ ok: true; currency: 'chips' | 'gems' | 'credit'; price: number; chips: number; gems: number; credits: number }> {
  return request('/me/analysis/charge', { method: 'POST', body: { currency }, token });
}

// Review Pack: ten reviews at once for less than ten singles, paid in chips or gems and stored as
// credits. Rejects with Error('insufficient-funds' | 'stock-full').
export function buyAnalysisPack(
  token: string,
  currency: 'chips' | 'gems',
): Promise<{ ok: true; currency: 'chips' | 'gems'; price: number; reviews: number; chips: number; gems: number; credits: number }> {
  return request('/me/analysis/packs/buy', { method: 'POST', body: { currency }, token });
}

// ---- Progression (Fame / level / titles) -- mirrors server/src/db/progression.ts ----
export interface GoalProgress {
  id: string;
  title: string;
  before: number;
  after: number;
  target: number;
  completed: boolean;
}

export type RatingTier = 'rookie' | 'challenger' | 'master' | 'grandmaster';

export interface ProgressionReport {
  eventId: string;
  source: 'online' | 'bot';
  matchId: string | null;
  outcome: 'win' | 'loss' | 'draw';
  fame: {
    base: number;
    gained: number;
    openingNight: boolean;
    hotStreak: number;
    streak: number;
    capped: boolean;
    botFameLeftToday: number | null;
    // Backstage Gear: Amp Boost bonus applied to this win (0 = none) and wins left on it, and the
    // win streak a Lucky Pick just saved from this loss (0 = none).
    ampBonus: number;
    ampWinsLeft: number;
    luckyPickSaved: number;
  };
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  levelProgress: { xpIntoLevel: number; xpForNextLevel: number; progress: number };
  rewards: { chips: number; gems: number; byLevel: { level: number; chips: number; gems: number }[] };
  titlesUnlocked: { id: string; name: string }[];
  equippedTitle: { id: string; name: string } | null;
  rating: null | { before: number; after: number; delta: number; tierBefore: RatingTier; tierAfter: RatingTier };
  goals: GoalProgress[];
  tour: TourUpdate | null;
}

export function getUnseenProgression(token: string): Promise<{ events: ProgressionReport[] }> {
  return request('/me/progression/unseen', { method: 'GET', token });
}

export function markProgressionSeen(token: string, eventId: string): Promise<{ ok: true }> {
  return request(`/me/progression/${eventId}/seen`, { method: 'POST', token });
}

export interface PlayerProfile {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  // Short code another player types in to send a friend request. Always set
  // for a real account (see server betterAuth.ts); null only in the brief
  // window before the profile row is read back.
  friendCode: string | null;
  level: number;
  xp: number;
  rating: number;
  winStreak: number;
  wins: number;
  losses: number;
  draws: number;
  chips: number;
  gems: number;
  country: string | null;
  equippedBoardId: string | null;
  equippedPieceId: string | null;
  equippedAvatarCosmeticId: string | null;
  ownedCosmeticIds: string[];
  // Game Reviews bought in a Review Pack and not yet spent (Analyze Game spends these first).
  analysisCredits: number;
  // True once the player bought Remove Ads (server-set only, never writable
  // through PATCH /me/profile). Switches off interstitials; rewarded ads stay.
  adsRemoved: boolean;
  // Title shown under the name (id from economy.config.json levels.titles).
  equippedTitleId: string | null;
  // The login email and the ways this account can sign in ('password' and/or 'google'); own account only.
  email?: string | null;
  signInMethods?: string[];
  // Email verification (server/src/db/emailGate.ts). needsEmailVerification = a new email/password account that
  // has not entered its code (soft gate on online play); welcomeBonusPending = its 4,000 chips are still held.
  emailVerified?: boolean;
  needsEmailVerification?: boolean;
  welcomeBonusPending?: boolean;
}

export function getMyProfile(token: string): Promise<{ profile: PlayerProfile }> {
  return request('/me/profile', { method: 'GET', token });
}

// ---- Verified bot matches (server/src/db/botSessions.ts) ----
// Bot games are played on the device, so the server issues each one first and only
// pays when the finished game's PGN replays as a legal game with a real result.
// `kit: true` also buys the Roadie Kit for a Tour boss fight (the chips leave in the same call).
// It rejects with Error('kit-locked' | 'insufficient-chips' | 'not-a-boss').
export interface BotMatchKit {
  takeTwos: number;
  tips: number;
  paid: number; // chips paid (0 = the crowd's free kit)
  chips: number | null; // balance after paying
}
export function startBotMatch(token: string, botId: string, color: 'w' | 'b', kit = false): Promise<{ ok: true; sessionId: string; kit: BotMatchKit | null }> {
  return request('/me/bot-matches', { method: 'POST', body: { botId, color, ...(kit ? { kit: true } : {}) }, token });
}

export type BotFinishReason = 'game' | 'resign' | 'timeout' | 'abandon' | 'bot-timeout';

export interface BotFinishResult {
  ok: true;
  // noResult: the game could not be verified (too short, too fast, illegal PGN, ...) -- nothing was paid.
  noResult?: boolean;
  reason?: string;
  outcome?: 'win' | 'loss' | 'draw';
  chipsGranted?: number;
  chips?: number;
  progression?: ProgressionReport;
}

export function finishBotMatch(token: string, sessionId: string, pgn: string, endedBy: BotFinishReason): Promise<BotFinishResult> {
  return request(`/me/bot-matches/${sessionId}/finish`, { method: 'POST', body: { pgn, endedBy }, token });
}

// ---- Backstage Gear: consumables (server/src/db/boosts.ts) ----
export interface GearItemStatus {
  id: string;
  name: string;
  tagline: string;
  price: number;
  charges: number; // uses on one copy
  quantity: number; // in the bag
  activeCharges: number; // left on the activated copy (0 = none active)
  atCap: boolean;
}

export interface GearStatus {
  items: GearItemStatus[];
  maxStock: number;
  chips: number;
}

export function getGear(token: string): Promise<GearStatus> {
  return request('/me/gear', { method: 'GET', token });
}

// Rejects with Error('insufficient-chips' | 'stock-full' | 'unknown-item').
export function buyGear(token: string, itemId: string): Promise<{ ok: true; chips: number; quantity: number }> {
  return request(`/me/gear/${encodeURIComponent(itemId)}/buy`, { method: 'POST', token });
}

// Rejects with Error('already-active' | 'none-in-bag' | 'unknown-item').
export function activateGear(token: string, itemId: string): Promise<{ ok: true; quantity: number; activeCharges: number }> {
  return request(`/me/gear/${encodeURIComponent(itemId)}/activate`, { method: 'POST', token });
}

// ---- The Tour (campaign) ----
export interface TourGig {
  id: string;
  title: string;
  description: string;
  kind: string;
  target: number;
  progress: number;
  completed: boolean;
  chips: number;
}

export interface TourChapter {
  id: string;
  name: string;
  venue: string;
  tagline: string;
  unlocked: boolean;
  bossBeaten: boolean;
  perfect: boolean;
  gigsDone: number;
  boss: null | { botId: string; name: string; emoji: string; difficulty: string };
  encore: null | { progress: number; bots: { id: string; name: string; emoji: string }[] };
  reward: { chips: number; gems: number; titleName: string };
  // Crowd Energy + the Roadie Kit (server/src/db/tour.ts); null when there is no boss to be stuck on.
  backstage: null | {
    losses: number;
    kitUnlockLosses: number;
    kitOpen: boolean;
    toNextFree: number;
    crowdFreeEvery: number;
    freeKit: boolean;
    price: number;
    kit: { takeTwos: number; tips: number };
  };
  gigs: TourGig[];
}

export interface TourStatus {
  chapters: TourChapter[];
  gigsDone: number;
  gigsTotal: number;
}

export function getTour(token: string): Promise<TourStatus> {
  return request('/me/tour', { method: 'GET', token });
}

// ---- Festival Run (server/src/db/festival.ts) ----------------------------------------------

export interface FestivalSet {
  botId: string;
  name: string;
  emoji: string;
  difficulty: string;
}

export interface FestivalTierView {
  id: string;
  name: string;
  tagline: string;
  entry: number;
  nextEntry: number; // today's price for the next run (repeat surcharge included)
  purse: number[];
  sets: FestivalSet[];
  unlocked: boolean;
  unlockChapterId: string;
  unlockChapterName: string;
  runsToday: number;
  dailyRuns: number;
  cleared: boolean;
  titleName: string;
}

export interface FestivalRunView {
  id: string;
  tierId: string;
  status: 'active' | 'cashed' | 'won' | 'lost' | 'refunded';
  phase: 'ready' | 'playing';
  entryPaid: number;
  setIndex: number;
  setsCleared: number;
  totalSets: number;
  replaysUsed: number;
  purse: number[];
  banked: number;
  nextPurse: number | null;
  canCashOut: boolean;
  sets: (FestivalSet & { state: 'done' | 'current' | 'next' })[];
  payout: number | null;
  matchId: string | null;
}

export interface FestivalStatus {
  tiers: FestivalTierView[];
  activeRun: FestivalRunView | null;
}

export function getFestival(token: string): Promise<FestivalStatus> {
  return request('/me/festival', { method: 'GET', token });
}

// Entering can be refused for reasons the screen explains (locked, daily limit, chips), so
// this returns the refusal instead of throwing it away as a bare error string.
export type EnterFestivalResult =
  | { ok: true; run: FestivalRunView; chips: number; fee: number }
  | { ok: false; error: 'unknown-tier' | 'profile-not-found' | 'locked' | 'daily-limit' | 'already-active' | 'insufficient-chips' | 'network'; required?: number; chips?: number; chapterName?: string; limit?: number; run?: FestivalRunView };

export async function enterFestival(token: string, tierId: string): Promise<EnterFestivalResult> {
  try {
    const response = await fetch(`${SERVER_URL}/me/festival/${encodeURIComponent(tierId)}/enter`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok) return { ok: true, run: data.run, chips: data.chips, fee: data.fee };
    return { ok: false, error: data.error ?? 'network', required: data.required, chips: data.chips, chapterName: data.chapterName, limit: data.limit, run: data.run };
  } catch {
    return { ok: false, error: 'network' };
  }
}

export function cashOutFestival(token: string, runId: string): Promise<{ ok: true; run: FestivalRunView; payout: number; chips: number }> {
  return request(`/me/festival/runs/${runId}/cash-out`, { method: 'POST', token });
}

export function recoverFestivalRun(token: string, runId: string): Promise<{ ok: true; how: 'cashed' | 'refunded'; payout: number; chips: number; run: FestivalRunView }> {
  return request(`/me/festival/runs/${runId}/recover`, { method: 'POST', token });
}

// What the Tour did with ONE finished match (part of the Show Report).
export interface TourUpdate {
  gigsCompleted: { id: string; title: string; chapterId: string; chips: number }[];
  gigsProgressed: { id: string; title: string; before: number; after: number; target: number }[];
  bossBeaten: null | { chapterId: string; chapterName: string; chips: number; gems: number; titleId: string; titleName: string };
  perfect: null | { chapterId: string; chapterName: string; gems: number };
  chapterUnlocked: null | { id: string; name: string };
  encore: null | { progress: number; total: number };
  bossAttempt: null | {
    chapterId: string;
    chapterName: string;
    losses: number;
    toUnlock: number;
    kitJustOpened: boolean;
    freeKitJustEarned: boolean;
    toNextFree: number;
  };
  chips: number;
  gems: number;
}

export interface DailyBonusStatus {
  currentStreak: number;
  canClaimToday: boolean;
  nextClaimDay: number; // 1-7
}

export function getDailyBonusStatus(token: string): Promise<DailyBonusStatus> {
  return request('/me/daily-bonus/status', { method: 'GET', token });
}

export interface DailyBonusClaimResult {
  ok: true;
  day: number;
  streak: number;
  chipsGranted: number;
  gemsGranted: number;
  chips: number;
  gems: number;
}

// Rejects with Error('already-claimed-today') on a same-UTC-day repeat call
// (the request() helper throws data.error on non-2xx) -- callers catch that
// specifically to show a "come back tomorrow" state instead of a generic error.
//
// `doubleWithAd`: claim x2 after the player watched a rewarded ad. Also rejects
// with Error('ad-daily-cap-reached' | 'ad-not-verified') -- in both cases
// nothing was claimed, so the player can still claim the normal amount.
export function claimDailyBonus(token: string, options: { doubleWithAd?: boolean } = {}): Promise<DailyBonusClaimResult> {
  return request('/me/daily-bonus/claim', {
    method: 'POST',
    body: options.doubleWithAd ? { doubleWithAd: true } : undefined,
    token,
  });
}

// Another player's public profile (server/src/db/publicProfile.ts): public fields only. Rejects with
// Error('not-found') for an unknown or blocked player.
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
  winRate: number | null;
  online: boolean;
  relation: 'self' | 'friends' | 'outgoing' | 'incoming' | 'none';
  headToHead: null | { games: number; yourWins: number; theirWins: number; draws: number };
}

export function getPlayerProfile(token: string, userId: string): Promise<{ profile: PublicProfile }> {
  return request(`/users/${encodeURIComponent(userId)}/profile`, { method: 'GET', token });
}

// How many players are waiting per time control at a venue (server/src/matchmaking.ts queueCounts): display
// only, for the "N searching" line under the time picker. Public, no sign-in needed.
export function getQueueStats(venueTier: string): Promise<{ venueTier: string; waiting: Record<'3m' | '5m' | '10m', number> }> {
  return request(`/queue/stats?venueTier=${encodeURIComponent(venueTier)}`, { method: 'GET' });
}

export interface SpinStatus {
  canSpin: boolean;
  // Chip-priced extra spins (after the free one): how many today, the daily cap, and what the next one
  // costs (null once today's are used up). Prices step up; see economy.config.json -> spinExtra.
  paid: { used: number; cap: number; nextPrice: number | null };
}

export function getSpinStatus(token: string): Promise<SpinStatus> {
  return request('/me/spin/status', { method: 'GET', token });
}

export interface SpinResult {
  ok: true;
  prizeId: string;
  label: string;
  rewardType: 'chips' | 'gems' | 'xp';
  rewardAmount: number;
  paidChips: number | null; // chips this spin cost (null = the free or ad spin)
  chips: number;
  gems: number;
}

// The server picks the prize before responding (see server/src/db/spin.ts) --
// the client only animates the wheel to whichever prizeId comes back, it
// never decides the outcome itself. Rejects with Error('already-spun-today')
// on a same-UTC-day repeat call.
//
// `withAd`: the one extra daily spin, earned by a rewarded ad. Also rejects
// with Error('ad-daily-cap-reached' | 'ad-not-verified').
//
// `withChips`: a chip-priced extra spin, only after the free one. Rejects with
// Error('free-spin-available' | 'paid-spins-used' | 'insufficient-funds').
export function spinWheel(token: string, options: { withAd?: boolean; withChips?: boolean } = {}): Promise<SpinResult> {
  return request('/me/spin', {
    method: 'POST',
    body: options.withAd ? { withAd: true } : options.withChips ? { withChips: true } : undefined,
    token,
  });
}

// Rewarded ads. The server owns the placements, caps and reward sizes (see
// server/src/adRewards.ts); this is display state for the button labels.
export interface AdPlacementStatus {
  dailyCap: number;
  remaining: number;
}
export interface AdStatus {
  placements: Record<'free-chips' | 'extra-spin' | 'daily-double' | 'venue-refill', AdPlacementStatus>;
  ssvRequired: boolean;
}

export function getAdStatus(token: string): Promise<AdStatus> {
  return request('/me/ads/status', { method: 'GET', token });
}

// Free-chips placement. Rejects with Error('ad-daily-cap-reached' | 'ad-not-verified').
export function redeemFreeChipsAd(token: string): Promise<{ ok: true; chipsGranted: number; chips: number; gems: number }> {
  return request('/me/ads/redeem', { method: 'POST', body: { placement: 'free-chips' }, token });
}

// Out-of-chips lifeline: an ad pays the shortfall to the cheapest buy-in (server/src/adRewards.ts,
// refillAmount). Rejects with Error('ad-daily-cap-reached' | 'ad-not-verified' | 'refill-not-needed').
export function redeemVenueRefillAd(token: string): Promise<{ ok: true; chipsGranted: number; chips: number; gems: number }> {
  return request('/me/ads/redeem', { method: 'POST', body: { placement: 'venue-refill' }, token });
}

export interface QuestStatus {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  rewardChips: number;
  progress: number;
  claimed: boolean;
}

// Full quest objects come back from the server directly (unlike daily-bonus/
// spin's minimal status shape) -- quests.tsx renders straight from this, no
// local catalog mirror needed.
export function getQuestsStatus(token: string, type: 'daily' | 'weekly' = 'daily'): Promise<{ quests: QuestStatus[] }> {
  return request(`/me/quests?type=${type}`, { method: 'GET', token });
}

// Rejects with Error('quest-not-complete') if progress hasn't reached target,
// or Error('already-claimed') on a repeat call.
export function claimQuest(token: string, questId: string): Promise<{ ok: true; chipsGranted: number; chips: number }> {
  return request(`/me/quests/${questId}/claim`, { method: 'POST', token });
}

export function reportPuzzleSolvedForQuests(token: string): Promise<{ ok: true }> {
  return request('/me/quests/report-puzzle-solved', { method: 'POST', token });
}

export interface AchievementStatus {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  rewardType: 'chips' | 'gems' | 'xp';
  rewardAmount: number;
  featured: boolean;
  progress: number;
  claimed: boolean;
}

// Full achievement objects come back from the server directly, same as
// quests -- achievements.tsx / iron-id.tsx's Trophy Case (featured === true
// rows) both render straight from this, no local catalog mirror needed.
export function getAchievementsStatus(token: string): Promise<{ achievements: AchievementStatus[] }> {
  return request('/me/achievements', { method: 'GET', token });
}

// Rejects with Error('achievement-not-complete') if progress hasn't reached
// target, or Error('already-claimed') on a repeat call.
export function claimAchievement(
  token: string,
  achievementId: string,
): Promise<{ ok: true; rewardType: 'chips' | 'gems' | 'xp'; rewardAmount: number; chips: number; gems: number; xp: number }> {
  return request(`/me/achievements/${achievementId}/claim`, { method: 'POST', token });
}

export interface MatchHistoryEntry {
  matchId: string;
  playedAt: string;
  mode: 'bot' | 'local' | 'online';
  resultType: 'checkmate' | 'stalemate' | 'draw' | 'resignation' | 'forfeit' | 'timeout';
  color: 'w' | 'b';
  outcome: 'win' | 'loss' | 'draw';
  ratingBefore: number;
  ratingAfter: number;
  ratingDelta: number;
  // Net chips from the wager on this match (null = unwagered, e.g. Garage) and
  // the venue it was played in.
  chipsDelta: number | null;
  venueTier: string | null;
  opponentDisplayName: string;
  opponentCountry: string | null;
  opponentUserId: string | null;
}

export function getMyMatches(token: string, limit?: number): Promise<{ matches: MatchHistoryEntry[] }> {
  const query = limit ? `?limit=${limit}` : '';
  return request(`/me/matches${query}`, { method: 'GET', token });
}

// Backs the replay screen. pgn/moveElapsedMs are both null when the match
// predates this feature or was never persisted with move data (e.g. a
// bot/local mode row, if one ever exists) -- callers show an empty state
// rather than assuming every match history row is replayable.
export function getMatchReplay(
  token: string,
  matchId: string,
): Promise<{ pgn: string | null; moveElapsedMs: number[] | null }> {
  return request(`/me/matches/${encodeURIComponent(matchId)}/replay`, { method: 'GET', token });
}

export interface LeaderboardEntry {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
}

// Public endpoint -- no token needed.
export function getLeaderboard(limit?: number): Promise<{ leaderboard: LeaderboardEntry[] }> {
  const query = limit ? `?limit=${limit}` : '';
  return request(`/leaderboard${query}`, { method: 'GET' });
}

// Deliberately just rank + total -- every other field the "YOU" card needs
// (rating, displayName, avatarId, wins/losses/draws) already comes from
// getMyProfile, so callers combine both rather than this duplicating them.
export function getMyRank(token: string): Promise<{ rank: number; totalPlayers: number }> {
  return request('/leaderboard/me', { method: 'GET', token });
}

export interface LiveMatchSummary {
  matchId: string;
  players: {
    w: { displayName: string; avatarId: string | null; country: string | null };
    b: { displayName: string; avatarId: string | null; country: string | null };
  };
  fen: string;
  turn: 'w' | 'b';
  clocks: Record<'w' | 'b', number>;
  createdAt: string;
}

// Public endpoint -- no token needed, mirrors getLeaderboard. Snapshot only;
// Front Row follows up with the spectate:* socket protocol (spectateSocket.ts)
// for live updates once it picks a match to watch.
export function getLiveMatches(): Promise<{ liveMatches: LiveMatchSummary[] }> {
  return request('/me/live-matches', { method: 'GET' });
}

// --- Friends + direct messages -------------------------------------------
// All require a real signed-in account (server 401s a guest). The realtime
// side (presence deltas, incoming challenges, live DMs) rides the socket --
// see src/lib/friendsSocket.ts and src/hooks/useFriends.tsx.

export interface Friend {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number;
  level: number;
  online: boolean;
  inGame: boolean;
}

export interface FriendRequestUser {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number;
  level: number;
  requestedAt: string;
}

export function getFriends(token: string): Promise<{ friends: Friend[] }> {
  return request('/me/friends', { method: 'GET', token });
}

export function getFriendRequests(
  token: string,
): Promise<{ incoming: FriendRequestUser[]; outgoing: FriendRequestUser[] }> {
  return request('/me/friends/requests', { method: 'GET', token });
}

export interface FriendCodeLookup {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number;
}

export function lookupFriendCode(token: string, code: string): Promise<{ user: FriendCodeLookup | null }> {
  return request(`/me/friends/lookup?code=${encodeURIComponent(code)}`, { method: 'GET', token });
}

// Rejects with Error('user-not-found' | 'cannot-friend-self' | 'already-friends'
// | 'already-pending' | 'blocked') -- callers catch specific messages.
export function sendFriendRequest(
  token: string,
  target: { friendCode: string } | { userId: string },
): Promise<{ ok: true; accepted: boolean; friend: FriendCodeLookup & { level: number } }> {
  return request('/me/friends/request', { method: 'POST', body: target, token });
}

export function acceptFriendRequest(
  token: string,
  userId: string,
): Promise<{ ok: true; friend: FriendCodeLookup & { level: number } }> {
  return request(`/me/friends/${encodeURIComponent(userId)}/accept`, { method: 'POST', token });
}

// Declines an incoming request or cancels an outgoing one -- same endpoint.
export function declineFriendRequest(token: string, userId: string): Promise<{ ok: true }> {
  return request(`/me/friends/${encodeURIComponent(userId)}/decline`, { method: 'POST', token });
}

export function removeFriend(token: string, userId: string): Promise<{ ok: true }> {
  return request(`/me/friends/${encodeURIComponent(userId)}`, { method: 'DELETE', token });
}

// --- Blocking + reporting ---------------------------------------------------
// Blocking reuses the friends table's status column server-side ('blocked'
// alongside 'pending'/'accepted') -- once blocked, DMs/challenges between the
// pair stop working too, since both already re-check live friendship status
// on every attempt rather than just at connection time.

export interface BlockedUser {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number;
  level: number;
}

export function blockUser(token: string, userId: string): Promise<{ ok: true }> {
  return request(`/me/block/${encodeURIComponent(userId)}`, { method: 'POST', token });
}

export function unblockUser(token: string, userId: string): Promise<{ ok: true }> {
  return request(`/me/block/${encodeURIComponent(userId)}`, { method: 'DELETE', token });
}

export function getBlockedUsers(token: string): Promise<{ blocked: BlockedUser[] }> {
  return request('/me/blocked', { method: 'GET', token });
}

export type ReportReason = 'cheating' | 'harassment' | 'inappropriate_name' | 'spam' | 'other';

export function submitReport(
  token: string,
  report: { reportedUserId: string; reason: ReportReason; details?: string; matchId?: string },
): Promise<{ ok: true }> {
  return request('/me/reports', { method: 'POST', body: report, token });
}

export interface ConversationSummary {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number;
  online: boolean;
  lastMessage: { text: string; sentAt: string; mine: boolean };
  unreadCount: number;
}

export function getConversations(token: string): Promise<{ conversations: ConversationSummary[] }> {
  return request('/me/conversations', { method: 'GET', token });
}

export interface DirectMessage {
  id: string;
  senderUserId: string;
  text: string;
  sentAt: string;
  readAt: string | null;
  mine: boolean;
}

export function getConversationMessages(
  token: string,
  userId: string,
  opts?: { limit?: number; before?: string },
): Promise<{ messages: DirectMessage[] }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  const query = params.toString();
  return request(
    `/me/conversations/${encodeURIComponent(userId)}/messages${query ? `?${query}` : ''}`,
    { method: 'GET', token },
  );
}

export function markConversationRead(token: string, userId: string): Promise<{ ok: true }> {
  return request(`/me/conversations/${encodeURIComponent(userId)}/read`, { method: 'POST', token });
}

// --- Notifications ("Backstage Alerts") -----------------------------------
// Real events (friend requests/challenges, match results) come back with a
// real `id` and can be marked read; `synthetic: true` items (quest/
// achievement/daily-bonus "ready to claim") are recomputed fresh on every
// fetch and simply stop appearing once the real claim happens elsewhere --
// see server/src/db/notifications.ts.

export type NotificationKind =
  | 'friend_request_received'
  | 'friend_request_accepted'
  | 'friend_challenge_received'
  | 'match_ended'
  | 'quest_claimable'
  | 'achievement_claimable'
  | 'daily_bonus_claimable';

export interface NotificationDTO {
  id: string;
  type: NotificationKind;
  title: string;
  body: string;
  payload: unknown;
  createdAt: string;
  readAt: string | null;
  synthetic: boolean;
}

export function getNotifications(
  token: string,
  opts?: { limit?: number; before?: string },
): Promise<{ notifications: NotificationDTO[]; unreadCount: number }> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.before) params.set('before', opts.before);
  const query = params.toString();
  return request(`/me/notifications${query ? `?${query}` : ''}`, { method: 'GET', token });
}

export function getUnreadNotificationCount(token: string): Promise<{ unreadCount: number }> {
  return request('/me/notifications/unread-count', { method: 'GET', token });
}

export function markNotificationRead(token: string, notificationId: string): Promise<{ ok: true }> {
  return request(`/me/notifications/${encodeURIComponent(notificationId)}/read`, { method: 'POST', token });
}

export function markAllNotificationsRead(token: string): Promise<{ ok: true }> {
  return request('/me/notifications/read-all', { method: 'POST', token });
}

// --- Push notifications (server/src/push.ts) -----------------------------------------------------------

export interface PushPreferences {
  social: boolean;
  invites: boolean;
  results: boolean;
  daily: boolean;
}

export function registerPushDevice(token: string, device: { pushToken: string; platform: string; tzOffsetMin: number }): Promise<{ ok: true }> {
  return request('/me/push/devices', {
    method: 'POST',
    body: { token: device.pushToken, platform: device.platform, tzOffsetMin: device.tzOffsetMin },
    token,
  });
}

export function unregisterPushDevice(token: string, pushToken: string): Promise<{ ok: true }> {
  return request('/me/push/devices', { method: 'DELETE', body: { token: pushToken }, token });
}

export function getPushPreferences(token: string): Promise<{ preferences: PushPreferences }> {
  return request('/me/push/preferences', { method: 'GET', token });
}

export function updatePushPreferences(token: string, patch: Partial<PushPreferences>): Promise<{ preferences: PushPreferences }> {
  return request('/me/push/preferences', { method: 'PUT', body: patch, token });
}
