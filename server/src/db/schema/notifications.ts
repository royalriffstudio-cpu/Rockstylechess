import { index, jsonb, pgEnum, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users.js';

// Real events only (friend requests/challenges, match results) -- reward-
// claimable status (quests/achievements/daily bonus) is deliberately NOT a
// row here. Those are synthesized live at read time in db/notifications.ts,
// same read-time-reconciliation idea db/achievements.ts already uses for
// retroactive credit, so there's no transition-detection logic needed to
// catch the exact moment progress crosses a target.
export const notificationTypeEnum = pgEnum('notification_type', [
  'friend_request_received',
  'friend_request_accepted',
  'friend_challenge_received',
  'match_ended',
]);

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: notificationTypeEnum('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    // Type-specific extra data (e.g. { fromUserId } for friend events,
    // { matchId } for match_ended) -- kept loose rather than one column per
    // type's needs, mirroring economy.ts's purchases.metadata.
    payload: jsonb('payload'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // Nullable = unread -- same idiom as userQuestProgress.claimedAt / messages.readAt.
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('notifications_user_id_created_at_idx').on(t.userId, t.createdAt)],
);
