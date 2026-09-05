export interface BoardThemeCatalogEntry {
  id: string;
  name: string;
  locked: boolean;
  gemPrice: number; // 0 for free entries
  chipPrice: number; // 0 for free entries
}

// Mirrors src/constants/boardThemes.ts on the client. Authoritative catalog
// for equip validation (PATCH /me/profile), the cosmetics seed script
// (seedCosmetics.ts), and the purchase route's pricing -- never renders
// colors, so it doesn't need the squares/glowColor fields the client has.
// Keep in sync if themes are added/removed/re-priced.
//
// Only classic-chrome is free/unlocked by default. The rest are ordered and
// priced as an ascending ladder (gems:chips held at a constant 1:20
// ratio throughout).
export const BOARD_THEMES: BoardThemeCatalogEntry[] = [
  { id: 'classic-chrome', name: 'Classic Chrome', locked: false, gemPrice: 0, chipPrice: 0 },
  { id: 'cyan-storm', name: 'Cyan Storm', locked: true, gemPrice: 100, chipPrice: 2_000 },
  { id: 'gold-rush', name: 'Gold Rush', locked: true, gemPrice: 200, chipPrice: 4_000 },
  { id: 'crimson-stage', name: 'Crimson Stage', locked: true, gemPrice: 300, chipPrice: 6_000 },
  { id: 'obsidian-void', name: 'Obsidian Void', locked: true, gemPrice: 350, chipPrice: 7_000 },
];
