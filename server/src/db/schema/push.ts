import { boolean, date, index, integer, pgTable, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

// One row per installed app instance that agreed to be pushed to. `token` is the Expo push token and
// the primary key on purpose: signing a different account in on the same phone upserts the row onto
// the new user, so the previous account stops receiving that phone's notifications.
export const pushDevices = pgTable(
  'push_devices',
  {
    token: varchar('token', { length: 255 }).primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    platform: varchar('platform', { length: 16 }).notNull(),
    // Minutes east of UTC, as reported by the device when it registered. Only the daily-reward
    // reminder reads it (to pick an evening local hour); game resets stay on the UTC day.
    tzOffsetMin: integer('tz_offset_min').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_devices_user_id_idx').on(t.userId)],
);

// Per-account category switches. A missing row means "all on" (see db/pushPrefs.ts), so accounts that
// never opened Settings need no backfill.
export const pushPreferences = pgTable('push_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  social: boolean('social').notNull().default(true),
  invites: boolean('invites').notNull().default(true),
  results: boolean('results').notNull().default(true),
  daily: boolean('daily').notNull().default(true),
  // The UTC day the daily-reward reminder last went out; the scheduler's atomic "send at most once a
  // day" claim (see pushScheduler.ts).
  lastDailyPushDay: date('last_daily_push_day'),
});

