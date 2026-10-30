import { ECONOMY } from './economy.generated.js';

export type QuestMetric = 'wins' | 'captures' | 'puzzles_solved' | 'checkmates' | 'online_games';

export interface QuestSeed {
  id: string;
  type: 'daily' | 'weekly';
  title: string;
  description: string;
  icon: string;
  target: number;
  rewardChips: number;
  minLevel: number;
  metric: QuestMetric;
}

// This copy is the authoritative one -- db/seedQuests.ts loads it into the
// `quests` table, and db/quests.ts's progress-increment logic keys off each
// quest's `metric`, never a client-supplied one. No client-side mirror
// exists (unlike spinPrizes.ts/dailyBonusRewards.ts) -- GET /me/quests
// returns full quest objects (title/description/icon/target/rewardChips)
// directly, so quests.tsx renders from the live response instead of a local
// catalog.
//
// Amounts live in economy.config.json (all four together are 275 chips, about
// 1.4 online wins; MATCH_CHIP_REWARDS.win is 200, see matchRewards.ts). Quests are the biggest single
// daily source on purpose: they only pay for actually playing (wins, captures,
// puzzles, a checkmate), unlike the login bonus.
// Replaces the four original sample quests from (rewards)/quests.tsx's
// hardcoded mock data -- "Win 3 Blitz Games" (no time-control concept exists
// anywhere in the app), "Enter 1 Tournament" (Tournaments has no backend at
// all), and "Perfect Opening" (no opening-detection logic exists) had no real
// data source to drive them; these four do, using metrics the game already
// produces at match/puzzle end.
export const QUEST_SEED: QuestSeed[] = [
  {
    id: 'win-games',
    type: 'daily',
    title: 'Win 3 Games',
    description: 'Take the stage and come out on top three times.',
    icon: 'trophy-outline',
    target: 3,
    rewardChips: ECONOMY.quests['win-games'],
    minLevel: 1,
    metric: 'wins',
  },
  {
    id: 'capture-pieces',
    type: 'daily',
    title: 'Capture 20 Pieces',
    description: 'No survivors on the board tonight.',
    icon: 'sword-cross',
    target: 20,
    rewardChips: ECONOMY.quests['capture-pieces'],
    minLevel: 1,
    metric: 'captures',
  },
  {
    id: 'solve-puzzles',
    type: 'daily',
    title: 'Solve 3 Puzzles',
    description: 'Sharpen your ear for the tactics backstage.',
    icon: 'puzzle-outline',
    target: 3,
    rewardChips: ECONOMY.quests['solve-puzzles'],
    minLevel: 1,
    metric: 'puzzles_solved',
  },
  {
    id: 'checkmate-opponent',
    type: 'daily',
    title: 'Checkmate 1 Opponent',
    description: 'End the show with a bang, not a whimper.',
    icon: 'chess-king',
    target: 1,
    rewardChips: ECONOMY.quests['checkmate-opponent'],
    minLevel: 1,
    metric: 'checkmates',
  },
  // ---- Weekly "Tour Dates": bigger goals, unlocked at ECONOMY.weeklyQuests.minLevel so
  // level finally gates something real. Period = Monday 00:00 UTC to the next Monday. ----
  {
    id: 'win-weekly',
    type: 'weekly',
    title: 'Win 10 Games',
    description: 'Ten wins this week. Make every night a headline show.',
    icon: 'trophy-outline',
    target: 10,
    rewardChips: ECONOMY.weeklyQuests['win-weekly'],
    minLevel: ECONOMY.weeklyQuests.minLevel,
    metric: 'wins',
  },
  {
    id: 'online-weekly',
    type: 'weekly',
    title: 'Play 5 Online Matches',
    description: 'Take the stage against real players, five times this week.',
    icon: 'sword-cross',
    target: 5,
    rewardChips: ECONOMY.weeklyQuests['online-weekly'],
    minLevel: ECONOMY.weeklyQuests.minLevel,
    metric: 'online_games',
  },
  {
    id: 'puzzles-weekly',
    type: 'weekly',
    title: 'Solve 20 Puzzles',
    description: 'Twenty tactics in a week keeps the fingers fast.',
    icon: 'puzzle-outline',
    target: 20,
    rewardChips: ECONOMY.weeklyQuests['puzzles-weekly'],
    minLevel: ECONOMY.weeklyQuests.minLevel,
    metric: 'puzzles_solved',
  },
];
