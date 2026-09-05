import type { Server } from 'socket.io';

// Per-user Socket.IO targeting + presence. The match/room layer is keyed by
// `guestId` (client-supplied, see matchmaking.ts); friends/DMs/challenges are
// keyed by the verified `userId` (socketAuth), which has no socket-lookup
// structure of its own. This module is that structure.
//
// index.ts owns the `io` instance and calls setIO() once at startup; auth.ts's
// REST route handlers and the db/* modules import emitToUser() so a REST action
// (accept a request, ...) can still push a realtime event without wiring `io`
// through the Express router.

let io: Server | null = null;

export function setIO(server: Server): void {
  io = server;
}

// A signed-in user can have several live sockets (multiple devices/tabs).
const socketsByUser = new Map<string, Set<string>>();

/** Emit to every live socket of one user. No-op before setIO() or when the
 *  user has no connected socket -- callers that need delivery guarantees
 *  persist first (DMs) or gate on isOnline() first (challenges). */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  io?.to(`user:${userId}`).emit(event, payload);
}

/** Register a freshly-connected authed socket. `wasFirst` is true when this is
 *  the user's only socket now -- the caller uses it to fire a presence
 *  "online" delta exactly once. */
export function addUserSocket(userId: string, socketId: string): { wasFirst: boolean } {
  let set = socketsByUser.get(userId);
  if (!set) {
    set = new Set();
    socketsByUser.set(userId, set);
  }
  const wasFirst = set.size === 0;
  set.add(socketId);
  return { wasFirst };
}

/** Deregister a disconnected socket. `wasLast` is true when the user now has
 *  no sockets left -- the caller fires a presence "offline" delta. */
export function removeUserSocket(userId: string, socketId: string): { wasLast: boolean } {
  const set = socketsByUser.get(userId);
  if (!set) return { wasLast: false };
  set.delete(socketId);
  if (set.size === 0) {
    socketsByUser.delete(userId);
    return { wasLast: true };
  }
  return { wasLast: false };
}

export function isUserOnline(userId: string): boolean {
  return socketsByUser.has(userId);
}

export function socketIdsForUser(userId: string): string[] {
  return [...(socketsByUser.get(userId) ?? [])];
}

/** Subset of `userIds` that currently have at least one live socket. */
export function onlineAmong(userIds: string[]): Set<string> {
  return new Set(userIds.filter((id) => socketsByUser.has(id)));
}
