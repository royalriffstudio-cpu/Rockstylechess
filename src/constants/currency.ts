import { Colors } from '@/constants/theme';

export type CurrencyType = 'chips' | 'gems';

/**
 * The single source of truth for how each currency reads app-wide -- its
 * glyph (a MaterialCommunityIcons name) and its accent colour. `CurrencyPill`
 * and `CurrencyIcon` both pull from here; nothing else should hardcode a
 * chip/gem icon.
 */
export const CURRENCY = {
  chips: { icon: 'poker-chip', accent: Colors.gold },
  gems: { icon: 'diamond-stone', accent: Colors.cyan },
} as const satisfies Record<CurrencyType, { icon: string; accent: string }>;
