import { bigint, boolean, char, integer, pgTable, text, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

// Doubles as better-auth's `user` model (see betterAuth.ts's drizzleAdapter
// schema mapping) -- name/emailVerified/image/updatedAt are columns it
// requires. Credential (password) storage lives on the `account` table
// (see auth.ts's schema), not here, per better-auth's convention.
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  // Populated with the email's local-part at signup; pick-rockstar.tsx
  // collects the real display name (playerProfiles.displayName) one screen
  // later, unchanged.
  name: text('name').notNull(),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// 1:1 with users -- kept as a separate table (rather than columns on users)
// since it's the "everything about how you're doing in the game" surface,
// distinct from login credentials.
export const playerProfiles = pgTable('player_profiles', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  displayName: varchar('display_name', { length: 40 }),
  avatarId: varchar('avatar_id', { length: 40 }),
  // Short human-typed code another player enters to send a friend request
  // (see db/friends.ts). Set on account creation by betterAuth.ts's
  // user-create hook; nullable only so the 0007 migration can backfill
  // pre-existing rows before the unique index is enforced.
  friendCode: varchar('friend_code', { length: 12 }).unique(),
  level: integer('level').notNull().default(1),
  xp: integer('xp').notNull().default(0),
  // Standard chess-app baseline for a brand new account -- unrelated to the
  // flavor numbers shown in the app's mock UI (iron-id.tsx's 2842, world-
  // rankings.tsx's pinned-row 1650), which are just placeholder content.
  rating: integer('rating').notNull().default(1200),
  winStreak: integer('win_streak').notNull().default(0),
  wins: integer('wins').notNull().default(0),
  losses: integer('losses').notNull().default(0),
  draws: integer('draws').notNull().default(0),
  // Matches sign-up.tsx's displayed "Welcome Bonus: 10,000 Chips".
  chips: bigint('chips', { mode: 'number' }).notNull().default(10_000),
  gems: bigint('gems', { mode: 'number' }).notNull().default(0),
  country: char('country', { length: 2 }),
  // Cosmetic catalogs (forge.tsx) stay client-side constants, same pattern
  // as the bots/rockstars arrays -- these just point at a catalog id by
  // string, no FK, to avoid a circular schema-file dependency with economy.ts.
  equippedBoardId: varchar('equipped_board_id', { length: 40 }),
  equippedPieceId: varchar('equipped_piece_id', { length: 40 }),
  equippedAvatarCosmeticId: varchar('equipped_avatar_cosmetic_id', { length: 40 }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
