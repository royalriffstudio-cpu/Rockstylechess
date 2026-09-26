import { pgEnum, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { matches } from './matches.js';
import { users } from './users.js';

export const reportReasonEnum = pgEnum('report_reason', [
  'cheating',
  'harassment',
  'inappropriate_name',
  'spam',
  'other',
]);

// No admin/review workflow yet -- rows are queried directly for now (see
// roadie-support.tsx's "Report a Player"). matchId is optional context, set
// when the report was filed against a past online opponent from match
// history rather than an existing friend.
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporterId: uuid('reporter_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reportedUserId: uuid('reported_user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  reason: reportReasonEnum('reason').notNull(),
  details: text('details'),
  matchId: uuid('match_id').references(() => matches.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
