/**
 * Board theme catalog for the chessboard's square colors + frame glow accent.
 *
 * Deliberately scoped to squares/glow only -- the frame/bezel/rivets stay
 * fixed chrome (the board's "hardware," not a skin) and gameplay-semantic
 * tints (last-move gold, selected cyan, check crimson) stay fixed too, since
 * those are functional UI signals used app-wide. Piece skins are a parallel,
 * separately-built feature -- see constants/pieceSets.ts +
 * components/ui/pieceSprites.ts, which ship pre-recolored per-variant SVGs
 * rather than deriving colors live like the squares here. See ChessBoard.tsx
 * and (shop)/forge.tsx for consumers of both.
 *
 * Ids/names/locked/gemPrice mirror forge.tsx's original BOARD_OPTIONS mock.
 * `server/src/boardThemes.ts` mirrors the id/locked subset for server-side
 * equip validation -- keep the two in sync if themes are added/removed/
 * re-priced.
 */
import { BoardSquares, Colors, mixHex } from './theme';

// Muted, weathered accents for the board variants below -- deliberately
// duller than the app's neon UI accents (Colors.crimson/cyan/gold), which
// read as too vibrant/arcade-bright once spread across an entire board.
// These aim for old stone/metal that's seen wear: dusty brick, slate,
// tarnished brass -- not the bright rock-concert palette used elsewhere.
const RUST_STONE = '#7A3B35'; // weathered brick/oxblood, for Crimson Stage
const SLATE_STONE = '#4A6670'; // dusty granite-slate, for Cyan Storm
const BRONZE_STONE = '#8C6B3F'; // tarnished brass/bronze, for Gold Rush

export interface BoardTheme {
  id: string;
  name: string;
  locked: boolean;
  gemPrice?: number;
  chipPrice?: number;
  /** 8-element per-rank arrays, rank 8 (top) -> rank 1 (bottom). */
  squares: { light: readonly string[]; dark: readonly string[] };
  /** Accent for ChessBoard's GlowRing halo around the frame. */
  glowColor: string;
}

function deriveSquares(
  lightAccent: string,
  lightRatio: number,
  darkAccent: string,
  darkRatio: number,
): { light: readonly string[]; dark: readonly string[] } {
  return {
    light: BoardSquares.light.map((hex) => mixHex(hex, lightAccent, lightRatio)),
    dark: BoardSquares.dark.map((hex) => mixHex(hex, darkAccent, darkRatio)),
  };
}

// Only classic-chrome is free/unlocked by default. The rest are ordered and
// priced as an ascending ladder (gems:chips held at a constant 1:20
// ratio throughout) -- keep in sync with server/src/boardThemes.ts.
export const BOARD_THEMES: BoardTheme[] = [
  {
    id: 'classic-chrome',
    name: 'Classic Chrome',
    locked: false,
    // References the measured default directly (not a copy) so this entry
    // stays byte-for-byte identical to the board's original look.
    squares: BoardSquares,
    glowColor: Colors.cyan,
  },
  {
    id: 'cyan-storm',
    name: 'Cyan Storm',
    locked: true,
    gemPrice: 100,
    chipPrice: 2_000,
    squares: deriveSquares(SLATE_STONE, 0.15, SLATE_STONE, 0.35),
    glowColor: SLATE_STONE,
  },
  {
    id: 'gold-rush',
    name: 'Gold Rush',
    locked: true,
    gemPrice: 200,
    chipPrice: 4_000,
    squares: deriveSquares(BRONZE_STONE, 0.15, BRONZE_STONE, 0.35),
    glowColor: BRONZE_STONE,
  },
  {
    id: 'crimson-stage',
    name: 'Crimson Stage',
    locked: true,
    gemPrice: 300,
    chipPrice: 6_000,
    squares: deriveSquares(RUST_STONE, 0.15, RUST_STONE, 0.35),
    glowColor: RUST_STONE,
  },
  {
    id: 'obsidian-void',
    name: 'Obsidian Void',
    locked: true,
    gemPrice: 350,
    chipPrice: 7_000,
    squares: deriveSquares(Colors.chromeMid, 0.25, Colors.bgBase, 0.5),
    glowColor: Colors.chromeMid,
  },
];

export function getBoardTheme(id: string | null | undefined): BoardTheme {
  return BOARD_THEMES.find((theme) => theme.id === id) ?? BOARD_THEMES[0];
}
