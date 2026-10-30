import { Image } from 'expo-image';

import { TIER_EMBLEMS, TITLE_EMBLEMS } from '@/constants/emblems';
import type { RatingTier } from '@/lib/api';

interface EmblemProps {
  size: number;
}

// A level title's painted emblem (renders nothing for an unknown id, so a title
// added to the config before its art exists degrades to text only).
export function TitleEmblem({ titleId, size }: EmblemProps & { titleId: string | null | undefined }) {
  const source = titleId ? TITLE_EMBLEMS[titleId] : undefined;
  if (!source) return null;
  return <Image source={source} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory-disk" />;
}

export function TierEmblem({ tier, size }: EmblemProps & { tier: RatingTier }) {
  return <Image source={TIER_EMBLEMS[tier]} style={{ width: size, height: size }} contentFit="contain" cachePolicy="memory-disk" />;
}
