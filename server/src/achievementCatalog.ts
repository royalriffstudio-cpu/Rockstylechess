export type AchievementMetric =
  | 'wins'
  | 'rating'
  | 'win_streak'
  | 'friends_added'
  | 'cosmetics_owned'
  | 'spins'
  | 'quests_claimed'
  | 'checkmates'
  | 'captures'
  | 'wins_as_white'
  | 'wins_as_black'
  | 'flawless_wins'
  | 'marathon_wins'
  | 'quickdraw_wins'
  | 'puzzles_solved'
  | 'bot_wins'
  | 'daily_streak'
  | 'messages_sent';

export interface AchievementSeed {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  rewardType: 'chips' | 'gems' | 'xp';
  rewardAmount: number;
  featured: boolean;
  metric: AchievementMetric;
}

// This copy is the authoritative one -- db/seedAchievements.ts loads it into
// the `achievements` table, and db/achievements.ts's progress logic keys off
// each entry's `metric`, never a client-supplied one. Unlike quests (daily,
// repeatable, small rewards), these are permanent one-time unlocks, so
// rewards scale up meaningfully with difficulty -- top-tier gem payouts
// sit at spin.ts's jackpot pricing (50 gems), not a quest's few-dozen chips.
//
// `wins`/`rating`/`friends_added`/`cosmetics_owned`/`spins`/`quests_claimed`
// are read-time reconciled from data that already exists (see
// db/achievements.ts) -- everything else is a genuine event-driven counter
// with no prior history, so existing players start those at 0.
//
// The win ladder is named after the existing venue progression
// (src/constants/venues.ts on the client); rating tiers reuse tierLabel.ts's
// stage names. Keep both in sync if either changes.
export const ACHIEVEMENT_SEED: AchievementSeed[] = [
  // Career wins (online matches) -- venue-ladder themed
  { id: 'win-garage-days', title: 'Garage Days', description: 'Win your first match.', icon: 'garage', target: 1, rewardType: 'chips', rewardAmount: 200, featured: false, metric: 'wins' },
  { id: 'win-club-regular', title: 'Club Regular', description: 'Win 10 matches.', icon: 'glass-cocktail', target: 10, rewardType: 'chips', rewardAmount: 600, featured: false, metric: 'wins' },
  { id: 'win-arena-fighter', title: 'Arena Fighter', description: 'Win 50 matches.', icon: 'stadium-variant', target: 50, rewardType: 'chips', rewardAmount: 1_800, featured: false, metric: 'wins' },
  { id: 'win-stadium-headliner', title: 'Stadium Headliner', description: 'Win 150 matches.', icon: 'castle', target: 150, rewardType: 'gems', rewardAmount: 20, featured: false, metric: 'wins' },
  { id: 'win-mainstage-icon', title: 'Mainstage Icon', description: 'Win 500 matches.', icon: 'guitar-electric', target: 500, rewardType: 'gems', rewardAmount: 60, featured: false, metric: 'wins' },
  { id: 'win-world-tour-legend', title: 'World Tour Legend', description: 'Win 1,500 matches.', icon: 'earth', target: 1_500, rewardType: 'gems', rewardAmount: 150, featured: true, metric: 'wins' },

  // Win streak (online matches, peak-ever)
  { id: 'streak-hot-streak', title: 'Hot Streak', description: 'Win 3 matches in a row.', icon: 'fire', target: 3, rewardType: 'chips', rewardAmount: 300, featured: false, metric: 'win_streak' },
  { id: 'streak-on-fire', title: 'On Fire', description: 'Win 5 matches in a row.', icon: 'fire', target: 5, rewardType: 'chips', rewardAmount: 700, featured: false, metric: 'win_streak' },
  { id: 'streak-unstoppable', title: 'Unstoppable', description: 'Win 10 matches in a row.', icon: 'lightning-bolt', target: 10, rewardType: 'gems', rewardAmount: 25, featured: false, metric: 'win_streak' },
  { id: 'streak-untouchable', title: 'Untouchable', description: 'Win 20 matches in a row.', icon: 'shield-star', target: 20, rewardType: 'gems', rewardAmount: 100, featured: true, metric: 'win_streak' },

  // Rating -- reuses tierLabel.ts's stage names
  { id: 'rating-challenger-stage', title: 'Challenger Stage', description: 'Reach a rating of 1,400.', icon: 'chevron-triple-up', target: 1_400, rewardType: 'chips', rewardAmount: 1_000, featured: false, metric: 'rating' },
  { id: 'rating-master-stage', title: 'Master Stage', description: 'Reach a rating of 1,800.', icon: 'star-circle', target: 1_800, rewardType: 'gems', rewardAmount: 30, featured: false, metric: 'rating' },
  { id: 'rating-grandmaster-stage', title: 'Grandmaster Stage', description: 'Reach a rating of 2,200.', icon: 'crown', target: 2_200, rewardType: 'gems', rewardAmount: 120, featured: true, metric: 'rating' },

  // Puzzle mastery (lifetime solved)
  { id: 'puzzle-novice', title: 'Puzzle Novice', description: 'Solve 10 puzzles.', icon: 'puzzle-outline', target: 10, rewardType: 'chips', rewardAmount: 250, featured: false, metric: 'puzzles_solved' },
  { id: 'puzzle-adept', title: 'Puzzle Adept', description: 'Solve 50 puzzles.', icon: 'puzzle', target: 50, rewardType: 'chips', rewardAmount: 900, featured: false, metric: 'puzzles_solved' },
  { id: 'puzzle-sensei', title: 'Puzzle Sensei', description: 'Solve 200 puzzles.', icon: 'brain', target: 200, rewardType: 'gems', rewardAmount: 35, featured: false, metric: 'puzzles_solved' },
  { id: 'puzzle-grandmaster', title: 'Puzzle Grandmaster', description: 'Solve 1,000 puzzles.', icon: 'chess-queen', target: 1_000, rewardType: 'gems', rewardAmount: 130, featured: true, metric: 'puzzles_solved' },

  // Special one-offs
  { id: 'special-checkmate-artist', title: 'Checkmate Artist', description: 'Win a match by checkmate.', icon: 'chess-king', target: 1, rewardType: 'chips', rewardAmount: 300, featured: false, metric: 'checkmates' },
  { id: 'special-flawless-set', title: 'Flawless Set', description: 'Win a match without losing a single piece.', icon: 'shield-check', target: 1, rewardType: 'chips', rewardAmount: 400, featured: false, metric: 'flawless_wins' },
  { id: 'special-marathon-match', title: 'Marathon Match', description: 'Win a match that goes 60 moves or longer.', icon: 'timer-sand', target: 1, rewardType: 'chips', rewardAmount: 400, featured: false, metric: 'marathon_wins' },
  { id: 'special-quickdraw', title: 'Quickdraw', description: 'Win a match in 20 moves or fewer.', icon: 'flash', target: 1, rewardType: 'chips', rewardAmount: 400, featured: false, metric: 'quickdraw_wins' },

  // Color mastery
  { id: 'color-master-of-white', title: 'Master of White', description: 'Win 25 matches playing White.', icon: 'circle-outline', target: 25, rewardType: 'chips', rewardAmount: 1_200, featured: false, metric: 'wins_as_white' },
  { id: 'color-master-of-black', title: 'Master of Black', description: 'Win 25 matches playing Black.', icon: 'circle-slice-8', target: 25, rewardType: 'chips', rewardAmount: 1_200, featured: false, metric: 'wins_as_black' },

  // Bot sparring
  { id: 'bot-sparring-partner', title: 'Sparring Partner', description: 'Beat a bot 10 times.', icon: 'robot-outline', target: 10, rewardType: 'chips', rewardAmount: 400, featured: false, metric: 'bot_wins' },
  { id: 'bot-slayer', title: 'Bot Slayer', description: 'Beat a bot 100 times.', icon: 'robot-angry-outline', target: 100, rewardType: 'gems', rewardAmount: 20, featured: false, metric: 'bot_wins' },

  // Social
  { id: 'social-making-friends', title: 'Making Friends', description: 'Add 5 friends.', icon: 'account-group', target: 5, rewardType: 'chips', rewardAmount: 500, featured: false, metric: 'friends_added' },
  { id: 'social-whole-crew', title: 'The Whole Crew', description: 'Add 20 friends.', icon: 'account-multiple', target: 20, rewardType: 'gems', rewardAmount: 25, featured: false, metric: 'friends_added' },
  { id: 'social-backstage-pass', title: 'Backstage Pass', description: 'Send 50 messages to friends.', icon: 'message-text', target: 50, rewardType: 'chips', rewardAmount: 500, featured: false, metric: 'messages_sent' },

  // Collector (Forge cosmetics)
  { id: 'collector-fresh-gear', title: 'Fresh Gear', description: 'Unlock your first cosmetic.', icon: 'hanger', target: 1, rewardType: 'chips', rewardAmount: 200, featured: false, metric: 'cosmetics_owned' },
  { id: 'collector-style-icon', title: 'Style Icon', description: 'Own 5 cosmetics.', icon: 'tshirt-crew', target: 5, rewardType: 'chips', rewardAmount: 1_000, featured: false, metric: 'cosmetics_owned' },
  { id: 'collector-full-wardrobe', title: 'Full Wardrobe', description: 'Own every board and piece set in the Forge.', icon: 'wardrobe-outline', target: 9, rewardType: 'gems', rewardAmount: 50, featured: false, metric: 'cosmetics_owned' },

  // Engagement
  { id: 'engagement-spin-cycle', title: 'Spin Cycle', description: 'Spin the prize wheel 25 times.', icon: 'dice-multiple', target: 25, rewardType: 'chips', rewardAmount: 500, featured: false, metric: 'spins' },
  { id: 'engagement-jackpot-chaser', title: 'Jackpot Chaser', description: 'Spin the prize wheel 100 times.', icon: 'slot-machine', target: 100, rewardType: 'gems', rewardAmount: 30, featured: false, metric: 'spins' },
  { id: 'engagement-quest-runner', title: 'Quest Runner', description: 'Claim 10 quests.', icon: 'clipboard-check-outline', target: 10, rewardType: 'chips', rewardAmount: 400, featured: false, metric: 'quests_claimed' },
  { id: 'engagement-quest-champion', title: 'Quest Champion', description: 'Claim 50 quests.', icon: 'clipboard-star-outline', target: 50, rewardType: 'gems', rewardAmount: 25, featured: false, metric: 'quests_claimed' },

  // Loyalty (daily bonus streak, peak-ever)
  { id: 'loyalty-regular', title: 'Regular', description: 'Reach a 7-day daily streak.', icon: 'calendar-check', target: 7, rewardType: 'chips', rewardAmount: 400, featured: false, metric: 'daily_streak' },
  { id: 'loyalty-dedicated-fan', title: 'Dedicated Fan', description: 'Reach a 30-day daily streak.', icon: 'calendar-star', target: 30, rewardType: 'gems', rewardAmount: 20, featured: false, metric: 'daily_streak' },
  { id: 'loyalty-diehard', title: 'Diehard', description: 'Reach a 100-day daily streak.', icon: 'calendar-heart', target: 100, rewardType: 'gems', rewardAmount: 80, featured: false, metric: 'daily_streak' },
];
