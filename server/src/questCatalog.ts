export type QuestMetric = 'wins' | 'captures' | 'puzzles_solved' | 'checkmates';

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
// Amounts kept well under MATCH_CHIP_REWARDS.win (475, see
// matchRewards.ts) -- same "daily quests shouldn't out-earn actually playing"
// philosophy dailyBonusRewards.ts documents, scaled down further since these
// are meant to be repeatable small quests rather than a curated login streak.
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
    rewardChips: 60,
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
    rewardChips: 40,
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
    rewardChips: 30,
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
    rewardChips: 50,
    minLevel: 1,
    metric: 'checkmates',
  },
];
