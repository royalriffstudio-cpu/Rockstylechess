import './env.js';
import { flushMonitoring, reportError, setupExpressMonitoring } from './monitoring.js';

import { toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { Chess } from 'chess.js';
import { Server, type Socket } from 'socket.io';

import { eq } from 'drizzle-orm';

import { allowedWebOrigins } from './allowedOrigins.js';
import { authRouter } from './auth.js';
import { canDeliverMate } from './chessEndgame.js';
import { socketAuth } from './authMiddleware.js';
import { auth } from './betterAuth.js';
import { CHALLENGE_TTL_MS, cancelChallengesFromSocket, consumeChallenge, createChallenge } from './challenge.js';
import { allowChatMessage, clearChatRateLimit, sanitizeChatText } from './chat.js';
import { db } from './db/client.js';
import { persistMessage } from './db/directMessages.js';
import { areFriends, friendIdsOf } from './db/friends.js';
import { insertNotification } from './db/notifications.js';
import { titleById } from './db/progression.js';
import { applyVerifiedBotResult } from './db/botSessions.js';
import { beginSet, resolveInterrupted, revertSet, settleSet, sweepStaleRuns, type Resolved, type SetSettlement } from './db/festival.js';
import { persistMatchResult } from './db/persistMatchResult.js';
import {
  escrowWager,
  getEntryProfile,
  settleWagerWithRetry,
  stakeFor,
  sweepStaleWagers,
  type SettledWager,
} from './db/wagers.js';
import { ECONOMY } from './economy.generated.js';
import { safetyNetTerms } from './gear.js';
import { FESTIVAL_SET_CLOCK_MS, STALE_RUN_MS, tierById } from './festival.js';
import { analyzeGame } from './matchAnalysis.js';
import { pickBotMove, warmServerBot } from './serverBot.js';
import { botById, MIN_BOT_PLIES } from './tour.js';
import { playerProfiles } from './db/schema/index.js';
import {
  addUserSocket,
  emitToUser,
  isUserOnline,
  removeUserSocket,
  setIO,
  setSocketForeground,
  socketIdsForUser,
} from './realtime.js';
import { needsEmailVerification } from './db/emailGate.js';
import { pushDirectMessage } from './push.js';
import { startPushScheduler } from './pushScheduler.js';
import { cancelRoomBySocketId, createRoom, joinRoom } from './gameRoom.js';
import {
  closeRematch,
  closeRematchesForSocket,
  getRematch,
  openRematch,
  rematchSeatColor,
  snapshotForRematch,
  type RematchSeat,
  type RematchSnapshot,
  type RematchWindow,
} from './rematch.js';
import {
  allMatches,
  applyMove,
  colorOf,
  createFestivalMatch,
  createMatch,
  endMatch,
  getMatch,
  liveClockRemaining,
  opponentColor,
  seatColor,
  type MatchState,
  type PieceColor,
} from './match.js';
import {
  isDuration,
  joinQueue,
  leaveQueue,
  removeFromQueues,
  widenQueued,
  type Duration,
  type QueuedPlayer,
  type VenueTier,
} from './matchmaking.js';

const PORT = Number(process.env.PORT) || 4000;
// How long a disconnected player's match stays alive waiting for them to
// reconnect before it's forfeited to the opponent -- mobile networks flap
// between WiFi/cellular/background often enough that an instant forfeit
// would be needlessly punishing.
const RECONNECT_GRACE_MS = 60_000;

const VENUE_TIERS: VenueTier[] = ['garage', 'club', 'arena', 'stadium', 'mainstage', 'world-tour'];
function isVenueTier(value: unknown): value is VenueTier {
  return typeof value === 'string' && (VENUE_TIERS as string[]).includes(value);
}

// The enum, not raw ms, arrives over the wire -- resolved to a real ms value
// only here, server-side, so a client can't request an arbitrary duration.
const DURATION_MS: Record<Duration, number> = {
  '3m': 3 * 60_000,
  '5m': 5 * 60_000,
  '10m': 10 * 60_000,
};
function resolveDuration(value: unknown): Duration {
  return isDuration(value) ? value : '5m';
}

// Server-side profile lookup for a queued/challenging player. Guests (userId
// null) and signed-in players who haven't finished onboarding resolve to
// nulls; callers fall back to the client-supplied displayName and the
// client's default-avatar handling. Looking the name up here rather than
// trusting the socket payload is what makes a friend challenge show the
// opponent's real stage name instead of the hardcoded 'AXL_CHESS' literal
// every play emit currently sends.
async function getPlayerIdentity(userId: string | null): Promise<{
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  rating: number | null;
  title: string | null;
}> {
  if (!userId) return { displayName: null, avatarId: null, country: null, rating: null, title: null };
  const [row] = await db
    .select({
      displayName: playerProfiles.displayName,
      avatarId: playerProfiles.avatarId,
      country: playerProfiles.country,
      rating: playerProfiles.rating,
      equippedTitleId: playerProfiles.equippedTitleId,
    })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId));
  return {
    displayName: row?.displayName ?? null,
    avatarId: row?.avatarId ?? null,
    country: row?.country ?? null,
    rating: row?.rating ?? null,
    title: titleById(row?.equippedTitleId)?.name ?? null,
  };
}

const app = express();
app.use(cors({ origin: allowedWebOrigins, credentials: true }));
// Mounted before express.json() -- better-auth's Express handler hangs if
// body parsing runs first (it reads the raw request body itself).
app.all('/api/auth/*', toNodeHandler(auth));
app.use(express.json());
app.get('/health', (_req, res) => res.json({ ok: true }));
app.use(authRouter);
// Reports unhandled route errors (5xx) to Sentry; must come before the last-resort handler below.
setupExpressMonitoring(app);

// Last-resort net for anything asyncHandler forwards (auth.ts) -- turns an
// unhandled request-time failure (e.g. the DB being unreachable) into a 500
// for that one request instead of an uncaught exception that crashes the
// whole process, taking every in-progress Socket.IO match down with it.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled request error', err);
  if (!res.headersSent) res.status(500).json({ error: 'internal-error' });
});

const httpServer = createServer(app);
const io = new Server(httpServer, { cors: { origin: allowedWebOrigins } });
io.use(socketAuth);
// Hand the io instance to realtime.ts so REST route handlers (auth.ts) can
// push per-user events (friend request accepted, ...) without the Express
// router needing an io reference of its own.
setIO(io);

// socket.id -> guestId, so a disconnect/rejoin (which gets a fresh socket.id)
// can still be matched back to whichever match its previous guestId was in.
const guestIdBySocket = new Map<string, string>();

// matchId -> set of spectating (non-seated) socket ids. Deliberately separate
// from guestIdBySocket -- a spectator socket must never resolve via colorOf,
// or it would be treated as a seated player by move:make/forfeit logic.
const spectatorsByMatch = new Map<string, Set<string>>();

function broadcastSpectateCount(matchId: string): void {
  io.to(matchId).emit('spectate:count', { matchId, count: spectatorsByMatch.get(matchId)?.size ?? 0 });
}

// Every endMatch(matchId) call site must also drop its spectator set --
// otherwise spectatorsByMatch would keep growing for matches that no longer
// exist in match.ts's own registry.
function endMatchClean(matchId: string): void {
  spectatorsByMatch.delete(matchId);
  endMatch(matchId);
}

// Tell a user's accepted friends they just came online / went offline. Fired
// once per user (on their first socket connecting / last socket leaving), not
// per socket. The initial snapshot a client needs on launch comes from the
// REST GET /me/friends payload's `online` flag, not from this.
async function broadcastPresence(userId: string, status: 'online' | 'offline'): Promise<void> {
  const friendIds = await friendIdsOf(userId);
  for (const friendId of friendIds) {
    emitToUser(friendId, 'friend:presence', { userId, status });
  }
}

