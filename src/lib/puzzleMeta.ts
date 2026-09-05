import type { ICONS } from '@/constants/icons';
import { Colors } from '@/constants/theme';

import { PUZZLES, type PuzzleEntry } from './puzzleCatalog';
import { isPuzzleSolved } from './puzzleProgress';

// Presentation metadata derived from a PuzzleEntry's raw Lichess `themes` /
// `rating`. The catalog (src/lib/puzzleCatalog.ts, auto-generated) has no
// title/name/difficulty fields, so everything human-readable on the Puzzles
// screens is computed here. Pure functions of their arguments, except the
// selection helpers, which read the local solved-set synchronously.

type IconName = keyof typeof ICONS;

// #region Titles

// Named mating patterns -> display name. Anything else ending in "Mate" is
// humanized generically ("hookMate" -> "Hook Mate").
const NAMED_MATE: Record<string, string> = {
  backRankMate: 'Back-Rank Mate',
  bodenMate: "Boden's Mate",
  anastasiaMate: "Anastasia's Mate",
  arabianMate: 'Arabian Mate',
  operaMate: 'Opera Mate',
  smotheredMate: 'Smothered Mate',
  doubleBishopMate: 'Double Bishop Mate',
  hookMate: 'Hook Mate',
  dovetailMate: 'Dovetail Mate',
  vukovicMate: 'Vukovic Mate',
  killBoxMate: 'Kill Box Mate',
  cornerMate: 'Corner Mate',
  epauletteMate: 'Épaulette Mate',
  pillsburysMate: "Pillsbury's Mate",
};

// Tactical motif -> display name, in the order puzzleTitle prefers them.
const MOTIF_TITLE: [theme: string, title: string][] = [
  ['fork', 'Fork'],
  ['pin', 'Pin'],
  ['skewer', 'Skewer'],
  ['discoveredAttack', 'Discovered Attack'],
  ['discoveredCheck', 'Discovered Check'],
  ['doubleCheck', 'Double Check'],
  ['deflection', 'Deflection'],
  ['attraction', 'Attraction'],
  ['clearance', 'Clearance'],
  ['interference', 'Interference'],
  ['xRayAttack', 'X-Ray Attack'],
  ['sacrifice', 'Sacrifice'],
  ['promotion', 'Pawn Promotion'],
  ['underPromotion', 'Pawn Promotion'],
  ['advancedPawn', 'Pawn Promotion'],
];

