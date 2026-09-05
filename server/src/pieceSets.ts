export interface PieceSetCatalogEntry {
  id: string;
  name: string;
  locked: boolean;
  gemPrice: number; // 0 for free entries
  chipPrice: number; // 0 for free entries
}

// Mirrors src/constants/pieceSets.ts on the client -- see
// server/src/boardThemes.ts's header comment for the full reasoning
// (authoritative for equip validation, the cosmetics seed script, and
// purchase pricing; never carries color/accent data). Keep in sync if sets
// are added/removed/re-priced.
export const PIECE_SETS: PieceSetCatalogEntry[] = [
  // Id isn't 'classic-chrome' -- that's already BOARD_THEMES' free tier id,
  // and cosmeticItems.id is one global primary key across categories.
  { id: 'classic-pieces', name: 'Classic Chrome', locked: false, gemPrice: 0, chipPrice: 0 },
  { id: 'graphite-tour', name: 'Graphite Tour', locked: true, gemPrice: 120, chipPrice: 2_400 },
  { id: 'molten-gold', name: 'Molten Gold', locked: true, gemPrice: 320, chipPrice: 6_400 },
  { id: 'crimson-reaper', name: 'Crimson Reaper', locked: true, gemPrice: 420, chipPrice: 8_400 },
];
