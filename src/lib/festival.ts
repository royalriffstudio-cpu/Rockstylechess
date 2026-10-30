import type { FestivalRunView } from '@/lib/api';
import type { FestivalMatchInfo, QueueMatchedPayload } from '@/lib/onlineMatch';
import { getPlayerId } from '@/lib/playerId';
import { ensureAuthenticated, getSocket } from '@/lib/socket';

// Client side of Festival Run. The server runs the bot, validates every move and settles
// the run (server/src/db/festival.ts); this module only
//  - caches each set's `festival:update` so the result screen can read it whether it
//    arrived before or after navigation (same idea as lib/wagerResult.ts),
//  - starts / rejoins a set over the socket and turns the server's `queue:matched` into the
//    /match route params.

export type FestivalUpdateKind = 'advance' | 'replay' | 'cleared' | 'lost' | 'interrupted';

export interface FestivalUpdate {
  kind: FestivalUpdateKind;
  matchId?: string;
  outcome?: 'win' | 'loss' | 'draw';
  endedBy?: string;
  run: FestivalRunView;
  payout?: number;
  chips?: number | null;
  titleUnlocked?: { id: string; name: string } | null;
  bot?: { id: string; name: string };
  how?: 'cashed' | 'refunded'; // interrupted only
}

const updates = new Map<string, FestivalUpdate>();
const listeners = new Set<(update: FestivalUpdate) => void>();
let attached = false;

export function ensureFestivalListener(): void {
  if (attached) return;
  attached = true;
  getSocket().on('festival:update', (update: FestivalUpdate) => {
    updates.set(update.matchId ?? update.run.id, update);
    listeners.forEach((listener) => listener(update));
  });
}

export function getFestivalUpdate(key: string): FestivalUpdate | undefined {
  return updates.get(key);
}

export function subscribeFestival(listener: (update: FestivalUpdate) => void): () => void {
  ensureFestivalListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The /match route params for a matched set (also used when rejoining a live one). */
export function festivalMatchParams(payload: QueueMatchedPayload): Record<string, string> {
  const info = payload.festival as FestivalMatchInfo;
  return {
    mode: 'online',
    matchId: payload.matchId,
    color: payload.color,
    fen: payload.fen,
    opponentName: payload.opponent.displayName,
    clockW: String(payload.clocks.w),
    clockB: String(payload.clocks.b),
    incrementMs: String(payload.incrementMs),
    venueTier: payload.venueTier ?? 'garage',
    buyIn: '0',
    prize: '0',
    festival: JSON.stringify(info),
  };
}

export type StartSetResult = { ok: true } | { ok: false; reason: string };

function awaitMatched(emit: () => void, onMatched: (payload: QueueMatchedPayload) => void, timeoutMs: number): Promise<StartSetResult> {
  return new Promise((resolve) => {
    const socket = getSocket();
    const done = (result: StartSetResult) => {
      clearTimeout(timer);
      socket.off('queue:matched', handleMatched);
      socket.off('festival:error', handleError);
      resolve(result);
    };
    function handleMatched(payload: QueueMatchedPayload) {
      if (!payload.festival) return;
      onMatched(payload);
      done({ ok: true });
    }
    function handleError(payload: { reason?: string }) {
      done({ ok: false, reason: payload?.reason ?? 'unavailable' });
    }
    const timer = setTimeout(() => done({ ok: false, reason: 'timeout' }), timeoutMs);
    socket.on('queue:matched', handleMatched);
    socket.on('festival:error', handleError);
    emit();
  });
}

/** Asks the server to start the next set of the run; `onMatched` navigates into it. */
export async function startFestivalSet(runId: string, onMatched: (payload: QueueMatchedPayload) => void): Promise<StartSetResult> {
  ensureFestivalListener();
  const [, guestId] = await Promise.all([ensureAuthenticated(), getPlayerId()]);
  return awaitMatched(() => getSocket().emit('festival:start-set', { guestId, runId }), onMatched, 10_000);
}

/** Rejoins a set that is still live on the server (the app was closed or lost its connection). */
export async function rejoinFestivalSet(matchId: string, onMatched: (payload: QueueMatchedPayload) => void): Promise<StartSetResult> {
  ensureFestivalListener();
  const [, guestId] = await Promise.all([ensureAuthenticated(), getPlayerId()]);
  return awaitMatched(() => getSocket().emit('match:rejoin', { matchId, guestId }), onMatched, 4_000);
}

export const FESTIVAL_ERROR_COPY: Record<string, string> = {
  'auth-required': 'Sign in to play the Festival.',
  'already-in-match': 'You already have a live match. Finish it first.',
  'not-ready': 'That run is not ready for a new set. Pull to refresh.',
  unavailable: 'The Festival is unavailable right now. Your entry is safe.',
  timeout: 'The server did not answer in time. Your entry is safe, try again.',
  'bad-request': 'Something went wrong. Try again.',
};
