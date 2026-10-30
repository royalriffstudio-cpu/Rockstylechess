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
  // Public standing shown on the opponent's match header (null for guests).
  rating: number | null;
  title: string | null;
  // The time control this player picked. A pairing is only ever made between players who picked the SAME
  // one, unless a player has chosen to widen the search (`flex`): then they also accept another waiting
  // player's pick, and the game is played at the time control the OTHER (non-flexible) player picked.
  duration: Duration;
  // The player tapped "also search other time controls" after waiting. Opt-in, never the default.
  flex?: boolean;
  // Wagered venues: the player bought the Safety Net for this match (db/wagers.ts). Always false
  // for guests and for free venues.
  insured: boolean;
}

// One FIFO queue per venue tier -- players are only ever paired within the
// same tier they queued for, mirroring the client's buy-in ladder (setup.tsx).
// Within a tier the pick of time control decides who may play whom (see pairWith below).
const queues = new Map<VenueTier, QueuedPlayer[]>();

function queueFor(tier: VenueTier): QueuedPlayer[] {
  let queue = queues.get(tier);
  if (!queue) {
    queue = [];
    queues.set(tier, queue);
  }
  return queue;
}

export interface Pairing {
  opponent: QueuedPlayer; // the player who was already waiting
  duration: Duration; // the time control the game is played at
}

// The time control a pairing is played at. Same pick -> that pick. One side widened -> the OTHER side's pick
// (a player who widened agreed to play someone else's clock; the one who didn't never plays a clock they
// did not choose). Both widened -> the player who waited longest decides.
function agreedDuration(joiner: QueuedPlayer, waiting: QueuedPlayer): Duration {
  if (joiner.duration === waiting.duration) return joiner.duration;
  if (waiting.flex && !joiner.flex) return joiner.duration;
  if (joiner.flex && !waiting.flex) return waiting.duration;
  return waiting.duration;
}

const compatible = (a: QueuedPlayer, b: QueuedPlayer) => a.duration === b.duration || a.flex === true || b.flex === true;

/**
 * Adds a player to the tier's queue and pairs them with the longest-waiting COMPATIBLE player: someone who
 * picked the same time control (always preferred), or a player who widened their search. Returns the
 * pairing when one forms, or null if the player is now waiting.
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
export function joinQueue(tier: VenueTier, player: QueuedPlayer): Pairing | null {
  const queue = queueFor(tier);

  const staleIndex = queue.findIndex((p) => p.guestId === player.guestId);
  if (staleIndex !== -1) {
    queue[staleIndex] = player;
    return null; // still waiting, just refreshed
  }

  let index = queue.findIndex((w) => w.duration === player.duration);
  if (index === -1) index = queue.findIndex((w) => compatible(player, w));
  if (index !== -1) {
    const [opponent] = queue.splice(index, 1);
    return { opponent, duration: agreedDuration(player, opponent) };
  }
  queue.push(player);
  return null;
}

/**
 * The waiting player tapped "also search other time controls": from now on they accept any pick, and if
 * someone is already waiting on another clock they are paired at once (at that player's clock).
 * Returns null when the socket is not waiting, or nobody else is.
 */
export function widenQueued(socketId: string): { tier: VenueTier; player: QueuedPlayer; pairing: Pairing } | null {
  for (const [tier, queue] of queues) {
    const index = queue.findIndex((p) => p.socketId === socketId);
    if (index === -1) continue;
    const player = queue[index];
    player.flex = true;
    const otherIndex = queue.findIndex((w) => w !== player);
    if (otherIndex === -1) return null;
    const [opponent] = queue.splice(otherIndex, 1);
    queue.splice(queue.indexOf(player), 1);
    return { tier, player, pairing: { opponent, duration: agreedDuration(player, opponent) } };
  }
  return null;
}

/** How many players are waiting per time control in a tier (flexible players count under their own pick). */
export function queueCounts(tier: VenueTier): Record<Duration, number> {
  const counts: Record<Duration, number> = { '3m': 0, '5m': 0, '10m': 0 };
  for (const p of queues.get(tier) ?? []) counts[p.duration] += 1;
  return counts;
}

// Drops every queue entry matching `predicate` (across all tiers) and returns
// them, so a caller can tell the owners. Used to keep ONE entry per socket and
// per signed-in account -- a second device replaces the first instead of the
// account being able to play itself for a wager.
export function removeFromQueues(predicate: (player: QueuedPlayer) => boolean): QueuedPlayer[] {
  const removed: QueuedPlayer[] = [];
  for (const queue of queues.values()) {
    for (let i = queue.length - 1; i >= 0; i--) {
      if (predicate(queue[i])) removed.push(...queue.splice(i, 1));
    }
  }
  return removed;
}

export function leaveQueue(socketId: string): void {
  for (const queue of queues.values()) {
    const index = queue.findIndex((p) => p.socketId === socketId);
    if (index !== -1) queue.splice(index, 1);
  }
}
