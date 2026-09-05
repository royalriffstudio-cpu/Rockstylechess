import { useRouter } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

import {
  cancelChallenge,
  respondToChallenge as emitRespond,
  sendChallenge as emitSend,
  type ChallengeResolvedPayload,
  type IncomingChallengePayload,
} from '@/lib/friendsSocket';
import type { Duration, QueueMatchedPayload } from '@/lib/onlineMatch';
import { getSocket } from '@/lib/socket';

export type OutgoingStatus = 'pending' | 'declined' | 'expired' | 'error';

export interface OutgoingChallenge {
  challengeId: string | null;
  toUserId: string;
  displayName: string;
  duration: Duration;
  status: OutgoingStatus;
  errorReason?: string;
}

interface ChallengesContextValue {
  incoming: IncomingChallengePayload | null;
  outgoing: OutgoingChallenge | null;
  sendChallenge: (toUserId: string, displayName: string, duration: Duration) => Promise<void>;
  respondToChallenge: (accept: boolean) => Promise<void>;
  cancelOutgoing: () => void;
  dismissOutgoing: () => void;
}

const ChallengesContext = createContext<ChallengesContextValue | null>(null);

// Mounted once at the app root. Owns the realtime friend-challenge handshake
// (server/src/index.ts's friend:challenge* events) and the navigation into
// /match when one connects -- both players are on a menu screen when a
// challenge resolves, so this global listener, not matchmaking.tsx's, is what
// fires queue:matched -> /match for the challenge path.
export function ChallengesProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [incoming, setIncoming] = useState<IncomingChallengePayload | null>(null);
  const [outgoing, setOutgoing] = useState<OutgoingChallenge | null>(null);

  // True once we've accepted an incoming challenge or are waiting on an
  // outgoing one -- gates the queue:matched -> navigate below so an unrelated
  // match event can't yank us onto the board.
  const awaitingMatch = useRef(false);

  useEffect(() => {
    const socket = getSocket();

    const onIncoming = (p: IncomingChallengePayload) => setIncoming(p);

    const onSent = (p: { challengeId: string; toUserId: string; duration: Duration }) => {
      setOutgoing((prev) =>
        prev && prev.toUserId === p.toUserId ? { ...prev, challengeId: p.challengeId, status: 'pending' } : prev,
      );
    };

    const onDeclined = (p: ChallengeResolvedPayload) => {
      awaitingMatch.current = false;
      setOutgoing((prev) => (prev && prev.challengeId === p.challengeId ? { ...prev, status: 'declined' } : prev));
    };

    const onExpired = (p: ChallengeResolvedPayload) => {
      awaitingMatch.current = false;
      setOutgoing((prev) => (prev && prev.challengeId === p.challengeId ? { ...prev, status: 'expired' } : prev));
    };

    const onCancelled = (p: ChallengeResolvedPayload) => {
      setIncoming((prev) => (prev && prev.challengeId === p.challengeId ? null : prev));
    };

    const onError = (p: { reason: string }) => {
      awaitingMatch.current = false;
      setOutgoing((prev) => (prev ? { ...prev, status: 'error', errorReason: p.reason } : prev));
    };

    const onMatched = (p: QueueMatchedPayload) => {
      if (!awaitingMatch.current) return;
      awaitingMatch.current = false;
      setIncoming(null);
      setOutgoing(null);
      router.replace({
        pathname: '/match',
        params: {
          mode: 'online',
          matchId: p.matchId,
          color: p.color,
          fen: p.fen,
          opponentName: p.opponent.displayName,
          opponentAvatarId: p.opponent.avatarId ?? undefined,
          opponentUserId: p.opponent.userId ?? undefined,
          clockW: String(p.clocks.w),
          clockB: String(p.clocks.b),
          incrementMs: String(p.incrementMs),
        },
      });
    };

    socket.on('friend:challenge:incoming', onIncoming);
    socket.on('friend:challenge:sent', onSent);
    socket.on('friend:challenge:declined', onDeclined);
    socket.on('friend:challenge:expired', onExpired);
    socket.on('friend:challenge:cancelled', onCancelled);
    socket.on('friend:challenge:error', onError);
    socket.on('queue:matched', onMatched);

    return () => {
      socket.off('friend:challenge:incoming', onIncoming);
      socket.off('friend:challenge:sent', onSent);
      socket.off('friend:challenge:declined', onDeclined);
      socket.off('friend:challenge:expired', onExpired);
      socket.off('friend:challenge:cancelled', onCancelled);
      socket.off('friend:challenge:error', onError);
      socket.off('queue:matched', onMatched);
    };
  }, [router]);

  const sendChallenge = useCallback(async (toUserId: string, displayName: string, duration: Duration) => {
    awaitingMatch.current = true;
    setOutgoing({ challengeId: null, toUserId, displayName, duration, status: 'pending' });
    try {
      await emitSend(toUserId, duration);
    } catch {
      awaitingMatch.current = false;
      setOutgoing((prev) => (prev ? { ...prev, status: 'error', errorReason: 'send-failed' } : prev));
    }
  }, []);

  const respondToChallenge = useCallback(
    async (accept: boolean) => {
      const current = incoming;
      if (!current) return;
      setIncoming(null);
      if (accept) awaitingMatch.current = true;
      try {
        await emitRespond(current.challengeId, accept);
      } catch {
        awaitingMatch.current = false;
      }
    },
    [incoming],
  );

  const cancelOutgoing = useCallback(() => {
    awaitingMatch.current = false;
    setOutgoing((prev) => {
      if (prev?.challengeId) cancelChallenge(prev.challengeId);
      return null;
    });
  }, []);

  const dismissOutgoing = useCallback(() => {
    awaitingMatch.current = false;
    setOutgoing(null);
  }, []);

  return (
    <ChallengesContext.Provider
      value={{ incoming, outgoing, sendChallenge, respondToChallenge, cancelOutgoing, dismissOutgoing }}
    >
      {children}
    </ChallengesContext.Provider>
  );
}

export function useChallenges(): ChallengesContextValue {
  const context = useContext(ChallengesContext);
  if (!context) throw new Error('useChallenges must be used within a ChallengesProvider');
  return context;
}
