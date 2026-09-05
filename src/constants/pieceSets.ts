/**
 * Piece-set (piece skin) catalog -- mirrors src/constants/boardThemes.ts's
 * BOARD_THEMES shape/ladder for the Forge's Pieces tab. Unlike board themes,
 * there's no derived-color math at render time: each variant's actual
 * pixels are separate SVG files under assets/pieces/<id>/, produced by one
 * of two one-time authoring scripts -- rendering goes entirely through
 * components/ui/pieceSprites.ts's getPieceSprites(id), which doesn't read
 * this file.
 *
 * Two different art pipelines currently coexist, per variant (see each
 * entry's comment below):
 * - Bespoke geometry: a genuinely different sourced/rendered chess set,
 *   vectorized by scripts/vectorize-pieces.mjs. This is the intended
 *   long-term approach -- real new piece shapes, not just a new color.
 *   Molten Gold and Crimson Reaper are both this now.
 * - Recolor-derived (transitional, being phased out): scripts/recolor-
 *   pieces.mjs mixHex-blends the *classic* set's existing shapes toward an
 *   accent color. Only Graphite Tour is still on this pipeline -- swap it
 *   to bespoke geometry once source renders exist for it too.
 *
 * Ids/names mirror forge.tsx's original PIECE_OPTIONS mock (Graphite Tour /
 * Molten Gold / Crimson Reaper -- the mock's fourth option, Neon Cyan, was
 * dropped as a poor thematic fit, see the git history for that call),
 * re-priced into the same ascending-ladder shape as BOARD_THEMES (only
 * classic-pieces free, gems:chips held at a constant 1:20 ratio).
 * `server/src/pieceSets.ts` mirrors the id/locked/price subset for
 * server-side equip validation -- keep in sync if sets are added/removed/
 * re-priced.
 */
import { Colors } from './theme';

export interface PieceSet {
  id: string;
  name: string;
  locked: boolean;
  gemPrice?: number;
  chipPrice?: number;
  /**
   * Thematic reference color. For a recolor-derived variant, this is the
   * literal accent scripts/recolor-pieces.mjs blended the classic fills
   * toward (keep both in sync). For a bespoke-geometry variant it's purely
   * descriptive -- the art has its own baked-in palette already.
   * Informational only, not read at render time.
   */
  accentColor: string;
}

export const PIECE_SETS: PieceSet[] = [
  {
    // Id deliberately isn't 'classic-chrome' -- that id is already taken by
    // BOARD_THEMES' free tier, and cosmeticItems.id is one global primary
    // key shared across board/piece/avatar categories (not scoped per
    // category), so reusing it would silently collide rows on seed.
    id: 'classic-pieces',
    name: 'Classic Chrome',
    locked: false,
    accentColor: Colors.chrome,
  },
  {
    // Recolor-derived (transitional) -- see scripts/recolor-pieces.mjs.
    id: 'graphite-tour',
    name: 'Graphite Tour',
    locked: true,
    gemPrice: 120,
    chipPrice: 2_400,
    accentColor: Colors.chromeDark,
  },
  {
    // Bespoke geometry: a real hand-sourced silver/gold-trim chess set,
    // vectorized by scripts/vectorize-pieces.mjs from
    // assets/pieces/molten-gold/*_gold.png -- not a recolor of the classic
    // shapes. accentColor here is descriptive only.
    id: 'molten-gold',
    name: 'Molten Gold',
    locked: true,
    gemPrice: 320,
    chipPrice: 6_400,
    accentColor: Colors.gold,
  },
  {
    // Bespoke geometry: a real hand-sourced silver/gunmetal + crimson-trim
    // chess set, vectorized by scripts/vectorize-pieces.mjs from
    // assets/pieces/crimson-reaper/*_crimson.png -- not a recolor of the
    // classic shapes. accentColor here is descriptive only.
    id: 'crimson-reaper',
    name: 'Crimson Reaper',
    locked: true,
    gemPrice: 420,
    chipPrice: 8_400,
    accentColor: Colors.crimson,
  },
];

export function getPieceSet(id: string | null | undefined): PieceSet {
  return PIECE_SETS.find((set) => set.id === id) ?? PIECE_SETS[0];
}
