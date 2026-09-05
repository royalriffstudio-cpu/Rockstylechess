import { Colors } from '@/constants/theme';

export interface SpinSegment {
  id: string; // must match server/src/spinPrizes.ts's row id
  label: string;
  color: string;
}

// Order here IS the wheel's visual segment order (index 0 = 12 o'clock,
// going clockwise) -- must match server/src/spinPrizes.ts's SPIN_PRIZE_SEED
// order exactly, since spin_prizes has no sort-order column. The server
// picks the winning prize first (POST /me/spin) and returns its id; the
// client looks it up here to find which segment to animate to. Jackpot gets
// our ember accent instead of an off-palette orange so it still reads as
// the "big win" segment.
export const SPIN_SEGMENTS: SpinSegment[] = [
  { id: 'chips-500k', label: '500 CHIPS', color: Colors.bgBase },
  { id: 'gems-10', label: '10 GEMS', color: Colors.bgPanel },
  { id: 'chips-400k', label: '400 CHIPS', color: Colors.bgBase },
  { id: 'chips-1m', label: '1K CHIPS', color: Colors.bgPanel },
  { id: 'gems-5', label: '5 GEMS', color: Colors.bgBase },
  { id: 'chips-800k', label: '800 CHIPS', color: Colors.bgPanel },
  { id: 'jackpot-gems-50', label: 'JACKPOT', color: Colors.ember },
  { id: 'chips-250k', label: '250 CHIPS', color: Colors.bgPanel },
];

export const ANGLE_PER_SEGMENT = 360 / SPIN_SEGMENTS.length;
