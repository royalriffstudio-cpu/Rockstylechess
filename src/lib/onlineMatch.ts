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
  opponent: { userId: string | null; displayName: string; avatarId: string | null };
  fen: string;
  clocks: { w: number; b: number };
  incrementMs: number;
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
    | { type: 'draw'; winner: null };
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