// Build the QueuedPlayer for a signed-in player entering a friend challenge --
// same shape queue:join/room:* assemble, with the server-side identity lookup.
// `duration` is a placeholder; createMatch is always called with the
// challenge's own resolved duration.
async function buildChallengePlayer(
  socketId: string,
  guestId: string,
  userId: string,
): Promise<QueuedPlayer> {
  const identity = await getPlayerIdentity(userId);
  return {
    socketId,
    guestId,
    userId,
    displayName: identity.displayName || 'PLAYER',
    avatarId: identity.avatarId,
    country: identity.country,
      rating: identity.rating,
      title: identity.title,
    duration: '5m',
    insured: false,
  };
}

type EndType = 'checkmate' | 'stalemate' | 'draw' | 'resignation' | 'forfeit' | 'timeout';

// Settlements still in flight, so a SIGTERM can wait for them (see shutdown below).
const pendingSettlements = new Set<Promise<void>>();

// THE one place a match ends (it replaced seven copies of the same
// emit/persist/endMatch sequence). Order matters and is deliberate:
//   1. broadcast `match:ended` (only for endings clients cannot derive from a
//      move -- checkmate/stalemate/rule draws pass no `emit`),
//   2. endMatchClean() SYNCHRONOUSLY -- Node's single thread means the first
//      ending to reach this line wins and every later event finds no match, which
//      is what stops two endings (e.g. a move and a flag-fall) both settling,
//   3. only then the async part: settle the wager, tell the players, persist.
// Never rejects: the database must never take down live gameplay.
function finishMatch(
  match: MatchState,
  type: EndType,
  winnerColor: PieceColor | null,
  opts: { emit?: Record<string, unknown>; forceRefund?: boolean } = {},
): Promise<void> {
  if (opts.emit) io.to(match.id).emit('match:ended', { matchId: match.id, result: opts.emit });
  // A rematch window is opened (by settleAndPersist, once any stake is settled) from what the match
  // looked like at the end; the match itself is deleted right below. Never after a restart refund.
  const rematch = opts.forceRefund ? null : snapshotForRematch(match);
  endMatchClean(match.id);
  const task: Promise<void> = settleAndPersist(match, type, winnerColor, opts.forceRefund === true, rematch)
    .catch((err) => reportError(err, { area: 'match-persistence', matchId: match.id }))
    .finally(() => pendingSettlements.delete(task));
  pendingSettlements.add(task);
  return task;
}

async function settleAndPersist(
  match: MatchState,
  type: EndType,
  winnerColor: PieceColor | null,
  forceRefund: boolean,
  rematch: RematchSnapshot | null,
): Promise<void> {
  if (match.festival) {
    await settleFestivalSet(match, type, winnerColor, forceRefund);
    return;
  }
  if (!match.wager) {
    if (rematch) openRematchWindow(rematch);
    await persistMatchResult(match, type, winnerColor);
    return;
  }

  const winnerUserId = winnerColor ? match.players[winnerColor].userId : null;
  const settled = await settleWagerWithRetry(match.id, {
    resultType: type,
    winnerUserId,
    plies: match.chess.history().length,
    forceRefund,
  });
  // Settlement failed even after retries: the wager stays 'held' and the sweeper
  // refunds it. Record nothing (no rating change against unsettled chips).
  if (!settled) return;

  for (const color of ['w', 'b'] as PieceColor[]) {
    const userId = match.players[color].userId;
    const mine = userId ? settled.players[userId] : undefined;
    if (!userId || !mine) continue;
    emitToUser(userId, 'wager:settled', wagerSettledPayload(match, settled, mine));
  }

  // The stake is settled (winnings credited), so a rematch can safely re-escrow from here.
  if (rematch) openRematchWindow(rematch);

  // A void match (someone left in the first moves) leaves no trace: no rating,
  // no XP, no history row -- the stakes were simply returned.
  if (settled.outcome === 'void') return;

  await persistMatchResult(match, type, winnerColor, {
    wagered: true,
    chipsDeltaByUser: Object.fromEntries(Object.entries(settled.players).map(([uid, p]) => [uid, p.net])),
  });
}


// ---- Festival sets (a paid ladder of server-hosted bot games, see db/festival.ts) ----------

async function withRetry<T>(task: () => Promise<T>, attempts = 3): Promise<T | null> {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await task();
    } catch (error) {
      reportError(error, { area: 'festival-settle', attempt: i });
      await new Promise((resolve) => setTimeout(resolve, 250 * i));
    }
  }
  return null;
}

function festivalUpdatePayload(kind: SetSettlement['kind'] | 'interrupted', fields: Record<string, unknown>) {
  return { kind, ...fields };
}

function emitInterrupted(resolved: Resolved, matchId?: string): void {
  emitToUser(
    resolved.userId,
    'festival:update',
    festivalUpdatePayload('interrupted', { matchId, run: resolved.run, how: resolved.how, payout: resolved.payout, chips: resolved.chips }),
  );
}

// A finished set: advance / replay / lose the run (one conditional transaction), then pay the
// game's Fame / quests / achievements / Tour through the same verified path bot sessions use.
// Never the flat bot chips: the purse is the payout. The server hosted the bot, so unlike a
// device-played game there is nothing to verify about WHO the opponent was.
async function settleFestivalSet(match: MatchState, type: EndType, winnerColor: PieceColor | null, forceRefund: boolean): Promise<void> {
  const festival = match.festival;
  const bot = match.bot;
  if (!festival || !bot) return;
  const { userId, runId, humanColor } = festival;

  if (forceRefund) {
    // Server restart: the interrupted run keeps what it banked, or gets the entry back.
    const resolved = await withRetry(() => resolveInterrupted(runId));
    if (resolved) emitInterrupted(resolved, match.id);
    return;
  }

  const outcome = winnerColor === null ? 'draw' : winnerColor === humanColor ? 'win' : 'loss';
  const settled = await withRetry(() => settleSet(runId, match.id, outcome));
  // null = nothing to do (already settled) or failed after retries (the sweeper resolves it).
  if (!settled) return;

  let progression: unknown = null;
  const plies = match.chess.history().length;
  if (plies >= MIN_BOT_PLIES) {
    try {
      const facts = analyzeGame(match.chess.pgn(), humanColor);
      if (facts) {
        const applied = await applyVerifiedBotResult(userId, {
          botId: bot.botId,
          difficulty: bot.difficulty,
          color: humanColor,
          outcome,
          facts,
          payChips: false,
          matchId: match.id,
        });
        progression = applied.progression;
        emitToUser(userId, 'progression:update', applied.progression);
      }
    } catch (error) {
      reportError(error, { area: 'festival-rewards', matchId: match.id });
    }
  }

  emitToUser(
    userId,
    'festival:update',
    festivalUpdatePayload(settled.kind, {
      matchId: match.id,
      outcome,
      endedBy: type,
      run: settled.run,
      payout: settled.payout,
      chips: settled.chips,
      titleUnlocked: settled.titleUnlocked,
      bot: { id: bot.botId, name: match.players[bot.color].displayName },
      progression: progression ? true : false,
    }),
  );
}

const MIN_BOT_THINK_MS = 700;

