import type { MatchState, PieceColor } from './match.js';

// Rematch windows. A finished match is deleted from memory at once (index.ts finishMatch), so "play
// again" needs its own short-lived rendezvous, modelled on challenge.ts: an id-keyed map, a TTL timer,
// a one-shot close, and cleanup when a socket goes away. The window is keyed by the FINISHED match id and
// holds just enough to start the same game again with the colours swapped: who sat where, the venue and
// stake, whether it was friendly, the base time, and each seat's Safety Net choice.
//
// Not offered for Festival sets (their own Set Break flow) or server-bot matches (no second human).
export const REMATCH_TTL_MS = 45_000;

export interface RematchSeat {
  color: PieceColor; // the colour this seat had in the FINISHED match (it swaps on the rematch)
  socketId: string; // last known socket; refreshed whenever the seat talks to us
  guestId: string;
  userId: string | null;
  displayName: string;
  avatarId: string | null;
  country: string | null;
  rating: number | null;
  title: string | null;
  insured: boolean;
}

export interface RematchWindow {
  matchId: string;
  seats: Record<PieceColor, RematchSeat>;
  venueTier?: string;
  stake?: { buyIn: number; prize: number };
  friendly: boolean;
  baseMs: number;
  // Which previous colour has tapped Rematch (the other one is asked to accept), or null.
  offeredBy: PieceColor | null;
  timer: NodeJS.Timeout;
}

export type RematchSnapshot = Omit<RematchWindow, 'timer' | 'offeredBy'>;

const windows = new Map<string, RematchWindow>();

// Taken synchronously in finishMatch BEFORE the match is removed. null = no rematch for this match.
export function snapshotForRematch(match: MatchState): RematchSnapshot | null {
  if (match.festival || match.bot) return null;
  const seat = (color: PieceColor): RematchSeat => {
    const p = match.players[color];
    return {
      color,
      socketId: p.socketId,
      guestId: p.guestId,
      userId: p.userId,
      displayName: p.displayName,
      avatarId: p.avatarId,
      country: p.country,
      rating: p.rating,
      title: p.title,
      insured: p.insured === true,
    };
  };
  return {
    matchId: match.id,
    seats: { w: seat('w'), b: seat('b') },
    venueTier: match.venueTier,
    stake: match.wager ? { buyIn: match.wager.buyIn, prize: match.wager.prize } : undefined,
    friendly: match.friendly === true,
    baseMs: match.baseMs,
  };
}

export function openRematch(snapshot: RematchSnapshot, onExpire: (window: RematchWindow) => void): RematchWindow {
  closeRematch(snapshot.matchId);
  const window: RematchWindow = {
    ...snapshot,
    offeredBy: null,
    timer: setTimeout(() => {
      if (windows.get(snapshot.matchId) === window) {
        windows.delete(snapshot.matchId);
        onExpire(window);
      }
    }, REMATCH_TTL_MS),
  };
  windows.set(snapshot.matchId, window);
  return window;
}

export function getRematch(matchId: string): RematchWindow | undefined {
  return windows.get(matchId);
}

/** One-shot: removes the window (and its timer). Returns it, or null if it was already gone. */
export function closeRematch(matchId: string): RematchWindow | null {
  const window = windows.get(matchId);
  if (!window) return null;
  clearTimeout(window.timer);
  windows.delete(matchId);
  return window;
}

/** Every open window a (now disconnected) socket was seated in. Closes them and returns them so the caller can tell the other seat. */
export function closeRematchesForSocket(socketId: string): { window: RematchWindow; color: PieceColor }[] {
  const closed: { window: RematchWindow; color: PieceColor }[] = [];
  for (const window of [...windows.values()]) {
    const color = (['w', 'b'] as PieceColor[]).find((c) => window.seats[c].socketId === socketId);
    if (!color) continue;
    closeRematch(window.matchId);
    closed.push({ window, color });
  }
  return closed;
}

// Same identity rule as match.ts seatColor: the guestId names the seat, and for a wagered or friendly
// match (where chips or a friend are involved) the seat must ALSO belong to the authenticated account.
export function rematchSeatColor(window: RematchWindow, guestId: string, socketUserId: string | undefined): PieceColor | null {
  const color = (['w', 'b'] as PieceColor[]).find((c) => window.seats[c].guestId === guestId);
  if (!color) return null;
  if ((window.stake || window.friendly) && window.seats[color].userId !== (socketUserId ?? null)) return null;
  return color;
}
