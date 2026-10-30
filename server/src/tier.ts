// Rating tier names -- mirrors src/lib/tierLabel.ts on the client (same
// thresholds as the Hall of Fame avatar gates and the rating achievements).
export type RatingTier = 'rookie' | 'challenger' | 'master' | 'grandmaster';

export function ratingTier(rating: number): RatingTier {
  if (rating >= 2200) return 'grandmaster';
  if (rating >= 1800) return 'master';
  if (rating >= 1400) return 'challenger';
  return 'rookie';
}
