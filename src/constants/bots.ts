import type { ImageSourcePropType } from 'react-native';

import type { BotDifficulty } from '@/hooks/useChessGame';
import { ECONOMY } from '@/lib/economy.generated';

// Strength label shown for a bot (same names as the bots screen's tiers).
export const BOT_TIER_LABEL: Record<BotDifficulty, string> = {
  easy: 'NOVICE',
  medium: 'AMATEUR',
  'stockfish-basic': 'SKILLED',
  'stockfish-lite': 'EXPERT',
  'stockfish-strong': 'GRANDMASTER',
};

// The six roster bots (ids/names/difficulty come from economy.config.json so the
// server and the app cannot disagree about who a boss is).
export const ROSTER = ECONOMY.bots;

// chapter id -> its boss bot id (null for the World Tour finale, which is a gauntlet).
export const BOSS_BY_BOT_ID: Record<string, { chapterId: string; chapterName: string }> = Object.fromEntries(
  ECONOMY.tour.chapters
    .filter((c) => c.bossBotId)
    .map((c) => [c.bossBotId as string, { chapterId: c.id, chapterName: c.name }]),
);

// Painted portraits (assets/progression/bosses, cut out by scripts/cutout-white.py).
// Keyed by roster bot id; a bot without art falls back to its emoji.
export const BOT_PORTRAITS: Record<string, ImageSourcePropType> = {
  'roadie-rick': require('../../assets/progression/bosses/boss-roadie-rick.png'),
  'valkyrie-riff': require('../../assets/progression/bosses/boss-valkyrie-riff.png'),
  'metal-head': require('../../assets/progression/bosses/boss-metal-head.png'),
  'the-reaper': require('../../assets/progression/bosses/boss-the-reaper.png'),
  'old-school-roy': require('../../assets/progression/bosses/boss-old-school-roy.png'),
  'king-axl': require('../../assets/progression/bosses/boss-king-axl.png'),
};
