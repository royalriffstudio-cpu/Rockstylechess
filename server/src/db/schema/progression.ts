import { boolean, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const questTypeEnum = pgEnum('quest_type', ['daily', 'weekly']);
export const rewardTypeEnum = pgEnum('reward_type', ['chips', 'gems', 'xp']);
// What real gameplay event a quest's progress is driven by -- lets increment
// logic stay generic ("on event X, bump every quest whose metric is X")
// instead of hardcoding quest ids into game-event code. See db/quests.ts.
export const questMetricEnum = pgEnum('quest_metric', ['wins', 'captures', 'puzzles_solved', 'checkmates', 'online_games']);

// Achievements are permanent, one-time unlocks (unlike quests' daily/weekly
// reset), so their metric set is wider -- it covers lifetime/watermark
// stats quests never needed. See db/achievements.ts for which metrics are
// read-time-reconciled from existing columns/counts (wins, rating,
// friends_added, cosmetics_owned, spins, quests_claimed) vs. genuinely
// event-driven with no other historical record (everything else here).
export const achievementMetricEnum = pgEnum('achievement_metric', [
  'wins',
  'rating',
  'win_streak',
  'friends_added',
  'cosmetics_owned',
  'spins',
  'quests_claimed',
  'checkmates',
  'captures',
  'wins_as_white',
  'wins_as_black',
  'flawless_wins',
  'marathon_wins',
  'quickdraw_wins',
  'puzzles_solved',
  'bot_wins',
  'daily_streak',
  'messages_sent',
]);

// Backs both achievements.tsx's badge grid AND iron-id.tsx's "trophies" --
// those are the same underlying concept (a catalog of unlockable badges
// with a reward) under two different screen names in the mock UI, so
// iron-id's "trophies" list is just `featured = true` rows from this same
// table rather than a second, near-duplicate schema.
export const achievements = pgTable('achievements', {
  id: varchar('id', { length: 40 }).primaryKey(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  icon: text('icon').notNull(),
  target: integer('target').notNull(),
  // achievements.tsx's featured "Legend of the Arena" achievement pays out
  // "1,000 Diamonds" -- the only place in the app a third currency name
  // appears (everywhere else is chips/gems). Modeled as a gems reward here;
  // recommend fixing that screen's copy in a later pass instead of adding a
  // real third currency for what reads as a mock-data typo.
  rewardType: rewardTypeEnum('reward_type').notNull(),
  rewardAmount: integer('reward_amount').notNull(),
  featured: boolean('featured').notNull().default(false),
  metric: achievementMetricEnum('metric').notNull(),
});

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementId: varchar('achievement_id', { length: 40 })
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    progress: integer('progress').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.achievementId] })],
);

export const quests = pgTable('quests', {
  id: varchar('id', { length: 40 }).primaryKey(),
  type: questTypeEnum('type').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  icon: text('icon').notNull(),
  target: integer('target').notNull(),
  rewardChips: integer('reward_chips').notNull().default(0),
  minLevel: integer('min_level').notNull().default(1),
  metric: questMetricEnum('metric').notNull(),
});

// periodStart is part of the primary key because daily/weekly quests reset
// on a cadence -- a user can have completed the same quest in a prior
// period, so (userId, questId) alone isn't unique across time.
export const userQuestProgress = pgTable(
  'user_quest_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    questId: varchar('quest_id', { length: 40 })
      .notNull()
      .references(() => quests.id, { onDelete: 'cascade' }),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    progress: integer('progress').notNull().default(0),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.questId, t.periodStart] })],
);

export const dailyRewardClaims = pgTable('daily_reward_claims', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  currentStreak: integer('current_streak').notNull().default(0),
  lastClaimedAt: timestamp('last_claimed_at', { withTimezone: true }),
});

export const spinPrizes = pgTable('spin_prizes', {
  id: varchar('id', { length: 40 }).primaryKey(),
  label: text('label').notNull(),
  rewardType: rewardTypeEnum('reward_type').notNull(),
  rewardAmount: integer('reward_amount').notNull(),
  weight: integer('weight').notNull().default(1),
});

export const userSpinLog = pgTable('user_spin_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  prizeId: varchar('prize_id', { length: 40 })
    .notNull()
    .references(() => spinPrizes.id),
  spunAt: timestamp('spun_at', { withTimezone: true }).notNull().defaultNow(),
  // Chips paid for this spin (a chip-priced extra spin, db/spin.ts); null = the free daily spin or the ad spin.
  paidChips: integer('paid_chips'),
});

export const cardSets = pgTable('card_sets', {
  id: varchar('id', { length: 40 }).primaryKey(),
  name: text('name').notNull(),
  tagline: text('tagline'),
  accent: text('accent'),
});