// The bot's turn: ask the engine, wait out a natural minimum so replies do not land
// instantly, then play the move through the same path a human move takes.
async function botTurn(match: MatchState): Promise<void> {
  const bot = match.bot;
  if (!bot || bot.thinking || match.chess.isGameOver() || match.chess.turn() !== bot.color) return;
  bot.thinking = true;
  try {
    const started = Date.now();
    const move = await pickBotMove(match.chess.fen(), bot.difficulty);
    const wait = MIN_BOT_THINK_MS - (Date.now() - started);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    // The set may have ended (resign, flag, disconnect) while the engine was thinking.
    if (getMatch(match.id) !== match || match.chess.turn() !== bot.color) return;
    if (!move) {
      reportError(new Error('server bot returned no move in a live position'), { area: 'server-bot', fen: match.chess.fen() });
      return;
    }
    const chess = applyMove(match, bot.color, { from: move.from, to: move.to, promotion: move.promotion });
    if (!chess) {
      reportError(new Error(`server bot produced an illegal move ${JSON.stringify(move)}`), { area: 'server-bot', fen: match.chess.fen() });
      return;
    }
    afterAppliedMove(match, chess, { from: move.from, to: move.to, promotion: move.promotion });
  } catch (error) {
    reportError(error, { area: 'bot-turn', matchId: match.id });
  } finally {
    bot.thinking = false;
  }
}

function wagerSettledPayload(
  match: MatchState,
  settled: SettledWager,
  mine: { net: number; chipsAfter: number; payout: number; premium: number; coverPaid: number },
) {
  return {
    matchId: match.id,
    venueTier: settled.venueTier,
    outcome: settled.outcome, // 'win' pays someone; 'draw' and 'void' refund both
    buyIn: settled.buyIn,
    pot: settled.buyIn * 2,
    rake: settled.rake,
    payout: mine.payout,
    net: mine.net,
    chipsAfter: mine.chipsAfter,
    refunded: settled.outcome !== 'win',
    // Safety Net: null when this player did not buy one.
    insurance: mine.premium > 0 ? { premium: mine.premium, refund: mine.coverPaid } : null,
  };
}

// Starts the reconnect-grace countdown for a seat whose socket is gone: the
// match stays alive so a rejoin within the window picks it back up (see
// match:rejoin), otherwise the other side wins by forfeit.
function startForfeitCountdown(match: MatchState, color: PieceColor): void {
  if (match.forfeitTimers[color]) return;
  io.to(match.id).emit('match:opponentDisconnected', { color });
  match.forfeitTimers[color] = setTimeout(() => {
    void finishMatch(match, 'forfeit', opponentColor(color), {
      emit: { type: 'forfeit', winner: opponentColor(color) },
    });
  }, RECONNECT_GRACE_MS);
}

// Fires when a side's clock deadline elapses without them moving. match.ts
// can't own this itself: it has no Socket.IO `io` access, so index.ts (which
// does) is responsible for arming/clearing/rescheduling match.clock.deadlineTimer
// at every point the active side changes (see notifyMatched below and
// move:make's handler further down).
function fireTimeout(match: MatchState, flaggedColor: PieceColor): void {
  const winner = opponentColor(flaggedColor);
  // FIDE 6.9: a flag-fall is only a loss if the other side could still
  // checkmate. Bare king / K+N / K+B on time -> draw.
  if (!canDeliverMate(match.chess, winner)) {
    void finishMatch(match, 'draw', null, { emit: { type: 'draw', winner: null, reason: 'insufficientVsTimeout' } });
    return;
  }
  void finishMatch(match, 'timeout', winner, { emit: { type: 'timeout', winner } });
}

const isSocketLive = (socketId: string): boolean => io.sockets.sockets.get(socketId)?.connected === true;

// Puts a still-connected player back in a tier's queue after a pairing fell
// through (their opponent left or could not afford the buy-in), pairing them
// again immediately if someone else is already waiting.
function requeue(player: QueuedPlayer, tier: VenueTier): void {
  if (!isSocketLive(player.socketId)) return;
  const next = joinQueue(tier, player);
  if (next) void startPairedMatch(next.opponent, player, tier, { duration: next.duration });
}

// A pair just formed in a venue queue. Free venues (Garage) go straight to a
// match. Wagered venues first ESCROW both buy-ins -- before the match exists --
// and only then create it, so there is never a live match whose stake was not
// secured. Anything that goes wrong after the money moves refunds it.
// `opts.whiteFirst` (a rematch) names who plays White instead of the coin flip; `opts.rematch` makes a
// failed pairing report `rematch:error` to the two players instead of putting them back in the queue.
interface PairOptions {
  // The time control to play at (the matchmaking pairing's agreed clock); defaults to the waiting player's pick.
  duration?: Duration;
  whiteFirst?: QueuedPlayer;
  rematch?: boolean;
}

async function startPairedMatch(waiting: QueuedPlayer, joiner: QueuedPlayer, tier: VenueTier, opts: PairOptions = {}): Promise<void> {
  // The player who was already waiting sets the clock -- see QueuedPlayer.duration.
  const baseMs = DURATION_MS[opts.duration ?? waiting.duration];
  const stake = stakeFor(tier);
  if (!stake) {
    notifyMatched(createMatch(waiting, joiner, baseMs, 0, { venueTier: tier, ...(opts.whiteFirst ? { whiteIsA: opts.whiteFirst === waiting } : {}) }));
    return;
  }
  const failRematch = (reason: string, extra: Record<string, unknown> = {}) => {
    for (const p of [waiting, joiner]) io.to(p.socketId).emit('rematch:error', { reason, ...extra });
  };

  const waitingLive = isSocketLive(waiting.socketId);
  const joinerLive = isSocketLive(joiner.socketId);
  if (opts.rematch && (!waitingLive || !joinerLive)) {
    failRematch('opponent-left');
    return;
  }
  if (!waitingLive || !joinerLive) {
    // A socket died between queuing and pairing (e.g. during the identity
    // lookup): never charge anyone for a match that cannot start.
    if (waitingLive) requeue(waiting, tier);
    if (joinerLive) requeue(joiner, tier);
    return;
  }

  const matchId = randomUUID();
  const whiteIsWaiting = opts.whiteFirst ? opts.whiteFirst === waiting : Math.random() < 0.5;
  const [white, black] = whiteIsWaiting ? [waiting, joiner] : [joiner, waiting];
  let escrow;
  try {
    escrow = await escrowWager(matchId, tier, white.userId as string, black.userId as string, { white: white.insured, black: black.insured });
  } catch (error) {
    reportError(error, { area: 'wager-escrow', tier });
    if (opts.rematch) failRematch('unavailable');
    else for (const p of [waiting, joiner]) io.to(p.socketId).emit('queue:error', { reason: 'unavailable' });
    return;
  }
  if (escrow.status === 'insufficient-chips' && opts.rematch) {
    // Nobody was charged (the escrow is all-or-nothing): tell the short player what they needed, and the other why.
    const short = escrow.userId === waiting.userId ? waiting : joiner;
    const need = stake.buyIn + (short.insured ? safetyNetTerms(stake.buyIn).premium : 0);
    io.to(short.socketId).emit('rematch:error', { reason: 'insufficient-chips', required: need });
    io.to((short === waiting ? joiner : waiting).socketId).emit('rematch:error', { reason: 'opponent-short' });
    return;
  }
  if (escrow.status === 'insufficient-chips') {
    // Their balance dropped since they joined (spent elsewhere / another match).
    const short = escrow.userId === waiting.userId ? waiting : joiner;
    const other = short === waiting ? joiner : waiting;
    io.to(short.socketId).emit('queue:error', { reason: 'insufficient-chips', required: stake.buyIn + (short.insured ? safetyNetTerms(stake.buyIn).premium : 0) });
    requeue(other, tier);
    return;
  }

  let match: MatchState;
  try {
    match = createMatch(waiting, joiner, baseMs, 0, {
      id: matchId,
      whiteIsA: whiteIsWaiting,
      venueTier: tier,
      wager: { venueTier: tier, buyIn: stake.buyIn, prize: stake.prize },
    });
  } catch (error) {
    reportError(error, { area: 'wager-create-after-escrow', tier });
    await settleWagerWithRetry(matchId, { resultType: 'draw', winnerUserId: null, plies: 0, forceRefund: true });
    for (const p of [waiting, joiner]) io.to(p.socketId).emit('queue:error', { reason: 'unavailable' });
    return;
  }

  // A socket that dropped during the escrow await may have reconnected on a new
  // socket id (and queued again) -- rebind the seat to its live socket instead of
  // starting a forfeit clock against a player who is actually still here.
  for (const color of ['w', 'b'] as PieceColor[]) {
    const seat = match.players[color];
    if (isSocketLive(seat.socketId) || !seat.userId) continue;
    const alternative = socketIdsForUser(seat.userId).find(isSocketLive);
    if (alternative) {
      seat.socketId = alternative;
      removeFromQueues((p) => p.userId === seat.userId);
    }
  }
  notifyMatched(match);
  for (const color of ['w', 'b'] as PieceColor[]) {
    if (!isSocketLive(match.players[color].socketId)) startForfeitCountdown(match, color);
  }
}

