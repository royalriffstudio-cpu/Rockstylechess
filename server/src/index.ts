import './env.js';

import { toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import express from 'express';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
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
import { playerProfiles } from './db/schema/index.js';
import {
  addUserSocket,
  emitToUser,
  isUserOnline,
  removeUserSocket,
  setIO,
  socketIdsForUser,
} from './realtime.js';
import { cancelRoomBySocketId, createRoom, joinRoom } from './gameRoom.js';
import {
  allMatches,
  applyMove,
  colorOf,
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
  endMatchClean(match.id);
  const task: Promise<void> = settleAndPersist(match, type, winnerColor, opts.forceRefund === true)
    .catch((err) => console.error('match persistence failed', err))
    .finally(() => pendingSettlements.delete(task));
  pendingSettlements.add(task);
  return task;
}

async function settleAndPersist(
  match: MatchState,
  type: EndType,
  winnerColor: PieceColor | null,
  forceRefund: boolean,
): Promise<void> {
  if (!match.wager) {
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

  // A void match (someone left in the first moves) leaves no trace: no rating,
  // no XP, no history row -- the stakes were simply returned.
  if (settled.outcome === 'void') return;

  await persistMatchResult(match, type, winnerColor, {
    wagered: true,
    chipsDeltaByUser: Object.fromEntries(Object.entries(settled.players).map(([uid, p]) => [uid, p.net])),
  });
}

function wagerSettledPayload(
  match: MatchState,
  settled: SettledWager,
  mine: { net: number; chipsAfter: number; payout: number },
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
  if (next) void startPairedMatch(next, player, tier);
}

// A pair just formed in a venue queue. Free venues (Garage) go straight to a
// match. Wagered venues first ESCROW both buy-ins -- before the match exists --
// and only then create it, so there is never a live match whose stake was not
// secured. Anything that goes wrong after the money moves refunds it.
async function startPairedMatch(waiting: QueuedPlayer, joiner: QueuedPlayer, tier: VenueTier): Promise<void> {
  // The player who was already waiting sets the clock -- see QueuedPlayer.duration.
  const baseMs = DURATION_MS[waiting.duration];
  const stake = stakeFor(tier);
  if (!stake) {
    notifyMatched(createMatch(waiting, joiner, baseMs, 0, { venueTier: tier }));
    return;
  }

  const waitingLive = isSocketLive(waiting.socketId);
  const joinerLive = isSocketLive(joiner.socketId);
  if (!waitingLive || !joinerLive) {
    // A socket died between queuing and pairing (e.g. during the identity
    // lookup): never charge anyone for a match that cannot start.
    if (waitingLive) requeue(waiting, tier);
    if (joinerLive) requeue(joiner, tier);
    return;
  }

  const matchId = randomUUID();
  const whiteIsWaiting = Math.random() < 0.5;
  const [white, black] = whiteIsWaiting ? [waiting, joiner] : [joiner, waiting];
  let escrow;
  try {
    escrow = await escrowWager(matchId, tier, white.userId as string, black.userId as string);
  } catch (error) {
    console.error('wager escrow failed', error);
    for (const p of [waiting, joiner]) io.to(p.socketId).emit('queue:error', { reason: 'unavailable' });
    return;
  }
  if (escrow.status === 'insufficient-chips') {
    // Their balance dropped since they joined (spent elsewhere / another match).
    const short = escrow.userId === waiting.userId ? waiting : joiner;
    const other = short === waiting ? joiner : waiting;
    io.to(short.socketId).emit('queue:error', { reason: 'insufficient-chips', required: stake.buyIn });
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
    console.error('createMatch failed after escrow -- refunding', error);
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

// Joins both sockets to the match's Socket.IO room and tells each color's
// socket who they're playing -- the one piece of "a pair just formed"
// logic shared by both pairing paths (tier queue and room code), so it
// isn't duplicated between queue:join and room:join below. Also arms
// White's clock deadline -- White's clock is already running from move 1,
// standard chess-clock convention -- since createMatch itself can't (no io
// access, see fireTimeout's comment).
// What the client needs to show the stakes: which venue this really is (it used
// to trust its own route param) and the buy-in / prize at stake (0 = unwagered).
function venueFields(match: MatchState): { venueTier: string; buyIn: number; prize: number } {
  return { venueTier: match.venueTier ?? 'garage', buyIn: match.wager?.buyIn ?? 0, prize: match.wager?.prize ?? 0 };
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
      notifyMatched(createMatch(challenge.challenger, accepter, DURATION_MS[challenge.duration]));
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
  });

  socket.on(
    'queue:join',
    async (payload: { guestId?: string; displayName?: string; venueTier?: string; duration?: string }) => {
      if (!payload?.guestId || !isVenueTier(payload.venueTier)) {
        socket.emit('queue:error', { reason: 'bad-tier' });
        return;
      }
      const tier = payload.venueTier;
      guestIdBySocket.set(socket.id, payload.guestId);

      const userId = (socket.data.userId as string | undefined) ?? null;

      // Wagered venues: signed-in only, enough rating, enough chips, and not already
      // seated in a live match. Garage skips all of it. The pairing step re-checks
      // the balance atomically (escrowWager) -- this is the early, friendly answer.
      const stake = stakeFor(tier);
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
        if (entry.chips < stake.buyIn) {
          socket.emit('queue:error', { reason: 'insufficient-chips', required: stake.buyIn, current: entry.chips });
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

      const opponent = joinQueue(tier, player);
      if (!opponent) return; // now waiting in queue
      await startPairedMatch(opponent, player, tier);
    },
  );

  socket.on('queue:leave', () => {
    leaveQueue(socket.id);
  });

  socket.on('room:create', async (payload: { guestId?: string; displayName?: string; duration?: string }) => {
    if (!payload?.guestId) return;
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
    };
    socket.emit('room:created', { code: createRoom(player) });
  });

  socket.on('room:join', async (payload: { guestId?: string; displayName?: string; code?: string }) => {
    if (!payload?.guestId || !payload?.code) return;
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
    };
    const result = joinRoom(payload.code, player);
    if (result.status !== 'ok') {
      socket.emit('room:error', { reason: result.status });
      return;
    }

    notifyMatched(createMatch(result.opponent, player, DURATION_MS[result.opponent.duration]));
  });

  socket.on('room:cancel', () => {
    cancelRoomBySocketId(socket.id);
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
      from: payload.from,
      to: payload.to,
      promotion: payload.promotion ?? 'q',
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
    }
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

  socket.on('draw:offer', (payload: { matchId?: string }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = seatColor(match, guestId, socket.data.userId as string | undefined);
    if (!color || match.drawOfferBy || match.chess.isGameOver()) return;

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
    if (!match) {
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
    });
  });

  socket.on('disconnect', () => {
    leaveQueue(socket.id);
    cancelRoomBySocketId(socket.id);
    clearChatRateLimit(socket.id);

    // Any friend challenges this socket had outstanding are now dead.
    for (const challenge of cancelChallengesFromSocket(socket.id)) {
      emitToUser(challenge.toUserId, 'friend:challenge:cancelled', { challengeId: challenge.id });
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
    .catch((err) => console.error('wager sweep failed', err));
}, 2 * 60_000);
sweeper.unref();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received -- refunding live wagers before exit`);
  for (const match of [...allMatches()]) {
    if (!match.wager) continue;
    void finishMatch(match, 'draw', null, {
      emit: { type: 'draw', winner: null, reason: 'serverRestart' },
      forceRefund: true,
    });
  }
  await Promise.race([Promise.allSettled([...pendingSettlements]), new Promise((resolve) => setTimeout(resolve, 8_000))]);
  httpServer.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

httpServer.listen(PORT, () => {
  console.log(`RockStyle Chess server listening on :${PORT}`);
});
