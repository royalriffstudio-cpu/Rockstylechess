// Shared human-typed-code alphabet + generator. Excludes visually ambiguous
// characters (0/O, 1/I/L) -- common practice for codes people read aloud or
// re-type, avoids "is that a zero or an O" support friction. Used by the
// private-room codes (gameRoom.ts) and per-account friend codes
// (db/friends.ts).
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(length: number): string {
  return Array.from(
    { length },
    () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)],
  ).join('');
}