// ---- Rematch (see rematch.ts): "play again" against the same opponent, colours swapped ----------

// A seat's current socket: the last one it used, or any other live socket of the same account.
function liveSocketForSeat(seat: RematchSeat): string | null {
  if (isSocketLive(seat.socketId)) return seat.socketId;
  if (seat.userId) return socketIdsForUser(seat.userId).find(isSocketLive) ?? null;
  return null;
}

function emitToRematchSeat(window: RematchWindow, color: PieceColor, event: string, payload: Record<string, unknown>): void {
  const socketId = liveSocketForSeat(window.seats[color]);
  if (socketId) io.to(socketId).emit(event, { matchId: window.matchId, ...payload });
}

function openRematchWindow(snapshot: RematchSnapshot): void {
  openRematch(snapshot, (window) => {
    for (const color of ['w', 'b'] as PieceColor[]) emitToRematchSeat(window, color, 'rematch:expired', {});
  });
}

const durationKeyFor = (baseMs: number): Duration =>
  (Object.keys(DURATION_MS) as Duration[]).find((key) => DURATION_MS[key] === baseMs) ?? '5m';

// Both players want it: start the same game again with the colours swapped. Everything is re-checked as if
// it were a fresh pairing (live sockets, not already in a match, rating gate, balance), and a wagered
// rematch goes through the same atomic escrow as any venue match, so nobody can be charged for a game that
// does not start.
async function startRematch(window: RematchWindow): Promise<void> {
  if (!closeRematch(window.matchId)) return; // single shot: an accept racing an expiry/leave starts nothing
  const colors: PieceColor[] = ['w', 'b'];
  const fail = (reason: string, extra: Record<string, unknown> = {}) => {
    for (const color of colors) emitToRematchSeat(window, color, 'rematch:error', { reason, ...extra });
  };
  try {
    if (colors.some((c) => !liveSocketForSeat(window.seats[c]))) {
      fail('opponent-left');
      return;
    }
    for (const live of allMatches()) {
      if (colors.some((c) => colorOf(live, window.seats[c].guestId))) {
        fail('already-in-match');
        return;
      }
    }

    // Ratings and titles may have changed in the match that just ended.
    const identities = await Promise.all(colors.map((c) => getPlayerIdentity(window.seats[c].userId)));
    const players = Object.fromEntries(
      colors.map((c, i): [PieceColor, QueuedPlayer] => {
        const seat = window.seats[c];
        return [
          c,
          {
            socketId: liveSocketForSeat(seat) as string,
            guestId: seat.guestId,
            userId: seat.userId,
            displayName: identities[i].displayName || seat.displayName,
            avatarId: identities[i].avatarId ?? seat.avatarId,
            country: identities[i].country ?? seat.country,
            rating: identities[i].rating ?? seat.rating,
            title: identities[i].title ?? seat.title,
            duration: durationKeyFor(window.baseMs),
            insured: seat.insured,
          },
        ];
      }),
    ) as Record<PieceColor, QueuedPlayer>;
    // Colours swap: whoever had Black now has White.
    const [newWhite, newBlack] = [players.b, players.w];

    if (window.stake && window.venueTier && isVenueTier(window.venueTier)) {
      const tier = window.venueTier;
      const minRating = (ECONOMY.venues as Record<string, { minRating: number }>)[tier].minRating;
      for (const c of colors) {
        const entry = window.seats[c].userId ? await getEntryProfile(window.seats[c].userId as string) : null;
        if (!entry) {
          fail('auth-required');
          return;
        }
        if (entry.rating < minRating) {
          emitToRematchSeat(window, c, 'rematch:error', { reason: 'rating-too-low', required: minRating, current: entry.rating });
          emitToRematchSeat(window, opponentColor(c), 'rematch:error', { reason: 'opponent-ineligible' });
          return;
        }
      }
      await startPairedMatch(newBlack, newWhite, tier, { whiteFirst: newWhite, rematch: true });
      return;
    }

    notifyMatched(
      createMatch(newWhite, newBlack, window.baseMs, 0, {
        whiteIsA: true,
        venueTier: window.venueTier,
        friendly: window.friendly,
      }),
    );
  } catch (error) {
    reportError(error, { area: 'rematch' });
    fail('unavailable');
  }
}

// Joins both sockets to the match's Socket.IO room and tells each color's
// socket who they're playing -- the one piece of "a pair just formed"
// logic shared by both pairing paths (tier queue and room code), so it
// isn't duplicated between queue:join and room:join below. Also arms
// White's clock deadline -- White's clock is already running from move 1,
// standard chess-clock convention -- since createMatch itself can't (no io
// access, see fireTimeout's comment).
// What the client needs to show the stakes: which venue this really is (it used
// to trust its own route param) and the buy-in / prize at stake (0 = unwagered).
function venueFields(match: MatchState): { venueTier: string; buyIn: number; prize: number; friendly: boolean } {
  return { venueTier: match.venueTier ?? 'garage', buyIn: match.wager?.buyIn ?? 0, prize: match.wager?.prize ?? 0, friendly: match.friendly === true };
}

// What the app needs to draw a Festival set: the run, which set this is, and the bot's face.
function festivalFields(match: MatchState): Record<string, unknown> {
  const run = match.festival;
  const bot = match.bot ? botById(match.bot.botId) : undefined;
  const tier = run ? tierById(run.tierId) : undefined;
  if (!run || !bot || !tier) return {};
  return {
    festival: {
      runId: run.runId,
      tierId: tier.id,
      tierName: tier.name,
      setIndex: run.setIndex,
      totalSets: tier.sets.length,
      purse: tier.purse,
      banked: run.setIndex === 0 ? 0 : tier.purse[run.setIndex - 1],
      nextPurse: tier.purse[run.setIndex],
      bot: { id: bot.id, name: bot.name, emoji: bot.emoji, difficulty: bot.difficulty },
    },
  };
}

