import { boolean, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const questTypeEnum = pgEnum('quest_type', ['daily', 'weekly']);
export const rewardTypeEnum = pgEnum('reward_type', ['chips', 'gems', 'xp']);
// What real gameplay event a quest's progress is driven by -- lets increment
// logic stay generic ("on event X, bump every quest whose metric is X")
// instead of hardcoding quest ids into game-event code. See db/quests.ts.
export const questMetricEnum = pgEnum('quest_metric', ['wins', 'captures', 'puzzles_solved', 'checkmates']);

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
