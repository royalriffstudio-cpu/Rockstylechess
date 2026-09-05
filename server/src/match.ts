import { Chess } from 'chess.js';
import { randomUUID } from 'node:crypto';

import type { QueuedPlayer } from './matchmaking.js';

export type PieceColor = 'w' | 'b';

export interface MatchPlayer {
  socketId: string;
  guestId: string;
  // Server-verified identity (from a JWT checked in authMiddleware.ts's
  // socketAuth), never trusted from client-supplied data directly. Null for
  // guest/anonymous play. persistMatchResult only records a match to
  // Postgres when BOTH seats have this set.
  userId: string | null;
  displayName: string;
  avatarId: string | null;
}

// Server-authoritative chess clock. Kept as its own field, deliberately
// separate from forfeitTimers below -- the two have completely different
// reschedule cadences (every move vs. only on disconnect/rejoin), and
// conflating them risks a rejoin accidentally clearing a running clock timer
// or vice versa. Disconnect does NOT pause this clock (matches lichess/
// chess.com convention) -- with a 60s reconnect grace already in play
// (RECONNECT_GRACE_MS in index.ts), pausing on disconnect would let a losing
// player buy 60 free seconds every time they're in time trouble. The two
// timers coexist independently and safely: whichever fires first ends the
// match, and endMatch clears both.
export interface ClockState {
  remainingMs: Record<PieceColor, number>;
  incrementMs: number;
  // Date.now() ms timestamp of when the currently-running side's deadline began.
  turnStartedAt: number;
  deadlineTimer: NodeJS.Timeout | null;
}

export interface MatchState {
  id: string;
  chess: Chess;
  players: Record<PieceColor, MatchPlayer>;
  createdAt: Date;
  clock: ClockState;
  // Set while a player is disconnected and within the reconnect grace
  // window -- cleared on rejoin, and on expiry the match is forfeited to
  // the other side. See index.ts's RECONNECT_GRACE_MS.
  forfeitTimers: Partial<Record<PieceColor, NodeJS.Timeout>>;
  // The side with an outstanding draw offer, if any. Cleared when the
  // opponent responds or when either side moves (an offer doesn't survive a
  // change in the position).
  drawOfferBy?: PieceColor;
  // Cumulative ms since createdAt, one entry per ply, appended in applyMove.
  // Deliberately just timing -- everything else about a move (san, from,
  // to, piece, captured, promotion, flags, before/after FEN) is already
  // 100% reconstructable from the pgn column persistMatchResult writes at
  // match end (chess.loadPgn(pgn) + chess.history({verbose: true})), so
  // storing it again here would just be duplicated storage for no benefit.
  // A future replay feature zips this array with that history by index.
  moveElapsedMs: number[];
}

export interface MoveInput {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

// Checkmate/stalemate/draw are deliberately NOT surfaced here as a broadcast
// event -- both clients independently derive them from the move they just
// applied to their own chess.js instance (same as the existing bot/local
// modes already do), symmetric with how a normal move already updates the
// board. This type only covers endings that happen *without* a move.
export type MatchEndResult =
  | { type: 'resignation'; winner: PieceColor }
  | { type: 'forfeit'; winner: PieceColor }
  | { type: 'timeout'; winner: PieceColor }
  // A negotiated (agreed) draw -- unlike checkmate/stalemate/natural draw,
  // both clients can't derive this from a move, so it IS broadcast.
  | { type: 'draw'; winner: null };

const matches = new Map<string, MatchState>();

// baseMs/incrementMs come from the client's chosen duration (setup.tsx's
// picker, resolved server-side -- see index.ts's DURATION_MS map, never
// trusted as a raw client-supplied ms value). incrementMs defaults to 0 --
// no picker exposes a nonzero value yet, but the parameter is real end to
// end so turning one on later needs no engine change.
export function createMatch(playerA: QueuedPlayer, playerB: QueuedPlayer, baseMs: number, incrementMs = 0): MatchState {
  // Coin flip for colors -- neither queued player picked a side.
  const [white, black] = Math.random() < 0.5 ? [playerA, playerB] : [playerB, playerA];
  const match: MatchState = {
    id: randomUUID(),
    chess: new Chess(),
    players: {
      w: {
        socketId: white.socketId,
        guestId: white.guestId,
        userId: white.userId,
        displayName: white.displayName,
        avatarId: white.avatarId,
      },
      b: {
        socketId: black.socketId,
        guestId: black.guestId,
        userId: black.userId,
        displayName: black.displayName,
        avatarId: black.avatarId,
      },
    },
    createdAt: new Date(),
    // deadlineTimer starts unarmed -- match.ts has no Socket.IO `io` access
    // to broadcast a timeout, so index.ts (which does) arms White's deadline
    // immediately after createMatch returns, and rearms it after every move.
    clock: { remainingMs: { w: baseMs, b: baseMs }, incrementMs, turnStartedAt: Date.now(), deadlineTimer: null },
    forfeitTimers: {},
    moveElapsedMs: [],
  };
  matches.set(match.id, match);
  return match;
}

export function getMatch(matchId: string): MatchState | undefined {
  return matches.get(matchId);
}

export function allMatches(): IterableIterator<MatchState> {
  return matches.values();
}

// match.clock.remainingMs only updates at move boundaries (inside
// applyMove) -- it doesn't by itself reflect time spent mid-turn (the clock
// keeps running during a disconnect, deliberately, see ClockState's
// comment). Used for match:rejoin's resync payload, where the reconnecting
// client needs a live snapshot, not a possibly-stale anchor.
export function liveClockRemaining(match: MatchState): Record<PieceColor, number> {
  const activeColor = match.chess.turn();
  const elapsed = Date.now() - match.clock.turnStartedAt;
  return {
    ...match.clock.remainingMs,
    [activeColor]: Math.max(0, match.clock.remainingMs[activeColor] - elapsed),
  };
}

export function endMatch(matchId: string): void {
  const match = matches.get(matchId);
  if (match) {
    for (const timer of Object.values(match.forfeitTimers)) clearTimeout(timer);
    if (match.clock.deadlineTimer) clearTimeout(match.clock.deadlineTimer);
  }
  matches.delete(matchId);
}

export function colorOf(match: MatchState, guestId: string): PieceColor | null {
  if (match.players.w.guestId === guestId) return 'w';
  if (match.players.b.guestId === guestId) return 'b';
  return null;
}

export function opponentColor(color: PieceColor): PieceColor {
  return color === 'w' ? 'b' : 'w';
}

/** Applies a move if legal and it's that color's turn. Returns the updated
 * Chess instance, or null if the move was rejected. Also deducts the mover's
 * true elapsed thinking time from match.clock and credits any increment --
 * does NOT touch match.clock.deadlineTimer itself (clearing/rescheduling
 * that needs an io-capable callback, which only index.ts has -- see its
 * move:make handler, the caller of this function). */
export function applyMove(match: MatchState, color: PieceColor, move: MoveInput): Chess | null {
  if (match.chess.turn() !== color) return null;
  try {
    match.chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
  } catch {
    return null;
  }
  const now = Date.now();
  match.moveElapsedMs.push(now - match.createdAt.getTime());

  const elapsed = now - match.clock.turnStartedAt;
  match.clock.remainingMs[color] = Math.max(0, match.clock.remainingMs[color] - elapsed) + match.clock.incrementMs;
  match.clock.turnStartedAt = now;

  return match.chess;
}