/** camelCase / kebab -> "Title Case Words". */
function humanize(raw: string): string {
  return raw
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function mateInN(themes: string[]): number | null {
  for (const t of themes) {
    const m = /^mateIn(\d+)$/.exec(t);
    if (m) return Number(m[1]);
  }
  return null;
}

/** A friendly, non-empty title derived from the puzzle's themes. */
export function puzzleTitle(entry: PuzzleEntry): string {
  const themes = entry.themes;

  for (const t of themes) {
    if (NAMED_MATE[t]) return NAMED_MATE[t];
  }
  for (const t of themes) {
    if (t !== 'mate' && t.endsWith('Mate')) return humanize(t);
  }

  const n = mateInN(themes);
  if (n !== null) return `Mate in ${n}`;
  if (themes.includes('mate')) return 'Checkmate';

  for (const [theme, title] of MOTIF_TITLE) {
    if (themes.includes(theme)) return title;
  }

  if (themes.includes('endgame')) return 'Endgame Tactic';
  if (
    themes.includes('kingsideAttack') ||
    themes.includes('queensideAttack') ||
    themes.includes('exposedKing')
  ) {
    return 'Winning Attack';
  }
  if (themes.includes('crushing')) return 'Winning Combination';
  if (themes.includes('middlegame')) return 'Middlegame Combination';
  if (themes.includes('opening')) return 'Opening Trap';
  return 'Tactical Shot';
}

// #endregion

// #region Motif icon + tint

export type PuzzleMotif =
  | 'mate'
  | 'fork'
  | 'pin'
  | 'skewer'
  | 'sacrifice'
  | 'promotion'
  | 'endgame'
  | 'attack'
  | 'tactic';

export interface MotifStyle {
  icon: IconName;
  color: string;
}

export const MOTIF_STYLE: Record<PuzzleMotif, MotifStyle> = {
  mate: { icon: 'chess_king', color: Colors.crimson },
  fork: { icon: 'call_split', color: Colors.ember },
  pin: { icon: 'push_pin', color: Colors.gold },
  skewer: { icon: 'arrow_expand_horizontal', color: Colors.gold },
  sacrifice: { icon: 'local_fire_department', color: Colors.ember },
  promotion: { icon: 'upgrade', color: Colors.cyan },
  endgame: { icon: 'flag', color: Colors.chromeMid },
  attack: { icon: 'swords', color: Colors.ember },
  tactic: { icon: 'bolt', color: Colors.cyan },
};

/** The single motif that best characterizes the puzzle, for the row's icon tile. */
export function puzzleMotif(entry: PuzzleEntry): PuzzleMotif {
  const themes = entry.themes;
  const has = (t: string) => themes.includes(t);

  if (has('mate') || mateInN(themes) !== null || themes.some((t) => t.endsWith('Mate'))) {
    return 'mate';
  }
  if (has('fork')) return 'fork';
  if (has('pin')) return 'pin';
  if (has('skewer')) return 'skewer';
  if (has('sacrifice')) return 'sacrifice';
  if (has('promotion') || has('underPromotion') || has('advancedPawn')) return 'promotion';
  if (has('endgame')) return 'endgame';
  if (
    has('kingsideAttack') ||
    has('queensideAttack') ||
    has('exposedKing') ||
    has('attraction') ||
    has('deflection') ||
    has('discoveredAttack')
  ) {
    return 'attack';
  }
  return 'tactic';
}

// #endregion

// #region Theme labels

/** Explicit labels for the raw Lichess tags that appear in the catalog; the
 *  camelCase humanizer covers anything in the long tail. */
export const THEME_LABEL: Record<string, string> = {
  mate: 'Mate',
  mateIn1: 'Mate in 1',
  mateIn2: 'Mate in 2',
  mateIn3: 'Mate in 3',
  mateIn4: 'Mate in 4',
  mateIn5: 'Mate in 5',
  backRankMate: 'Back-Rank Mate',
  bodenMate: "Boden's Mate",
  anastasiaMate: "Anastasia's Mate",
  arabianMate: 'Arabian Mate',
  operaMate: 'Opera Mate',
  smotheredMate: 'Smothered Mate',
  doubleBishopMate: 'Double Bishop Mate',
  dovetailMate: 'Dovetail Mate',
  cornerMate: 'Corner Mate',
  epauletteMate: 'Épaulette Mate',
  pillsburysMate: "Pillsbury's Mate",
  hangingMate: 'Hanging Mate',
  fork: 'Fork',
  pin: 'Pin',
  skewer: 'Skewer',
  sacrifice: 'Sacrifice',
  deflection: 'Deflection',
  attraction: 'Attraction',
  clearance: 'Clearance',
  interference: 'Interference',
  xRayAttack: 'X-Ray Attack',
  discoveredAttack: 'Discovered Attack',
  discoveredCheck: 'Discovered Check',
  doubleCheck: 'Double Check',
  quietMove: 'Quiet Move',
  defensiveMove: 'Defensive Move',
  promotion: 'Promotion',
  underPromotion: 'Underpromotion',
  advancedPawn: 'Advanced Pawn',
  exposedKing: 'Exposed King',
  kingsideAttack: 'Kingside Attack',
  queensideAttack: 'Queenside Attack',
  hangingPiece: 'Hanging Piece',
  trappedPiece: 'Trapped Piece',
  endgame: 'Endgame',
  middlegame: 'Middlegame',
  opening: 'Opening',
  rookEndgame: 'Rook Endgame',
  pawnEndgame: 'Pawn Endgame',
  queenEndgame: 'Queen Endgame',
  bishopEndgame: 'Bishop Endgame',
  knightEndgame: 'Knight Endgame',
  queenRookEndgame: 'Queen & Rook Endgame',
  crushing: 'Crushing',
  advantage: 'Advantage',
  equality: 'Equality',
  short: 'Short',
  long: 'Long',
  veryLong: 'Very Long',
  oneMove: 'One Move',
  master: 'Master Game',
  masterVsMaster: 'Master vs Master',
  superGM: 'Super GM',
};

export function themeLabel(raw: string): string {
  return THEME_LABEL[raw] ?? humanize(raw);
}

// Tags too generic to be worth showing as a row pill unless nothing else fits.
const GENERIC_THEMES = new Set([
  'short',
  'long',
  'veryLong',
  'oneMove',
  'master',
  'masterVsMaster',
  'superGM',
  'middlegame',
  'opening',
  'endgame',
  'crushing',
  'advantage',
  'equality',
  'mate',
]);

/**
 * Up to `max` of the puzzle's most specific themes, skipping generic tags and
 * anything already implied by its title. Used for the row's meta pills.
 */
export function puzzleTags(entry: PuzzleEntry, max = 2): string[] {
  const title = puzzleTitle(entry).toLowerCase();
  const specific: string[] = [];
  const generic: string[] = [];
  for (const t of entry.themes) {
    if (themeLabel(t).toLowerCase() === title) continue;
    (GENERIC_THEMES.has(t) ? generic : specific).push(t);
  }
  return [...specific, ...generic].slice(0, max);
}

// #endregion

// #region Difficulty tiers

export type TierId = 'easy' | 'medium' | 'hard' | 'expert' | 'master';

export interface DifficultyTier {
  id: TierId;
  label: string;
  min: number;
  max: number;
  accent: string;
  count: number;
}

const TIER_DEFS: Omit<DifficultyTier, 'count'>[] = [
  { id: 'easy', label: 'Easy', min: 0, max: 1199, accent: Colors.cyan },
  { id: 'medium', label: 'Medium', min: 1200, max: 1599, accent: Colors.gold },
  { id: 'hard', label: 'Hard', min: 1600, max: 1999, accent: Colors.ember },
  { id: 'expert', label: 'Expert', min: 2000, max: 2399, accent: Colors.emberLight },
  { id: 'master', label: 'Master', min: 2400, max: Infinity, accent: Colors.crimson },
];

export function tierOf(rating: number): TierId {
  for (const t of TIER_DEFS) {
    if (rating <= t.max) return t.id;
  }
  return 'master';
}

export const DIFFICULTY_TIERS: DifficultyTier[] = TIER_DEFS.map((t) => ({
  ...t,
  count: PUZZLES.reduce((n, p) => n + (tierOf(p.rating) === t.id ? 1 : 0), 0),
}));

export const TIER_IDS: ReadonlySet<string> = new Set(TIER_DEFS.map((t) => t.id));

export function tierAccent(id: TierId): string {
  return DIFFICULTY_TIERS.find((t) => t.id === id)?.accent ?? Colors.cyan;
}

export function tierLabelOf(id: TierId): string {
  return DIFFICULTY_TIERS.find((t) => t.id === id)?.label ?? id;
}

// #endregion

// #region Tactic filters

export type TacticFilterId = 'all' | 'mates' | 'forks' | 'pinsSkewers' | 'sacrifices' | 'endgame';

export interface TacticFilter {
  id: TacticFilterId;
  label: string;
  /** Empty = matches everything. */
  themes: readonly string[];
}

export const TACTIC_FILTERS: TacticFilter[] = [
  { id: 'all', label: 'All', themes: [] },
  {
    id: 'mates',
    label: 'Mates',
    themes: [
      'mate',
      'mateIn1',
      'mateIn2',
      'mateIn3',
      'mateIn4',
      'mateIn5',
      'backRankMate',
      'anastasiaMate',
      'bodenMate',
      'operaMate',
      'arabianMate',
      'smotheredMate',
      'doubleBishopMate',
      'hookMate',
      'dovetailMate',
      'vukovicMate',
      'killBoxMate',
    ],
  },
  { id: 'forks', label: 'Forks', themes: ['fork'] },
  { id: 'pinsSkewers', label: 'Pins & Skewers', themes: ['pin', 'skewer', 'xRayAttack'] },
  {
    id: 'sacrifices',
    label: 'Sacrifices',
    themes: ['sacrifice', 'attraction', 'deflection', 'clearance'],
  },
  {
    id: 'endgame',
    label: 'Endgame',
    themes: [
      'endgame',
      'rookEndgame',
      'pawnEndgame',
      'queenEndgame',
      'bishopEndgame',
      'knightEndgame',
      'queenRookEndgame',
      'advancedPawn',
      'promotion',
      'underPromotion',
    ],
  },
];

export const TACTIC_IDS: ReadonlySet<string> = new Set(TACTIC_FILTERS.map((f) => f.id));

const TACTIC_BY_ID = new Map(TACTIC_FILTERS.map((f) => [f.id, f]));

export function matchesTactic(entry: PuzzleEntry, id: TacticFilterId): boolean {
  const filter = TACTIC_BY_ID.get(id);
  if (!filter || filter.themes.length === 0) return true;
  return entry.themes.some((t) => filter.themes.includes(t));
}

export function tacticLabelOf(id: TacticFilterId): string {
  return TACTIC_BY_ID.get(id)?.label ?? id;
}

// #endregion

// #region Selection

export interface PuzzleQuery {
  tier?: string;
  tacticId?: string;
  unsolvedOnly?: boolean;
}

/**
 * PUZZLES filtered by tier / tactic / solved-state, sorted rating-ascending
 * (then id for stability). An unrecognized tier or tacticId means "no filter
 * on that axis" -- never "match nothing" -- so a stale route param can't blank
 * the list.
 */
export function selectPuzzles(q: PuzzleQuery): PuzzleEntry[] {
  const tier = q.tier && TIER_IDS.has(q.tier) ? (q.tier as TierId) : undefined;
  const tacticId = q.tacticId && TACTIC_IDS.has(q.tacticId) ? (q.tacticId as TacticFilterId) : undefined;

  return PUZZLES.filter((p) => {
    if (tier && tierOf(p.rating) !== tier) return false;
    if (tacticId && !matchesTactic(p, tacticId)) return false;
    if (q.unsolvedOnly && isPuzzleSolved(p.id)) return false;
    return true;
  }).sort((a, b) => a.rating - b.rating || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * The puzzle to open after solving `currentId`. Walks forward (wrapping) from
 * the current position, preferring the first unsolved puzzle, and falling back
 * to the plain next puzzle so the "Next Puzzle" button never dead-ends. Returns
 * null only when the pool has one entry or `currentId` isn't in it.
 */
export function nextPuzzle(currentId: string, q: PuzzleQuery): PuzzleEntry | null {
  const pool = selectPuzzles({ tier: q.tier, tacticId: q.tacticId });
  if (pool.length <= 1) return null;
  const idx = pool.findIndex((p) => p.id === currentId);
  if (idx === -1) return null;

  const ordered = [...pool.slice(idx + 1), ...pool.slice(0, idx)];
  return ordered.find((p) => !isPuzzleSolved(p.id)) ?? ordered[0];
}

/** First unsolved puzzle for a tier/tactic; null when that set is fully solved or empty. */
export function firstUnsolved(q: Omit<PuzzleQuery, 'unsolvedOnly'>): PuzzleEntry | null {
  return selectPuzzles({ ...q, unsolvedOnly: true })[0] ?? null;
}

// #endregion
