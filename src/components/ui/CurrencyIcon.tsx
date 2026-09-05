import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

import { CURRENCY, type CurrencyType } from '@/constants/currency';

interface CurrencyIconProps {
  type: CurrencyType;
  size?: number;
  /** Defaults to the currency's own accent (gold for chips, cyan for gems). */
  color?: string;
}

/**
 * The canonical chips / gems glyph -- same source of truth as `CurrencyPill`
 * (`constants/currency.ts`). Use this anywhere a bare currency icon is needed
 * instead of picking a `monetization_on` / `diamond` / `toll` lookalike.
 */
export function CurrencyIcon({ type, size = 16, color }: CurrencyIconProps) {
  const { icon, accent } = CURRENCY[type];
  return <MaterialCommunityIcons name={icon} size={size} color={color ?? accent} />;
}