// A Festival set has one human seat: only that socket joins the room and is told, and the
// bot moves first when it is White.
function notifyFestivalMatched(match: MatchState): void {
  const festival = match.festival;
  const bot = match.bot;
  if (!festival || !bot) return;
  const human = match.players[festival.humanColor];
  io.sockets.sockets.get(human.socketId)?.join(match.id);
  match.clock.deadlineTimer = setTimeout(() => fireTimeout(match, 'w'), match.clock.remainingMs.w);
  const opp = match.players[bot.color];
  io.to(human.socketId).emit('queue:matched', {
    matchId: match.id,
    color: festival.humanColor,
    opponent: { userId: null, displayName: opp.displayName, avatarId: null, country: null, rating: null, title: null },
    fen: match.chess.fen(),
    clocks: match.clock.remainingMs,
    incrementMs: match.clock.incrementMs,
    ...venueFields(match),
    ...festivalFields(match),
  });
  if (bot.color === 'w') void botTurn(match);
}

function notifyMatched(match: MatchState): void {
  io.sockets.sockets.get(match.players.w.socketId)?.join(match.id);
  io.sockets.sockets.get(match.players.b.socketId)?.join(match.id);

  match.clock.deadlineTimer = setTimeout(() => fireTimeout(match, 'w'), match.clock.remainingMs.w);

  for (const color of ['w', 'b'] as PieceColor[]) {
    const me = match.players[color];
    const opp = match.players[opponentColor(color)];
    io.to(me.socketId).emit('queue:matched', {
      matchId: match.id,
      color,
      opponent: { userId: opp.userId, displayName: opp.displayName, avatarId: opp.avatarId, country: opp.country, rating: opp.rating, title: opp.title },
      fen: match.chess.fen(),
      clocks: match.clock.remainingMs,
      incrementMs: match.clock.incrementMs,
      ...venueFields(match),
    });
  }
}

// Everything that follows a move that applyMove accepted -- shared by human moves
// (move:make) and the server bot's replies (botTurn).
function afterAppliedMove(
  match: MatchState,
  chess: Chess,
  move: { from: string; to: string; promotion?: 'q' | 'r' | 'b' | 'n' },
): void {
  // applyMove already deducted the mover's elapsed time (+ increment) into
  // match.clock -- clear their now-stale deadline (they just moved, it no
  // longer applies) and arm one for whoever's turn it is now. Clearing
  // before anything else that could yield is what makes "a move lands
  // right as the old timer would have fired" safe: Node's single-threaded
  // event loop means whichever callback actually got invoked first wins
  // outright, no mutex needed.
  if (match.clock.deadlineTimer) clearTimeout(match.clock.deadlineTimer);
  const nextColor = chess.turn();
  match.clock.deadlineTimer = setTimeout(() => fireTimeout(match, nextColor), match.clock.remainingMs[nextColor]);

  // A draw offer doesn't survive a change in the position.
  if (match.drawOfferBy) {
    match.drawOfferBy = undefined;
    io.to(match.id).emit('draw:cleared', { matchId: match.id });
  }

  io.to(match.id).emit('move:applied', {
    matchId: match.id,
    from: move.from,
    to: move.to,
    promotion: move.promotion ?? 'q',
    fen: chess.fen(),
    turn: chess.turn(),
    isGameOver: chess.isGameOver(),
    clocks: match.clock.remainingMs,
  });

  if (chess.isGameOver()) {
    let resultType: 'checkmate' | 'stalemate' | 'draw';
    let winnerColor: PieceColor | null = null;
    if (chess.isCheckmate()) {
      resultType = 'checkmate';
      winnerColor = opponentColor(chess.turn());
    } else if (chess.isStalemate()) {
      resultType = 'stalemate';
    } else {
      resultType = 'draw';
    }
    // No `emit`: clients derive checkmate/stalemate/rule draws from
    // move:applied.isGameOver. Settlement and persistence never gate or delay
    // the realtime flow above, which has already completed by this point.
    void finishMatch(match, resultType, winnerColor);
    return;
  }

  if (match.bot && chess.turn() === match.bot.color) void botTurn(match);
}

// Soft email gate (db/emailGate.ts): an account that has not verified its email yet is refused on the online and
// social actions and told why, so the app can open its "verify your email" prompt. Guests are not accounts and are
// never gated here (they have no progress or wagers to protect); with EMAIL_GATE off this is always false.
async function blockedByEmailGate(socket: Socket): Promise<boolean> {
  const uid = socket.data.userId as string | undefined;
  if (!uid || !(await needsEmailVerification(uid))) return false;
  socket.emit('account:gate', { reason: 'email-unverified' });
  return true;
}

