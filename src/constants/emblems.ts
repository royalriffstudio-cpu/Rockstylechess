import type { ImageSourcePropType } from 'react-native';

import type { RatingTier } from '@/lib/api';

// Painted emblems (assets/progression/emblems/*.png), cut out of the generated
// green-screen originals in assets/emblems by scripts/cutout-green.py. Metro needs
// literal require() paths, so the maps are written out rather than built dynamically.

// Keyed by title id (economy.config.json -> levels.titles).
export const TITLE_EMBLEMS: Record<string, ImageSourcePropType> = {
  roadie: require('../../assets/progression/emblems/title-roadie.png'),
  'opening-act': require('../../assets/progression/emblems/title-opening-act.png'),
  'support-act': require('../../assets/progression/emblems/title-support-act.png'),
  'local-hero': require('../../assets/progression/emblems/title-local-hero.png'),
  'club-headliner': require('../../assets/progression/emblems/title-club-headliner.png'),
  'arena-act': require('../../assets/progression/emblems/title-arena-act.png'),
  'stadium-star': require('../../assets/progression/emblems/title-stadium-star.png'),
  'main-stage-icon': require('../../assets/progression/emblems/title-main-stage-icon.png'),
  'living-legend': require('../../assets/progression/emblems/title-living-legend.png'),
};

export const TIER_EMBLEMS: Record<RatingTier, ImageSourcePropType> = {
  rookie: require('../../assets/progression/emblems/tier-rookie.png'),
  challenger: require('../../assets/progression/emblems/tier-challenger.png'),
  master: require('../../assets/progression/emblems/tier-master.png'),
  grandmaster: require('../../assets/progression/emblems/tier-grandmaster.png'),
};

export function tierForRating(rating: number): RatingTier {
  if (rating >= 2200) return 'grandmaster';
  if (rating >= 1800) return 'master';
  if (rating >= 1400) return 'challenger';
  return 'rookie';
}

// Tour chapter badges (assets/progression/chapters), keyed by chapter id (= venue id).
export const CHAPTER_BADGES: Record<string, ImageSourcePropType> = {
  garage: require('../../assets/progression/chapters/chapter-garage.png'),
  club: require('../../assets/progression/chapters/chapter-club.png'),
  arena: require('../../assets/progression/chapters/chapter-arena.png'),
  stadium: require('../../assets/progression/chapters/chapter-stadium.png'),
  mainstage: require('../../assets/progression/chapters/chapter-mainstage.png'),
  'world-tour': require('../../assets/progression/chapters/chapter-world-tour.png'),
};

// The Tour map (768x1376 painted road from the Garage up to the World Tour stage) and
// where each chapter's stop sits on it, as fractions of the image (measured from the
// six marker discs painted into the art).
export const TOUR_MAP = require('../../assets/progression/map/tour-map.jpg') as ImageSourcePropType;
export const TOUR_MAP_ASPECT = 768 / 1376;
export const TOUR_MAP_NODES: Record<string, { x: number; y: number }> = {
  garage: { x: 0.547, y: 0.927 },
  club: { x: 0.299, y: 0.657 },
  arena: { x: 0.705, y: 0.52 },
  stadium: { x: 0.335, y: 0.414 },
  mainstage: { x: 0.633, y: 0.336 },
  'world-tour': { x: 0.399, y: 0.294 },
};
