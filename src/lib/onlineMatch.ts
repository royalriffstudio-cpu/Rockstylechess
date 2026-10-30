export type VenueTier = 'garage' | 'club' | 'arena' | 'stadium' | 'mainstage' | 'world-tour';

// The enum, not raw ms, travels over the wire (server/src/index.ts's
// DURATION_MS resolves it for online play), so a client can't request an
// arbitrary duration by sending a made-up ms value.
export type Duration = '3m' | '5m' | '10m';

export const DURATIONS: Duration[] = ['3m', '5m', '10m'];

export const DURATION_LABELS: Record<Duration, string> = { '3m': 'Blitz', '5m': 'Blitz', '10m': 'Rapid' };

// Client-side resolver for bot/local matches, which never reach the server's
// own DURATION_MS. Values MUST match server/src/index.ts's map.
export const DURATION_MS: Record<Duration, number> = { '3m': 180_000, '5m': 300_000, '10m': 600_000 };

export interface QueueMatchedPayload {
  matchId: string;
  color: 'w' | 'b';
  // userId is null when the opponent is playing as a guest -- only signed-in
  // opponents can be added as a friend from the post-game screen.
  // rating/title are the opponent's public standing (null for guests).
  opponent: {
    userId: string | null;
    displayName: string;
    avatarId: string | null;
    country: string | null;
    rating: number | null;
    title: string | null;
  };
  fen: string;
  clocks: { w: number; b: number };
  incrementMs: number;
  // The venue the SERVER matched them in (the client used to trust its own route
  // param) and the stake riding on it: buyIn 0 = unwagered (Garage, friend
  // challenges, game rooms). prize = what the winner receives.
  venueTier: VenueTier;
  buyIn: number;
  prize: number;
  // A friend challenge or private room: unrated, no chips/Fame/Tour (server/src/db/persistMatchResult.ts).
  friendly?: boolean;
  // Present only for a Festival set (a paid bot ladder run, see lib/festival.ts): the
  // opponent is a bot the SERVER plays.
  festival?: FestivalMatchInfo;
}

export interface FestivalMatchInfo {
  runId: string;
  tierId: string;
  tierName: string;
  setIndex: number;
  totalSets: number;
  purse: number[];
  banked: number; // what the player holds right now (0 on set 1)
  nextPurse: number; // what clearing THIS set banks
  bot: { id: string; name: string; emoji: string; difficulty: string };
}

// Server -> client when a queue:join is refused (previously it failed silently).
export interface QueueErrorPayload {
  reason: 'auth-required' | 'insufficient-chips' | 'rating-too-low' | 'already-in-match' | 'bad-tier' | 'replaced' | 'unavailable';
  required?: number;
  current?: number;
}

// Server -> each player of a WAGERED match once it has ended and the stake has
// been settled. Also sent for the endings clients derive from a move
// (checkmate/stalemate), which have no match:ended of their own.
//  win    -> someone took the pot minus the rake
//  draw   -> a real draw: stakes returned
//  void   -> left in the first 3 moves (or the server restarted): stakes returned
export interface WagerSettledPayload {
  matchId: string;
  venueTier: VenueTier;
  outcome: 'win' | 'draw' | 'void';
  buyIn: number;
  pot: number;
  rake: number;
  payout: number; // what THIS player received
  net: number; // payout - buyIn: +800, -1000, or 0
  chipsAfter: number;
  refunded: boolean;
  // Safety Net: what THIS player paid for it and what it paid back (a loss only). null = none bought.
  insurance: null | { premium: number; refund: number };
}

export interface MoveAppliedPayload {
  from: string;
  to: string;
  promotion?: 'q' | 'r' | 'b' | 'n';
  fen: string;
  turn: 'w' | 'b';
  isGameOver: boolean;
  clocks: { w: number; b: number };
}

export interface MatchEndedPayload {
  result:
    | { type: 'resignation' | 'forfeit' | 'timeout'; winner: 'w' | 'b' }
    // `reason` is only set for a non-negotiated broadcast draw -- today just
    // a flag-fall where the winner had no mating material (FIDE 6.9).
    | { type: 'draw'; winner: null; reason?: 'insufficientVsTimeout' | 'serverRestart' };
}

// Server -> the mover only, when it re-validates their move and rejects it.
// Carries the authoritative position so the client can snap back into sync
// instead of dead-ending (every subsequent move would also be rejected).
export interface MoveRejectedPayload {
  reason: string;
  fen?: string;
  turn?: 'w' | 'b';
}

// Server -> client when the opponent offers / withdraws a draw. An offer is
// also implicitly cleared (draw:cleared) the moment either side moves.
export interface DrawOfferedPayload {
  color: 'w' | 'b';
}

export interface ChatMessagePayload {
  color: 'w' | 'b';
  displayName: string;
  text: string;
  sentAt: number;
}

export interface RoomCreatedPayload {
  code: string;
}

export interface RoomErrorPayload {
  reason: 'not-found' | 'own-room';
}

export function isVenueTier(value: unknown): value is VenueTier {
  return (
    value === 'garage' ||
    value === 'club' ||
    value === 'arena' ||
    value === 'stadium' ||
    value === 'mainstage' ||
    value === 'world-tour'
  );
}

export function isDuration(value: unknown): value is Duration {
  return value === '3m' || value === '5m' || value === '10m';
}

// The /match route params for a server-announced match (queue:matched). Used by the rematch flow; the
// matchmaking, game-room and challenge screens each still build their own copy of this.
export function matchParamsFromPayload(payload: QueueMatchedPayload): Record<string, string> {
  const params: Record<string, string | undefined> = {
    mode: 'online',
    matchId: payload.matchId,
    color: payload.color,
    fen: payload.fen,
    opponentName: payload.opponent.displayName,
    opponentAvatarId: payload.opponent.avatarId ?? undefined,
    opponentCountry: payload.opponent.country ?? undefined,
    opponentUserId: payload.opponent.userId ?? undefined,
    opponentRating: payload.opponent.rating != null ? String(payload.opponent.rating) : undefined,
    opponentTitle: payload.opponent.title ?? undefined,
    clockW: String(payload.clocks.w),
    clockB: String(payload.clocks.b),
    incrementMs: String(payload.incrementMs),
    venueTier: payload.venueTier,
    buyIn: String(payload.buyIn ?? 0),
    prize: String(payload.prize ?? 0),
    friendly: payload.friendly ? '1' : undefined,
  };
  return Object.fromEntries(Object.entries(params).filter((entry): entry is [string, string] => entry[1] !== undefined));
}

// Rematch (server/src/rematch.ts): events for the "play again with the same opponent" offer.
export type RematchErrorReason =
  | 'unavailable'
  | 'opponent-left'
  | 'already-in-match'
  | 'insufficient-chips'
  | 'opponent-short'
  | 'rating-too-low'
  | 'opponent-ineligible'
  | 'auth-required';

export interface RematchOfferedPayload {
  matchId: string;
  from: string;
  venueTier: VenueTier | null;
  buyIn: number;
  prize: number;
  insured: boolean; // YOUR Safety Net choice from the last game carries over
  friendly: boolean;
}
export interface RematchErrorPayload {
  matchId?: string;
  reason: RematchErrorReason;
  required?: number;
  current?: number;
}
