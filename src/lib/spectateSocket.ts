import { getSocket } from './socket';

// Socket protocol for Front Row's live spectating. Mirrors friendsSocket.ts's
// role for the social layer -- the REST snapshot (list of currently live
// matches) is in api.ts's getLiveMatches; this file is only the realtime
// join/leave + the live match's own event stream once watching.
//
// Server handlers: server/src/index.ts's spectate:* handlers. Spectating
// never requires auth (same posture as guest play), so this always uses the
// plain getSocket() connection, not ensureAuthenticated().

// --- server -> client -----------------------------------------------------

export interface SpectateJoinedPayload {
  matchId: string;
  fen: string;
  turn: 'w' | 'b';
  clocks: Record<'w' | 'b', number>;
  players: {
    w: { displayName: string; avatarId: string | null };
    b: { displayName: string; avatarId: string | null };
  };
}

export interface SpectateErrorPayload {
  matchId: string | null;
  reason: 'not-found';
}

export interface SpectateCountPayload {
  matchId: string;
  count: number;
}

// Same shape as onlineMatch.ts's move:applied listener expects, plus the
// matchId tag index.ts now includes on every match-room broadcast.
export interface SpectateMoveAppliedPayload {
  matchId: string;
  from: string;
  to: string;
  promotion: 'q' | 'r' | 'b' | 'n';
  fen: string;
  turn: 'w' | 'b';
  isGameOver: boolean;
  clocks: Record<'w' | 'b', number>;
}

export interface SpectateMatchEndedPayload {
  matchId: string;
  result: { type: 'resignation' | 'forfeit' | 'timeout' | 'draw'; winner: 'w' | 'b' | null };
}

// --- client -> server (emit helpers) --------------------------------------

export function joinSpectate(matchId: string): void {
  getSocket().emit('spectate:join', { matchId });
}

export function leaveSpectate(matchId: string): void {
  getSocket().emit('spectate:leave', { matchId });
}
