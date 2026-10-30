import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  matchParamsFromPayload,
  type QueueMatchedPayload,
  type RematchErrorPayload,
  type RematchErrorReason,
  type RematchOfferedPayload,
} from '@/lib/onlineMatch';
import { ensureAuthenticated, getSocket } from '@/lib/socket';

export type RematchState =
  | 'idle' // nothing asked yet: show the Rematch button
  | 'offering' // you asked, waiting for the other player
  | 'incoming' // they asked, waiting for you
  | 'starting' // both agreed, the server is creating the match
  | 'closed'; // declined / left / expired / refused: no rematch this time

export interface RematchClosed {
  kind: 'declined' | 'left' | 'expired' | 'error';
  reason?: RematchErrorReason;
  required?: number;
}

// Play-again with the SAME opponent after an online match (server/src/rematch.ts). The server opens a short
// window when the match ends; one side offers, the other accepts or declines, and on agreement the server
// answers both with the ordinary `queue:matched` for the new game (colours swapped), which is handled here
// exactly where matchmaking handles it. `onStart` runs just before navigating (leave-guard, clearing the
// temporary replay).
export function useRematch(matchId: string | undefined, onStart: () => void) {
  const router = useRouter();
  // Held in a ref so a changing router identity can never re-subscribe the effect below (its cleanup emits rematch:leave).
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  });
  const [state, setState] = useState<RematchState>('idle');
  const [incoming, setIncoming] = useState<RematchOfferedPayload | null>(null);
  const [closed, setClosed] = useState<RematchClosed | null>(null);
  // Only a match we asked for or accepted may take us to /match (a stray queue:matched must not).
  const awaitingRef = useRef(false);
  const onStartRef = useRef(onStart);
  useEffect(() => {
    onStartRef.current = onStart;
  });

  useEffect(() => {
    if (!matchId) return;
    const socket = getSocket();

    const mine = (payload: { matchId?: string }) => payload.matchId === matchId;
    const close = (info: RematchClosed) => {
      awaitingRef.current = false;
      setIncoming(null);
      setClosed(info);
      setState('closed');
    };
    const onOffered = (payload: RematchOfferedPayload) => {
      if (!mine(payload)) return;
      setIncoming(payload);
      setState('incoming');
    };
    const onDeclined = (payload: { matchId?: string; reason?: string }) => {
      if (mine(payload)) close({ kind: payload.reason === 'left' ? 'left' : 'declined' });
    };
    const onCancelled = (payload: { matchId?: string }) => {
      if (!mine(payload)) return;
      setIncoming(null);
      setState('idle');
    };
    const onExpired = (payload: { matchId?: string }) => {
      if (mine(payload)) close({ kind: 'expired' });
    };
    const onError = (payload: RematchErrorPayload) => {
      // A refused rematch has no matchId when it came from the pairing step (it names the two players, not the window).
      if (payload.matchId && !mine(payload)) return;
      close({ kind: 'error', reason: payload.reason, required: payload.required });
    };
    const onMatched = (payload: QueueMatchedPayload) => {
      if (!awaitingRef.current) return;
      awaitingRef.current = false;
      setState('starting');
      onStartRef.current();
      routerRef.current.replace({ pathname: '/match', params: matchParamsFromPayload(payload) });
    };

    socket.on('rematch:offered', onOffered);
    socket.on('rematch:declined', onDeclined);
    socket.on('rematch:cancelled', onCancelled);
    socket.on('rematch:expired', onExpired);
    socket.on('rematch:error', onError);
    socket.on('queue:matched', onMatched);
    return () => {
      socket.off('rematch:offered', onOffered);
      socket.off('rematch:declined', onDeclined);
      socket.off('rematch:cancelled', onCancelled);
      socket.off('rematch:expired', onExpired);
      socket.off('rematch:error', onError);
      socket.off('queue:matched', onMatched);
      // Leaving the result screen (Home, or into the new match): nobody should keep waiting on this player.
      socket.emit('rematch:leave', { matchId });
    };
  }, [matchId]);

  const offer = useCallback(() => {
    if (!matchId) return;
    awaitingRef.current = true;
    setState('offering');
    void ensureAuthenticated().then(() => getSocket().emit('rematch:offer', { matchId }));
  }, [matchId]);

  const cancel = useCallback(() => {
    if (!matchId) return;
    awaitingRef.current = false;
    getSocket().emit('rematch:cancel', { matchId });
    setState('idle');
  }, [matchId]);

  const respond = useCallback(
    (accept: boolean) => {
      if (!matchId) return;
      if (accept) {
        awaitingRef.current = true;
        setState('starting');
      } else {
        setIncoming(null);
        setClosed({ kind: 'declined' });
        setState('closed');
      }
      getSocket().emit('rematch:respond', { matchId, accept });
    },
    [matchId],
  );

  return { state, incoming, closed, offer, cancel, accept: () => respond(true), decline: () => respond(false) };
}
