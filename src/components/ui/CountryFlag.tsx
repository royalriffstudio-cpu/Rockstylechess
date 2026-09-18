import { Text, type TextStyle } from 'react-native';

import { getFlagEmoji } from '@/constants/countries';

interface CountryFlagProps {
  code?: string | null;
  size?: number;
  style?: TextStyle;
}

// Tiny inline flag glyph -- not folded into PlayerAvatar (no text slot today,
// heavily reused, already has a level badge competing for space). Renders
// nothing for a missing/invalid code (bots, guests, accounts that haven't
// set one yet) rather than a placeholder box, so it never leaves a layout gap.
export function CountryFlag({ code, size = 13, style }: CountryFlagProps) {
  const emoji = getFlagEmoji(code);
  if (!emoji) return null;
  return <Text style={[{ fontSize: size }, style]}>{emoji}</Text>;
}
