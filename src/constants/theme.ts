/**
 * Design tokens for RockStyle Chess.
 *
 * The whole app is a single fixed dark theme (no light mode) — a
 * rock-concert / casino-game aesthetic. Every screen and component should
 * pull colors and fonts from here instead of hardcoding hex values or font
 * names, so the look stays consistent across all ~25-30 screens.
 */

export const Colors = {
  // Accents
  ember: '#FF5A1F',
  emberLight: '#FF9248',
  gold: '#FFC23A',
  cyan: '#2FE6FF',
  crimson: '#E11D2A',

  // Chrome / metal neutrals
  chrome: '#F1F3F7',
  chromeMid: '#A6ACB8',
  chromeDark: '#5C6069',

  // Board surface, sampled from the reference render rather than picked by eye:
  // warm ivory squares against deep navy-slate. These are the mid-board values;
  // the per-rank table below is what actually gets drawn. Solid tones, not
  // translucent chrome, so the squares don't pick up whatever panel color
  // happens to sit behind the board.
  boardLight: '#DEDBD6',
  boardDark: '#373D47',
  boardEdge: '#20242C',

  // Sculpted piece tones. Each piece is a gradient body (Hi -> Mid -> Lo,
  // lit from the top-left) plus a rim: gold trim on the black set, cool
  // chrome shading on the white set.
  pieceWhiteHi: '#FFFFFF',
  pieceWhiteMid: '#DEE2E8',
  pieceWhiteLo: '#98A0AC',
  pieceBlackHi: '#5B616C',
  pieceBlackMid: '#2C3037',
  pieceBlackLo: '#101216',

  // Text
  textPrimary: '#F5EFF1',
  textMuted: '#A294A0',

  // Backgrounds
  bgBase: '#0B0709',
  bgPanel: '#17101A',
} as const;

export type ColorToken = keyof typeof Colors;

/**
 * Square colors per rank, measured directly off the reference render.
 * Index 0 is rank 8 (top), index 7 is rank 1 (bottom).
 *
 * The render is lit from above, so its squares are not one flat pair of tones:
 * brightness peaks around ranks 5-6 and falls away toward the player, most
 * sharply on the last rank (light drops #DBDCE0 -> #BDBEC2, dark #676971 ->
 * #595B63). Painting every square one color is what made the board read flat
 * and washed out next to the reference, so each rank gets its measured value
 * and the board picks up the render's own lighting for free.
 */
export const BoardSquares = {
  light: ['#DDDAD5', '#DDDAD5', '#E0DDD8', '#DFDCD8', '#E1DED8', '#DEDCD8', '#DEDBD6', '#DBD8D3'],
  dark: ['#393E48', '#373D46', '#363D48', '#373D48', '#363D48', '#373D48', '#383E49', '#373C46'],
} as const;

/**
 * Font family keys map to the exact PostScript names registered by
 * useFonts() in the root layout. Anton only ships one weight; Oswald and
 * Inter can add more weights here as screens need them (e.g. a bold body
 * variant), without changing what callers import.
 */
export const Fonts = {
  display: 'Anton_400Regular',
  heading: 'Oswald_600SemiBold',
  body: 'Inter_400Regular',
} as const;

export type FontToken = keyof typeof Fonts;

/** Shared corner-radius scale so every panel/button/pill rounds consistently. */
export const Radius = {
  sm: 8,
  md: 14,
  lg: 15,
  full: 999,
} as const;

/** Shared spacing scale for padding/gaps across components. */
export const Spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

/**
 * Canonical multi-stop gradient recipes for buttons/cards/avatar rings,
 * ported from the ui.html mockup's design spec (the same source new_ui's
 * screens were built against). Every stop not already a named Colors token
 * is a tint/shade of one (kept inline rather than added as its own Colors
 * entry -- these only ever appear as gradient stops, never a flat fill).
 */
export const Gradients = {
  primaryButton: [Colors.emberLight, Colors.ember, Colors.crimson] as const,
  goldButton: ['#FFDA7A', Colors.gold, '#D9A01C'] as const,
  cyanButton: ['#9CF0FF', Colors.cyan, '#006470'] as const,
  dangerButton: ['#FF4D58', Colors.crimson, '#991019'] as const,
  avatarRing: [Colors.ember, Colors.gold, Colors.crimson, Colors.ember] as const,
  // new_ui's `gradients.cardSurface` -- vertical bgPanel@0.9 -> bgBase@0.95
  // (raw rgba: withOpacity isn't defined yet at this point in the file),
  // used by RockCard's `surface` variant.
  cardSurface: ['rgba(23,16,26,0.9)', 'rgba(11,7,9,0.95)'] as const,
} as const;

/**
 * Derives an rgba() string from a theme hex color, for translucent
 * backgrounds, borders, and glows. Keeps every component still sourcing
 * its color from this file instead of hand-rolling new rgba literals.
 */
export function withOpacity(hex: string, alpha: number): string {
  const normalized = hex.replace('#', '');
  const r = parseInt(normalized.substring(0, 2), 16);
  const g = parseInt(normalized.substring(2, 4), 16);
  const b = parseInt(normalized.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Linear-RGB blend between two theme hex colors -- ratio 0 returns hexA,
 * ratio 1 returns hexB. Used to derive board theme variants (see
 * constants/boardThemes.ts) from the measured default squares without
 * hand-picking new hex values per theme.
 */
export function mixHex(hexA: string, hexB: string, ratio: number): string {
  const a = hexA.replace('#', '');
  const b = hexB.replace('#', '');
  function mixChannel(offset: number): string {
    const av = parseInt(a.substring(offset, offset + 2), 16);
    const bv = parseInt(b.substring(offset, offset + 2), 16);
    return Math.round(av + (bv - av) * ratio)
      .toString(16)
      .padStart(2, '0');
  }
  return `#${mixChannel(0)}${mixChannel(2)}${mixChannel(4)}`;
}
