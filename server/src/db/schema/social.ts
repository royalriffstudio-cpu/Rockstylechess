import { index, integer, pgEnum, pgTable, primaryKey, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const friendshipStatusEnum = pgEnum('friendship_status', ['pending', 'accepted', 'blocked']);
export const bandRoleEnum = pgEnum('band_role', ['owner', 'officer', 'member']);

// front-row.tsx's spectate view (viewer count, chat ticker, live clocks) is
// deliberately NOT modeled here -- that's live state that belongs entirely
// in the Socket.IO server, same as an in-progress match itself.

// One row per relationship, stored canonically ordered -- userId holds the
// lexicographically smaller UUID, friendUserId the larger -- so A<->B is a
// single row regardless of who sent the request. `requestedBy` disambiguates
// a `pending` row's direction. See db/friends.ts's orderPair().
export const friendships = pgTable(
  'friendships',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    friendUserId: uuid('friend_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: friendshipStatusEnum('status').notNull().default('pending'),
    requestedBy: uuid('requested_by')
      .notNull()
      .references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.friendUserId] }),
    // The PK already covers userId-first lookups; this covers "rows where I'm
    // the larger UUID" without a full scan.
    index('friendships_friend_user_id_idx').on(t.friendUserId),
  ],
);

export const bands = pgTable('bands', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  icon: text('icon'),
  description: text('description'),
  ownerUserId: uuid('owner_user_id')
    .notNull()
    .references(() => users.id),
  seasonXp: integer('season_xp').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const bandMembers = pgTable(
  'band_members',
  {
    bandId: uuid('band_id')
      .notNull()
      .references(() => bands.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: bandRoleEnum('role').notNull().default('member'),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.bandId, t.userId] })],
);

export const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  // "<minUserId>:<maxUserId>" for a 1:1 direct-message thread -- one indexed
  // lookup for "the conversation between A and B" (see db/directMessages.ts's
  // getOrCreateDirectConversation). Null is reserved for any future group
  // thread.
  pairKey: varchar('pair_key', { length: 73 }).unique(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.userId] })],
);

export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    senderUserId: uuid('sender_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    text: text('text').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp('read_at', { withTimezone: true }),
  },
  (t) => [index('messages_conversation_id_sent_at_idx').on(t.conversationId, t.sentAt)],
);
