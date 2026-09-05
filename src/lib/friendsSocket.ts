import type { Duration } from './onlineMatch';
import { ensureAuthenticated, getSocket } from './socket';
import { getPlayerId } from './playerId';

// Socket protocol for the out-of-game social layer -- friend presence, friend
// challenges, and direct messages. Mirrors onlineMatch.ts's role for the
// in-match protocol. The REST side (list/history/requests) is in api.ts; this
// file is only the realtime events.
//
// Server handlers: server/src/index.ts (challenge:* + dm:send) and the
// per-user emits from server/src/auth.ts via realtime.ts's emitToUser.

// --- server -> client -----------------------------------------------------

export interface FriendPresencePayload {
  userId: string;
  status: 'online' | 'offline';
}

export interface FriendRequestPayload {
  // The other user, shaped like api.ts's FriendCodeLookup + level.
  friend: { userId: string; displayName: string | null; avatarId: string | null; rating: number; level: number };
}

export interface FriendRemovedPayload {
  userId: string;
}

export interface IncomingChallengePayload {
  challengeId: string;
  from: { userId: string; displayName: string | null; avatarId: string | null };
  duration: Duration;
  expiresInMs: number;
}

export interface ChallengeResolvedPayload {
  challengeId: string;
}

export interface DirectMessagePayload {
  id: string;
  conversationId: string;
  fromUserId: string;
  toUserId: string;
  text: string;
  sentAt: number;
}

// --- client -> server (emit helpers) ------------------------------------

// All of these must reach the server on the authenticated connection -- a
// challenge or DM sent on the still-anonymous initial socket is silently
// dropped (server requires socket.data.userId). Same await-ensureAuthenticated
// guard matchmaking.tsx uses for queue:join.

export async function sendChallenge(toUserId: string, duration: Duration): Promise<void> {
  const [socket, guestId] = await Promise.all([ensureAuthenticated(), getPlayerId()]);
  socket.emit('friend:challenge', { guestId, toUserId, duration });
}

export async function respondToChallenge(challengeId: string, accept: boolean): Promise<void> {
  const [socket, guestId] = await Promise.all([ensureAuthenticated(), getPlayerId()]);
  socket.emit('friend:challenge:respond', { guestId, challengeId, accept });
}

export function cancelChallenge(challengeId: string): void {
  getSocket().emit('friend:challenge:cancel', { challengeId });
}

export async function sendDirectMessage(toUserId: string, text: string): Promise<void> {
  const socket = await ensureAuthenticated();
  socket.emit('dm:send', { toUserId, text });
}