io.on('connection', (socket: Socket) => {
  // Signed-in sockets join a per-user room so realtime.ts's emitToUser can
  // reach every device this account has open, and register with the presence
  // map. Guests skip all of this -- friends/DMs/challenges are account-only.
  const authedUserId = (socket.data.userId as string | undefined) ?? undefined;
  if (authedUserId) {
    socket.join(`user:${authedUserId}`);
    const { wasFirst } = addUserSocket(authedUserId, socket.id);
    if (wasFirst) {
      broadcastPresence(authedUserId, 'online').catch((err) =>
        console.error('presence broadcast failed', err),
      );
    }
  }

  socket.on('friend:challenge', async (payload: { guestId?: string; toUserId?: string; duration?: string }) => {
    const uid = socket.data.userId as string | undefined;
    if (!uid || !payload?.guestId || !payload?.toUserId) return;
    if (payload.toUserId === uid) return;
    if (await blockedByEmailGate(socket)) return;

    if (!(await areFriends(uid, payload.toUserId))) {
      socket.emit('friend:challenge:error', { reason: 'not-friends' });
      return;
    }
    if (!isUserOnline(payload.toUserId)) {
      socket.emit('friend:challenge:error', { reason: 'offline' });
      return;
    }

    guestIdBySocket.set(socket.id, payload.guestId);
    const duration = resolveDuration(payload.duration);
    const challenger = await buildChallengePlayer(socket.id, payload.guestId, uid);
    const challengeId = createChallenge(challenger, payload.toUserId, duration, (expired) => {
      emitToUser(uid, 'friend:challenge:expired', { challengeId: expired.id });
      emitToUser(expired.toUserId, 'friend:challenge:cancelled', { challengeId: expired.id });
    });

    emitToUser(payload.toUserId, 'friend:challenge:incoming', {
      challengeId,
      from: { userId: uid, displayName: challenger.displayName, avatarId: challenger.avatarId, country: challenger.country },
      duration,
      expiresInMs: CHALLENGE_TTL_MS,
    });
    await insertNotification(
      payload.toUserId,
      'friend_challenge_received',
      'Challenge received',
      `${challenger.displayName} challenged you to a ${duration} match.`,
      { challengeId, fromUserId: uid },
    );
    socket.emit('friend:challenge:sent', { challengeId, toUserId: payload.toUserId, duration });
  });

  socket.on(
    'friend:challenge:respond',
    async (payload: { guestId?: string; challengeId?: string; accept?: boolean }) => {
      const uid = socket.data.userId as string | undefined;
      if (!uid || !payload?.guestId || !payload?.challengeId) return;
      if (await blockedByEmailGate(socket)) return;

      const challenge = consumeChallenge(payload.challengeId);
      if (!challenge || challenge.toUserId !== uid) {
        socket.emit('friend:challenge:error', { reason: 'expired' });
        return;
      }

      const challengerUserId = challenge.challenger.userId;
      if (!challengerUserId) return;

      if (!payload.accept) {
        emitToUser(challengerUserId, 'friend:challenge:declined', { challengeId: challenge.id });
        return;
      }

      // The challenger may have reconnected (new socket.id) between sending and
      // now -- rebind to their current socket, or bail if they've gone.
      const [liveSocketId] = socketIdsForUser(challengerUserId);
      if (!liveSocketId) {
        socket.emit('friend:challenge:error', { reason: 'challenger-left' });
        return;
      }
      challenge.challenger.socketId = liveSocketId;
      guestIdBySocket.set(liveSocketId, challenge.challenger.guestId);
      guestIdBySocket.set(socket.id, payload.guestId);

      const accepter = await buildChallengePlayer(socket.id, payload.guestId, uid);
      notifyMatched(createMatch(challenge.challenger, accepter, DURATION_MS[challenge.duration], 0, { friendly: true }));
    },
  );

  socket.on('friend:challenge:cancel', (payload: { challengeId?: string }) => {
    const uid = socket.data.userId as string | undefined;
    if (!uid || !payload?.challengeId) return;
    const challenge = consumeChallenge(payload.challengeId);
    if (!challenge || challenge.challenger.userId !== uid) return;
    emitToUser(challenge.toUserId, 'friend:challenge:cancelled', { challengeId: challenge.id });
  });

  socket.on('dm:send', async (payload: { toUserId?: string; text?: string }) => {
    const uid = socket.data.userId as string | undefined;
    if (!uid || !payload?.toUserId || payload.toUserId === uid) return;
    if (await blockedByEmailGate(socket)) return;

    const text = sanitizeChatText(payload.text);
    if (!text || !allowChatMessage(socket.id)) return;

    const result = await persistMessage(uid, payload.toUserId, text);
    if (result.status !== 'ok') return;

    const dto = {
      id: result.message.id,
      conversationId: result.message.conversationId,
      fromUserId: uid,
      toUserId: payload.toUserId,
      text: result.message.text,
      sentAt: result.message.sentAt.getTime(),
    };
    // To the recipient's devices and back to the sender's own other devices --
    // the sending screen inserts optimistically and de-dupes on `id`.
    emitToUser(payload.toUserId, 'dm:message', dto);
    emitToUser(uid, 'dm:message', dto);
    void pushDirectMessage(uid, payload.toUserId, result.message.text, result.message.conversationId);
  });

  // The client tells us when the app goes to / comes back from the background, so push.ts can tell "has a
  // socket" from "is looking at the game".
  socket.on('app:state', (payload: { foreground?: boolean }) => {
    const uid = socket.data.userId as string | undefined;
    if (!uid) return;
    setSocketForeground(uid, socket.id, payload?.foreground === true);
  });

  socket.on(
    'queue:join',
    async (payload: { guestId?: string; displayName?: string; venueTier?: string; duration?: string; insured?: boolean; widen?: boolean }) => {
      if (!payload?.guestId || !isVenueTier(payload.venueTier)) {
        socket.emit('queue:error', { reason: 'bad-tier' });
        return;
      }
      const tier = payload.venueTier;
      guestIdBySocket.set(socket.id, payload.guestId);
      if (await blockedByEmailGate(socket)) return;

      const userId = (socket.data.userId as string | undefined) ?? null;

      // Wagered venues: signed-in only, enough rating, enough chips, and not already
      // seated in a live match. Garage skips all of it. The pairing step re-checks
      // the balance atomically (escrowWager) -- this is the early, friendly answer.
      const stake = stakeFor(tier);
      // Safety Net (db/wagers.ts): an optional add-on, wagered venues and accounts only.
      const insured = !!stake && !!userId && payload.insured === true;
      const premium = stake && insured ? safetyNetTerms(stake.buyIn).premium : 0;
      if (stake) {
        if (!userId) {
          socket.emit('queue:error', { reason: 'auth-required' });
          return;
        }
        const entry = await getEntryProfile(userId);
        if (!socket.connected) return; // gone during the lookup -- never queue a dead socket
        if (!entry) {
          socket.emit('queue:error', { reason: 'auth-required' });
          return;
        }
        const required = (ECONOMY.venues as Record<string, { minRating: number }>)[tier].minRating;
        if (entry.rating < required) {
          socket.emit('queue:error', { reason: 'rating-too-low', required, current: entry.rating });
          return;
        }
        if (entry.chips < stake.buyIn + premium) {
          socket.emit('queue:error', { reason: 'insufficient-chips', required: stake.buyIn + premium, current: entry.chips });
          return;
        }
        for (const live of allMatches()) {
          if (live.players.w.userId === userId || live.players.b.userId === userId) {
            socket.emit('queue:error', { reason: 'already-in-match' });
            return;
          }
        }
      }

      const identity = await getPlayerIdentity(userId);
      if (!socket.connected) return;
      const player: QueuedPlayer = {
        socketId: socket.id,
        guestId: payload.guestId,
        userId,
        displayName: identity.displayName || payload.displayName || 'PLAYER',
        avatarId: identity.avatarId,
        country: identity.country,
      rating: identity.rating,
      title: identity.title,
        duration: resolveDuration(payload.duration),
        insured,
        // A reconnect re-sends queue:join; a player who had already widened stays widened.
        flex: payload.widen === true,
      };

      // ONE queue entry per socket, per guest and per account: an account on a
      // second device replaces its first entry (so it can never be paired against
      // itself for a wager), and a socket can't sit in two tiers at once.
      const replaced = removeFromQueues(
        (p) => p.socketId === socket.id || p.guestId === payload.guestId || (userId !== null && p.userId === userId),
      );
      for (const old of replaced) {
        if (old.socketId !== socket.id && isSocketLive(old.socketId)) {
          io.to(old.socketId).emit('queue:error', { reason: 'replaced' });
        }
      }

      const pairing = joinQueue(tier, player);
      if (!pairing) return; // now waiting in queue
      await startPairedMatch(pairing.opponent, player, tier, { duration: pairing.duration });
    },
  );

  // The player waited a while and agreed to also play other time controls. Opt-in, so a clock is never
  // forced on anyone: the game is played at the clock the OTHER player picked.
  socket.on('queue:widen', async () => {
    const widened = widenQueued(socket.id);
    socket.emit('queue:widened', {});
    if (widened) await startPairedMatch(widened.pairing.opponent, widened.player, widened.tier, { duration: widened.pairing.duration });
  });

  socket.on('queue:leave', () => {
    leaveQueue(socket.id);
  });

  socket.on('room:create', async (payload: { guestId?: string; displayName?: string; duration?: string }) => {
    if (!payload?.guestId) return;
    if (await blockedByEmailGate(socket)) return;
    guestIdBySocket.set(socket.id, payload.guestId);

    const userId = (socket.data.userId as string | undefined) ?? null;
    const identity = await getPlayerIdentity(userId);
    const player: QueuedPlayer = {
      socketId: socket.id,
      guestId: payload.guestId,
      userId,
      displayName: identity.displayName || payload.displayName || 'PLAYER',
      avatarId: identity.avatarId,
      country: identity.country,
      rating: identity.rating,
      title: identity.title,
      duration: resolveDuration(payload.duration),
      insured: false,
    };
    socket.emit('room:created', { code: createRoom(player) });
  });

  socket.on('room:join', async (payload: { guestId?: string; displayName?: string; code?: string }) => {
    if (!payload?.guestId || !payload?.code) return;
    if (await blockedByEmailGate(socket)) return;
    guestIdBySocket.set(socket.id, payload.guestId);

    const userId = (socket.data.userId as string | undefined) ?? null;
    const identity = await getPlayerIdentity(userId);
    const player: QueuedPlayer = {
      socketId: socket.id,
      guestId: payload.guestId,
      userId,
      displayName: identity.displayName || payload.displayName || 'PLAYER',
      avatarId: identity.avatarId,
      country: identity.country,
      rating: identity.rating,
      title: identity.title,
      // The joiner's own duration is irrelevant -- the room creator's
      // (result.opponent below) is what createMatch actually uses, since
      // they're the one who set the room up in the first place.
      duration: '5m',
      insured: false,
    };
    const result = joinRoom(payload.code, player);
    if (result.status !== 'ok') {
      socket.emit('room:error', { reason: result.status });
      return;
    }

    notifyMatched(createMatch(result.opponent, player, DURATION_MS[result.opponent.duration], 0, { friendly: true }));
  });

  socket.on('room:cancel', () => {
    cancelRoomBySocketId(socket.id);
  });

  // Starts the next set of the player's active Festival run: claims the set (ready ->
  // playing, atomic), then seats the player against a bot the server plays itself.
  socket.on('festival:start-set', async (payload: { guestId?: string; runId?: string }) => {
    const uid = socket.data.userId as string | undefined;
    const fail = (reason: string) => socket.emit('festival:error', { reason });
    if (!uid) return fail('auth-required');
    if (!payload?.guestId || typeof payload.runId !== 'string') return fail('bad-request');
    if (await blockedByEmailGate(socket)) return;
    guestIdBySocket.set(socket.id, payload.guestId);
    for (const live of allMatches()) {
      if (live.players.w.userId === uid || live.players.b.userId === uid) return fail('already-in-match');
    }
    removeFromQueues((p) => p.userId === uid);

    const matchId = randomUUID();
    let run;
    try {
      run = await beginSet(uid, payload.runId, matchId);
    } catch (error) {
      reportError(error, { area: 'festival-begin-set' });
      return fail('unavailable');
    }
    if (!run) return fail('not-ready');

    const tier = tierById(run.tierId);
    const bot = tier ? botById(tier.sets[run.setIndex]) : undefined;
    if (!tier || !bot) {
      await revertSet(run.id, matchId).catch((e) => console.error('festival revert failed', e));
      return fail('unavailable');
    }
    try {
      const identity = await getPlayerIdentity(uid);
      if (!socket.connected) {
        await revertSet(run.id, matchId);
        return;
      }
      const humanColor: PieceColor = (run.setIndex + run.replaysUsed) % 2 === 0 ? 'w' : 'b';
      const match = createFestivalMatch(
        matchId,
        {
          socketId: socket.id,
          guestId: payload.guestId,
          userId: uid,
          displayName: identity.displayName || 'PLAYER',
          avatarId: identity.avatarId,
          country: identity.country,
          rating: identity.rating,
          title: identity.title,
        },
        humanColor,
        { botId: bot.id, name: bot.name, difficulty: bot.difficulty },
        { runId: run.id, tierId: tier.id, setIndex: run.setIndex },
        FESTIVAL_SET_CLOCK_MS,
      );
      notifyFestivalMatched(match);
    } catch (error) {
      reportError(error, { area: 'festival-set-creation' });
      await revertSet(run.id, matchId).catch((e) => console.error('festival revert failed', e));
      fail('unavailable');
    }
  });

  socket.on('move:make', (payload: { matchId?: string; from?: string; to?: string; promotion?: 'q' | 'r' | 'b' | 'n' }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId || !payload?.from || !payload?.to) return;
    const color = seatColor(match, guestId, socket.data.userId as string | undefined);
    if (!color) return;

    const chess = applyMove(match, color, { from: payload.from, to: payload.to, promotion: payload.promotion });
    if (!chess) {
      // Hand back the authoritative position so a desynced client can snap
      // to it instead of dead-ending (every later move would also be rejected).
      socket.emit('move:rejected', {
        reason: 'illegal-move',
        fen: match.chess.fen(),
        turn: match.chess.turn(),
      });
      return;
    }

    afterAppliedMove(match, chess, { from: payload.from, to: payload.to, promotion: payload.promotion });
  });

  socket.on('match:resign', (payload: { matchId?: string }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = seatColor(match, guestId, socket.data.userId as string | undefined);
    if (!color) return;

    void finishMatch(match, 'resignation', opponentColor(color), {
      emit: { type: 'resignation', winner: opponentColor(color) },
    });
  });

  // ---- Rematch: offer -> the other player accepts or declines (see rematch.ts) ----------------
  // The seat is named by guestId (and, for a wagered or friendly match, the signed-in account), exactly like draw:*.
  function rematchSeat(matchId: unknown): { window: RematchWindow; color: PieceColor } | null {
    const guestId = guestIdBySocket.get(socket.id);
    const window = typeof matchId === 'string' ? getRematch(matchId) : undefined;
    if (!window || !guestId) return null;
    const color = rematchSeatColor(window, guestId, socket.data.userId as string | undefined);
    if (!color) return null;
    window.seats[color].socketId = socket.id; // the seat speaks from here now
    return { window, color };
  }

  socket.on('rematch:offer', (payload: { matchId?: string }) => {
    const seat = rematchSeat(payload?.matchId);
    if (!seat) {
      socket.emit('rematch:error', { matchId: payload?.matchId, reason: 'unavailable' });
      return;
    }
    const { window, color } = seat;
    const other = opponentColor(color);
    if (!liveSocketForSeat(window.seats[other])) {
      closeRematch(window.matchId);
      socket.emit('rematch:error', { matchId: window.matchId, reason: 'opponent-left' });
      return;
    }
    if (window.offeredBy === color) return;
    // Both tapped Rematch: that is an accept from the second one.
    if (window.offeredBy === other) {
      void startRematch(window);
      return;
    }
    window.offeredBy = color;
    emitToRematchSeat(window, other, 'rematch:offered', {
      from: window.seats[color].displayName,
      venueTier: window.venueTier ?? null,
      buyIn: window.stake?.buyIn ?? 0,
      prize: window.stake?.prize ?? 0,
      insured: window.seats[other].insured,
      friendly: window.friendly,
    });
  });

  socket.on('rematch:respond', (payload: { matchId?: string; accept?: boolean }) => {
    const seat = rematchSeat(payload?.matchId);
    if (!seat) {
      socket.emit('rematch:error', { matchId: payload?.matchId, reason: 'unavailable' });
      return;
    }
    const { window, color } = seat;
    // Only the player who was ASKED can answer.
    if (!window.offeredBy || window.offeredBy === color) return;
    if (payload.accept === true) {
      void startRematch(window);
      return;
    }
    closeRematch(window.matchId);
    emitToRematchSeat(window, window.offeredBy, 'rematch:declined', { reason: 'declined' });
  });

  socket.on('rematch:cancel', (payload: { matchId?: string }) => {
    const seat = rematchSeat(payload?.matchId);
    if (!seat || seat.window.offeredBy !== seat.color) return;
    closeRematch(seat.window.matchId);
    emitToRematchSeat(seat.window, opponentColor(seat.color), 'rematch:cancelled', {});
  });

  // The player left the result screen: nobody should keep waiting on them.
  socket.on('rematch:leave', (payload: { matchId?: string }) => {
    const seat = rematchSeat(payload?.matchId);
    if (!seat) return;
    closeRematch(seat.window.matchId);
    emitToRematchSeat(seat.window, opponentColor(seat.color), 'rematch:declined', { reason: 'left' });
  });

  socket.on('draw:offer', (payload: { matchId?: string }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = seatColor(match, guestId, socket.data.userId as string | undefined);
    if (!color || match.drawOfferBy || match.chess.isGameOver()) return;
    // The house band never agrees to a draw: a paid set is played out.
    if (match.bot) {
      socket.emit('draw:declined', { matchId: match.id });
      return;
    }

    match.drawOfferBy = color;
    io.to(match.id).emit('draw:offered', { matchId: match.id, color });
  });

  socket.on('draw:respond', (payload: { matchId?: string; accept?: boolean }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = seatColor(match, guestId, socket.data.userId as string | undefined);
    // Only the player who DIDN'T offer can answer.
    if (!color || !match.drawOfferBy || match.drawOfferBy === color) return;

    if (payload.accept) {
      void finishMatch(match, 'draw', null, { emit: { type: 'draw', winner: null } });
      return;
    }
    match.drawOfferBy = undefined;
    io.to(match.id).emit('draw:declined', { matchId: match.id });
  });

  socket.on('spectate:join', (payload: { matchId?: string }) => {
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || match.bot) {
      socket.emit('spectate:error', { matchId: payload?.matchId ?? null, reason: 'not-found' });
      return;
    }

    socket.join(match.id);
    if (!spectatorsByMatch.has(match.id)) spectatorsByMatch.set(match.id, new Set());
    spectatorsByMatch.get(match.id)!.add(socket.id);

    socket.emit('spectate:joined', {
      matchId: match.id,
      fen: match.chess.fen(),
      turn: match.chess.turn(),
      clocks: liveClockRemaining(match),
      players: {
        w: { displayName: match.players.w.displayName, avatarId: match.players.w.avatarId, country: match.players.w.country },
        b: { displayName: match.players.b.displayName, avatarId: match.players.b.avatarId, country: match.players.b.country },
      },
    });
    broadcastSpectateCount(match.id);
  });

  socket.on('spectate:leave', (payload: { matchId?: string }) => {
    if (!payload?.matchId) return;
    socket.leave(payload.matchId);
    const spectators = spectatorsByMatch.get(payload.matchId);
    if (spectators?.delete(socket.id)) broadcastSpectateCount(payload.matchId);
  });

  socket.on('match:chat:send', (payload: { matchId?: string; text?: string }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = colorOf(match, guestId);
    if (!color) return; // only the two seated players can chat in their own match

    const text = sanitizeChatText(payload.text);
    if (!text || !allowChatMessage(socket.id)) return;

    io.to(match.id).emit('match:chat:message', {
      color,
      displayName: match.players[color].displayName,
      text,
      sentAt: Date.now(),
    });
  });

  socket.on('match:rejoin', (payload: { matchId?: string; guestId?: string }) => {
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !payload?.guestId) return;
    const color = seatColor(match, payload.guestId, socket.data.userId as string | undefined);
    if (!color) return;

    guestIdBySocket.set(socket.id, payload.guestId);
    match.players[color].socketId = socket.id;
    socket.join(match.id);

    const timer = match.forfeitTimers[color];
    if (timer) {
      clearTimeout(timer);
      delete match.forfeitTimers[color];
      io.to(match.id).emit('match:opponentReconnected', { color });
    }

    socket.emit('queue:matched', {
      matchId: match.id,
      color,
      opponent: {
        userId: match.players[opponentColor(color)].userId,
        displayName: match.players[opponentColor(color)].displayName,
        avatarId: match.players[opponentColor(color)].avatarId,
        country: match.players[opponentColor(color)].country,
        rating: match.players[opponentColor(color)].rating,
        title: match.players[opponentColor(color)].title,
      },
      fen: match.chess.fen(),
      // A live snapshot, not the possibly-stale anchor -- the clock kept
      // running the whole time this player was disconnected.
      clocks: liveClockRemaining(match),
      incrementMs: match.clock.incrementMs,
      ...venueFields(match),
      ...festivalFields(match),
    });
    // The engine may have been mid-think when the connection dropped; make sure it is not stuck.
    if (match.bot && match.chess.turn() === match.bot.color) void botTurn(match);
  });

  socket.on('disconnect', () => {
    leaveQueue(socket.id);
    cancelRoomBySocketId(socket.id);
    clearChatRateLimit(socket.id);

    // Any friend challenges this socket had outstanding are now dead.
    for (const challenge of cancelChallengesFromSocket(socket.id)) {
      emitToUser(challenge.toUserId, 'friend:challenge:cancelled', { challengeId: challenge.id });
    }

    // Any rematch this socket was part of is off: tell the other seat.
    for (const { window, color } of closeRematchesForSocket(socket.id)) {
      emitToRematchSeat(window, opponentColor(color), 'rematch:declined', { reason: 'left' });
    }

    // Presence: only fire "offline" when this was the account's last socket.
    const uid = (socket.data.userId as string | undefined) ?? undefined;
    if (uid) {
      const { wasLast } = removeUserSocket(uid, socket.id);
      if (wasLast) {
        broadcastPresence(uid, 'offline').catch((err) => console.error('presence broadcast failed', err));
      }
    }

    // Drop this socket from every match it was spectating.
    for (const [matchId, spectators] of spectatorsByMatch) {
      if (spectators.delete(socket.id)) broadcastSpectateCount(matchId);
    }

    const guestId = guestIdBySocket.get(socket.id);
    guestIdBySocket.delete(socket.id);
    if (!guestId) return;

    // Find any live match this guest's now-dead socket was seated in and
    // start the forfeit clock -- the match itself stays alive so a rejoin
    // within the grace window can pick it back up (see match:rejoin above).
    for (const match of allMatches()) {
      const color = colorOf(match, guestId);
      if (!color || match.players[color].socketId !== socket.id) continue;

      startForfeitCountdown(match, color);
    }
  });
});

