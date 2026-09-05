import { randomCode } from './codeAlphabet.js';
import type { QueuedPlayer } from './matchmaking.js';

const CODE_LENGTH = 6;
// An abandoned "waiting for a friend" room shouldn't leak memory forever --
// same forfeitTimers-style setTimeout cleanup pattern as match.ts.
const ROOM_CODE_TTL_MS = 10 * 60 * 1000;

interface WaitingRoom {
  player: QueuedPlayer;
  timer: NodeJS.Timeout;
}

// One waiting creator per code -- same "keyed lookup, single entry" shape
// matchmaking.ts's per-tier queues use, just keyed by code instead of tier.
const rooms = new Map<string, WaitingRoom>();

function generateCode(): string {
  let code: string;
  do {
    code = randomCode(CODE_LENGTH);
  } while (rooms.has(code));
  return code;
}

export function createRoom(player: QueuedPlayer): string {
  const code = generateCode();
  const timer = setTimeout(() => rooms.delete(code), ROOM_CODE_TTL_MS);
  rooms.set(code, { player, timer });
  return code;
}

export type JoinRoomResult =
  | { status: 'ok'; opponent: QueuedPlayer }
  | { status: 'not-found' }
  | { status: 'own-room' };

// Codes are single-use -- deleted here on successful join, so a stale/
// already-claimed/expired code all collapse into the same 'not-found'
// result with no special-casing needed.
export function joinRoom(code: string, player: QueuedPlayer): JoinRoomResult {
  const normalized = code.toUpperCase();
  const room = rooms.get(normalized);
  if (!room) return { status: 'not-found' };
  if (room.player.guestId === player.guestId) return { status: 'own-room' };

  clearTimeout(room.timer);
  rooms.delete(normalized);
  return { status: 'ok', opponent: room.player };
}

export function cancelRoomBySocketId(socketId: string): void {
  for (const [code, room] of rooms) {
    if (room.player.socketId === socketId) {
      clearTimeout(room.timer);
      rooms.delete(code);
      return;
    }
  }
}