export const collectibleCards = pgTable('collectible_cards', {
  id: varchar('id', { length: 40 }).primaryKey(),
  setId: varchar('set_id', { length: 40 })
    .notNull()
    .references(() => cardSets.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  rarity: text('rarity').notNull(),
  imageUri: text('image_uri'),
});

export const userCards = pgTable(
  'user_cards',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cardId: varchar('card_id', { length: 40 })
      .notNull()
      .references(() => collectibleCards.id, { onDelete: 'cascade' }),
    obtainedAt: timestamp('obtained_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.cardId] })],
);

// ---- Fame / level progression (see db/progression.ts) ----------------------

// One row per user per UTC day: what the daily rules need to remember. `botFame`
// counts toward the daily bot-Fame cap (grind guard); `firstWinDone` is the
// "Opening Night" x2 bonus (first win of the day, any source).
export const dailyProgress = pgTable(
  'daily_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    dayStart: timestamp('day_start', { withTimezone: true }).notNull(),
    botFame: integer('bot_fame').notNull().default(0),
    firstWinDone: boolean('first_win_done').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.dayStart] })],
);

// A level reward is paid exactly once per (user, level): the insert's primary
// key is the idempotency guard (ON CONFLICT DO NOTHING; credit only if inserted).
export const levelRewardsGranted = pgTable(
  'level_rewards_granted',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    level: integer('level').notNull(),
    chips: integer('chips').notNull().default(0),
    gems: integer('gems').notNull().default(0),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.level] })],
);

// Titles a player has earned (catalog in economy.config.json `levels.titles`).
export const userTitles = pgTable(
  'user_titles',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    titleId: varchar('title_id', { length: 40 }).notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.titleId] })],
);

// The persisted "what just happened" after a match (Fame earned, level-ups,
// rewards, titles, rating change). The live push (socket) can be missed by an
// offline or backgrounded player, so every event is stored first; the client
// shows celebrations for unseen events and marks them seen.
export const progressionEvents = pgTable(
  'progression_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(), // 'online' | 'bot'
    matchId: text('match_id'),
    payload: jsonb('payload').notNull(),
    // True when something worth a celebration happened (level up / new title),
    // so the unseen query can be a cheap indexed filter.
    celebratory: boolean('celebratory').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    seenAt: timestamp('seen_at', { withTimezone: true }),
  },
  (t) => [index('progression_events_unseen_idx').on(t.userId, t.celebratory, t.seenAt)],
);

// ---- The Tour (campaign) and verified bot matches (see db/tour.ts, db/botSessions.ts) ----

// One row per (player, gig). `progress` counts toward the gig's target (or is a
// high-water mark for rating/capture gigs); `completedAt` is set once, when the gig
// pays out. Boss gigs use the id `boss-<chapterId>`, perfect-chapter bonuses
// `perfect-<chapterId>`.
export const tourProgress = pgTable(
  'tour_progress',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gigId: varchar('gig_id', { length: 60 }).notNull(),
    progress: integer('progress').notNull().default(0),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [primaryKey({ columns: [t.userId, t.gigId] })],
);

// Per-player Tour state that is not a plain counter: the Encore gauntlet (the
// World Tour finale) is a streak of boss wins that any boss loss resets.
export const tourState = pgTable('tour_state', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  encoreProgress: integer('encore_progress').notNull().default(0),
});

// Per-player, per-chapter boss attempts (db/tourKit.ts): `losses` counts REAL losses to the
// chapter's boss (past backstage.minAttemptPlies) and drives Crowd Energy; `freeKitsUsed`
// is how many of the crowd's free kits were spent. Both only ever go up (a refund of an
// unused free kit is the one decrement).
export const tourBossAttempts = pgTable(
  'tour_boss_attempts',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    chapterId: varchar('chapter_id', { length: 40 }).notNull(),
    losses: integer('losses').notNull().default(0),
    freeKitsUsed: integer('free_kits_used').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.chapterId] })],
);

// A bot match the SERVER knows about. Bot games are played on the device, so the
// only way to stop "POST me a win" farming is to make the server issue the match
// first (it records which bot and which colour) and verify the finished game's PGN
// before paying anything. One session = one reward, claimed atomically.
export const botSessions = pgTable(
  'bot_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    botId: varchar('bot_id', { length: 40 }).notNull(),
    difficulty: varchar('difficulty', { length: 40 }).notNull(),
    color: varchar('color', { length: 1 }).notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    result: varchar('result', { length: 20 }),
    // The Roadie Kit (db/tourKit.ts): null = no kit, 0 = the crowd's free kit, >0 = chips paid.
    // A kit session advances no gigs; an unverifiable result refunds it.
    kitPaid: integer('kit_paid'),
    kitChapterId: varchar('kit_chapter_id', { length: 40 }),
  },
  (t) => [index('bot_sessions_user_idx').on(t.userId, t.finishedAt)],
);