// Matches live only in memory, so a restart would silently strand every escrowed
// stake. Two safety nets:
//  1. On SIGTERM (a normal Railway deploy) end every wagered match as a refunded
//     draw and wait briefly for the refunds to commit before exiting.
//  2. A sweeper refunds any wager still 'held' 35 minutes after it started and
//     owned by no live match -- covers a hard crash or a settlement that kept
//     failing (35 min outlasts the longest match plus the reconnect grace).
const STALE_WAGER_MS = 35 * 60_000;
const sweeper = setInterval(() => {
  sweepStaleWagers(STALE_WAGER_MS, (matchId) => getMatch(matchId) !== undefined)
    .then((refunded) => {
      if (refunded > 0) console.log(`Refunded ${refunded} stale wager(s)`);
    })
    .catch((err) => reportError(err, { area: 'wager-sweep' }));
}, 2 * 60_000);
sweeper.unref();

// Festival runs the server can no longer finish (a restart wiped the live set, or the player
// walked away for hours between sets): bank what they had, or refund the entry.
const runSweeper = setInterval(() => {
  sweepStaleRuns(STALE_RUN_MS, (matchId) => getMatch(matchId) !== undefined)
    .then((resolved) => {
      for (const r of resolved) emitInterrupted(r);
      if (resolved.length > 0) console.log(`Resolved ${resolved.length} stale festival run(s)`);
    })
    .catch((err) => reportError(err, { area: 'festival-sweep' }));
}, 2 * 60_000);
runSweeper.unref();

// Daily-reward reminders + push receipt cleanup (pushScheduler.ts).
startPushScheduler();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received -- refunding live wagers before exit`);
  for (const match of [...allMatches()]) {
    if (!match.wager && !match.festival) continue;
    void finishMatch(match, 'draw', null, {
      emit: { type: 'draw', winner: null, reason: 'serverRestart' },
      forceRefund: true,
    });
  }
  await Promise.race([Promise.allSettled([...pendingSettlements]), new Promise((resolve) => setTimeout(resolve, 8_000))]);
  await flushMonitoring(2000);
  httpServer.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

httpServer.listen(PORT, () => {
  console.log(`RockStyle Chess server listening on :${PORT}`);
  warmServerBot();
});
