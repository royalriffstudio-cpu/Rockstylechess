import './env.js';

import { toNodeHandler } from 'better-auth/node';
import cors from 'cors';
import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';

import { eq } from 'drizzle-orm';

import { allowedWebOrigins } from './allowedOrigins.js';
import { authRouter } from './auth.js';
import { socketAuth } from './authMiddleware.js';
import { auth } from './betterAuth.js';
import { CHALLENGE_TTL_MS, cancelChallengesFromSocket, consumeChallenge, createChallenge } from './challenge.js';
import { allowChatMessage, clearChatRateLimit, sanitizeChatText } from './chat.js';
import { db } from './db/client.js';
import { persistMessage } from './db/directMessages.js';
import { areFriends, friendIdsOf } from './db/friends.js';
import { persistMatchResult } from './db/persistMatchResult.js';
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
  type MatchState,
  type PieceColor,
} from './match.js';
import { isDuration, joinQueue, leaveQueue, type Duration, type QueuedPlayer, type VenueTier } from './matchmaking.js';

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
async function getPlayerIdentity(
  userId: string | null,
): Promise<{ displayName: string | null; avatarId: string | null }> {
  if (!userId) return { displayName: null, avatarId: null };
  const [row] = await db
    .select({ displayName: playerProfiles.displayName, avatarId: playerProfiles.avatarId })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId));
  return { displayName: row?.displayName ?? null, avatarId: row?.avatarId ?? null };
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
    duration: '5m',
  };
}

// Fires when a side's clock deadline elapses without them moving -- mirrors
// the disconnect/forfeit callback below exactly (broadcast match:ended,
// persist, endMatch), just for a different trigger. match.ts can't own this
// itself: it has no Socket.IO `io` access, so index.ts (which does) is
// responsible for arming/clearing/rescheduling match.clock.deadlineTimer at
// every point the active side changes (see notifyMatched below and
// move:make's handler further down).
function fireTimeout(match: MatchState, flaggedColor: PieceColor): void {
  const winner = opponentColor(flaggedColor);
  io.to(match.id).emit('match:ended', { result: { type: 'timeout', winner } });
  persistMatchResult(match, 'timeout', winner).catch((err) => console.error('match persistence failed', err));
  endMatch(match.id);
}

// Joins both sockets to the match's Socket.IO room and tells each color's
// socket who they're playing -- the one piece of "a pair just formed"
// logic shared by both pairing paths (tier queue and room code), so it
// isn't duplicated between queue:join and room:join below. Also arms
// White's clock deadline -- White's clock is already running from move 1,
// standard chess-clock convention -- since createMatch itself can't (no io
// access, see fireTimeout's comment).
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
      opponent: { userId: opp.userId, displayName: opp.displayName, avatarId: opp.avatarId },
      fen: match.chess.fen(),
      clocks: match.clock.remainingMs,
      incrementMs: match.clock.incrementMs,
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
      from: { userId: uid, displayName: challenger.displayName, avatarId: challenger.avatarId },
      duration,
      expiresInMs: CHALLENGE_TTL_MS,
    });
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
      if (!payload?.guestId || !isVenueTier(payload.venueTier)) return;
      guestIdBySocket.set(socket.id, payload.guestId);

      const userId = (socket.data.userId as string | undefined) ?? null;
      const identity = await getPlayerIdentity(userId);
      const player: QueuedPlayer = {
        socketId: socket.id,
        guestId: payload.guestId,
        userId,
        displayName: identity.displayName || payload.displayName || 'PLAYER',
        avatarId: identity.avatarId,
        duration: resolveDuration(payload.duration),
      };
      const opponent = joinQueue(payload.venueTier, player);
      if (!opponent) return; // now waiting in queue

      // The waiting player's duration wins -- see QueuedPlayer.duration's comment.
      notifyMatched(createMatch(opponent, player, DURATION_MS[opponent.duration]));
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
    const color = colorOf(match, guestId);
    if (!color) return;

    const chess = applyMove(match, color, { from: payload.from, to: payload.to, promotion: payload.promotion });
    if (!chess) {
      socket.emit('move:rejected', { reason: 'illegal-move' });
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
      io.to(match.id).emit('draw:cleared', {});
    }

    io.to(match.id).emit('move:applied', {
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
      // Fire-and-forget -- persistence never gates or delays the realtime
      // flow above, which has already completed by this point.
      persistMatchResult(match, resultType, winnerColor).catch((err) =>
        console.error('match persistence failed', err),
      );
      endMatch(match.id);
    }
  });

  socket.on('match:resign', (payload: { matchId?: string }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = colorOf(match, guestId);
    if (!color) return;

    io.to(match.id).emit('match:ended', { result: { type: 'resignation', winner: opponentColor(color) } });
    persistMatchResult(match, 'resignation', opponentColor(color)).catch((err) =>
      console.error('match persistence failed', err),
    );
    endMatch(match.id);
  });

  socket.on('draw:offer', (payload: { matchId?: string }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = colorOf(match, guestId);
    if (!color || match.drawOfferBy || match.chess.isGameOver()) return;

    match.drawOfferBy = color;
    io.to(match.id).emit('draw:offered', { color });
  });

  socket.on('draw:respond', (payload: { matchId?: string; accept?: boolean }) => {
    const guestId = guestIdBySocket.get(socket.id);
    const match = payload?.matchId ? getMatch(payload.matchId) : undefined;
    if (!match || !guestId) return;
    const color = colorOf(match, guestId);
    // Only the player who DIDN'T offer can answer.
    if (!color || !match.drawOfferBy || match.drawOfferBy === color) return;

    if (payload.accept) {
      io.to(match.id).emit('match:ended', { result: { type: 'draw', winner: null } });
      persistMatchResult(match, 'draw', null).catch((err) => console.error('match persistence failed', err));
      endMatch(match.id);
      return;
    }
    match.drawOfferBy = undefined;
    io.to(match.id).emit('draw:declined', {});
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
    const color = colorOf(match, payload.guestId);
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
      },
      fen: match.chess.fen(),
      // A live snapshot, not the possibly-stale anchor -- the clock kept
      // running the whole time this player was disconnected.
      clocks: liveClockRemaining(match),
      incrementMs: match.clock.incrementMs,
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

    const guestId = guestIdBySocket.get(socket.id);
    guestIdBySocket.delete(socket.id);
    if (!guestId) return;

    // Find any live match this guest's now-dead socket was seated in and
    // start the forfeit clock -- the match itself stays alive so a rejoin
    // within the grace window can pick it back up (see match:rejoin above).
    for (const match of allMatches()) {
      const color = colorOf(match, guestId);
      if (!color || match.players[color].socketId !== socket.id) continue;

      io.to(match.id).emit('match:opponentDisconnected', { color });
      match.forfeitTimers[color] = setTimeout(() => {
        io.to(match.id).emit('match:ended', { result: { type: 'forfeit', winner: opponentColor(color) } });
        persistMatchResult(match, 'forfeit', opponentColor(color)).catch((err) =>
          console.error('match persistence failed', err),
        );
        endMatch(match.id);
      }, RECONNECT_GRACE_MS);
    }
  });
});

httpServer.listen(PORT, () => {
  console.log(`RockStyle Chess server listening on :${PORT}`);
});
