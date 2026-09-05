import { randomUUID } from 'node:crypto';

import type { Duration, QueuedPlayer } from './matchmaking.js';

// A friend challenge is a private, in-memory rendezvous just like a game-room
// code (gameRoom.ts) -- the only differences are it's addressed to a specific
// userId instead of a typed code, and it auto-expires fast since both players
// are expected to be online and looking at the prompt.
export const CHALLENGE_TTL_MS = 30_000;

export interface PendingChallenge {
  id: string;
  challenger: QueuedPlayer;
  toUserId: string;
  duration: Duration;
  timer: NodeJS.Timeout;
}

const challenges = new Map<string, PendingChallenge>();

export function createChallenge(
  challenger: QueuedPlayer,
  toUserId: string,
  duration: Duration,
  onExpire: (challenge: PendingChallenge) => void,
): string {
  const id = randomUUID();
  const timer = setTimeout(() => {
    if (challenges.delete(id)) onExpire({ id, challenger, toUserId, duration, timer });
  }, CHALLENGE_TTL_MS);
  challenges.set(id, { id, challenger, toUserId, duration, timer });
  return id;
}

/** Take a challenge out of the pending set (accept / decline / cancel all
 *  consume it) -- returns null if it already expired or was consumed. */
export function consumeChallenge(id: string): PendingChallenge | null {
  const challenge = challenges.get(id);
  if (!challenge) return null;
  clearTimeout(challenge.timer);
  challenges.delete(id);
  return challenge;
}

/** Drop every challenge a now-disconnected socket had outstanding. Returns
 *  them so the caller can notify each target the challenge is off. */
export function cancelChallengesFromSocket(socketId: string): PendingChallenge[] {
  const removed: PendingChallenge[] = [];
  for (const challenge of challenges.values()) {
    if (challenge.challenger.socketId === socketId) {
      clearTimeout(challenge.timer);
      challenges.delete(challenge.id);
      removed.push(challenge);
    }
  }
  return removed;
}
