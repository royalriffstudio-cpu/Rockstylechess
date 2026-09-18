export type VenueTier = 'garage' | 'club' | 'arena' | 'stadium' | 'mainstage' | 'world-tour';

// Mirrors src/lib/onlineMatch.ts's own Duration type on the client (same
// duplication convention as VenueTier above, and as the various authoritative
// constant tables like matchRewards.ts) -- the enum, not raw ms, is what a
// client is ever allowed to request; index.ts resolves it to a real ms value.
export type Duration = '3m' | '5m' | '10m';

export function isDuration(value: unknown): value is Duration {
  return value === '3m' || value === '5m' || value === '10m';
}

export interface QueuedPlayer {
  socketId: string;
  guestId: string;
  userId: string | null;
  displayName: string;
  // Null for guests and for signed-in players who haven't picked one yet --
  // looked up server-side from playerProfiles by userId (see index.ts),
  // never trusted from client-supplied data.
  avatarId: string | null;
  // Same null-for-guests-and-not-yet-onboarded, server-looked-up-only rule
  // as avatarId above.
  country: string | null;
  // The duration this player queued with. On a pairing, the player who was
  // ALREADY waiting (returned as `opponent` from joinQueue below) sets the
  // match's actual duration -- simplest reasonable tie-break given queues
  // aren't segmented by duration, only by venue tier.
  duration: Duration;
}

// One FIFO queue per venue tier -- players are only ever paired within the
// same tier they queued for, mirroring the client's buy-in ladder (setup.tsx).
const queues = new Map<VenueTier, QueuedPlayer[]>();

function queueFor(tier: VenueTier): QueuedPlayer[] {
  let queue = queues.get(tier);
  if (!queue) {
    queue = [];
    queues.set(tier, queue);
  }
  return queue;
}

/**
 * Adds a player to the tier's queue and immediately pairs them with the
 * next waiting player in that same tier, if there is one. Returns the
 * opponent when a pair forms, or null if the player is now waiting.
 *
 * If this guestId already has an entry waiting in this tier's queue --
 * most commonly because a network blip triggered a Socket.IO reconnect (a
 * new socket.id) while still waiting to be matched -- that entry is
 * updated in place (same queue position, fresh socketId) rather than
 * adding a duplicate. Without this, the stale socket.id would sit in the
 * queue and, if it got paired off, the server's
 * `io.to(staleSocketId).emit(...)` would silently reach nobody, leaving
 * the other player matched against someone who never shows up. The
 * client re-emits queue:join on every reconnect (see matchmaking.tsx) to
 * make this path actually run.
 */
export function joinQueue(tier: VenueTier, player: QueuedPlayer): QueuedPlayer | null {
  const queue = queueFor(tier);

  const staleIndex = queue.findIndex((p) => p.guestId === player.guestId);
  if (staleIndex !== -1) {
    queue[staleIndex] = player;
    return null; // still waiting, just refreshed
  }

  const opponent = queue.shift();
  if (opponent) return opponent;
  queue.push(player);
  return null;
}

export function leaveQueue(socketId: string): void {
  for (const queue of queues.values()) {
    const index = queue.findIndex((p) => p.socketId === socketId);
    if (index !== -1) queue.splice(index, 1);
  }
}
