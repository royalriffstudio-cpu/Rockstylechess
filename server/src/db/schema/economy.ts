import { sql } from 'drizzle-orm';
import { bigint, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';

import { users } from './users.js';

export const currencyEnum = pgEnum('currency', ['chips', 'gems']);
export const purchaseStatusEnum = pgEnum('purchase_status', ['pending', 'completed', 'refunded']);
export const cosmeticCategoryEnum = pgEnum('cosmetic_category', ['board', 'piece', 'avatar']);

// Real-money IAP ledger. `providerTransactionId` is unique specifically to
// guard against double-crediting a replayed/retried store receipt.
export const purchases = pgTable('purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  packId: text('pack_id').notNull(),
  // Null for an entitlement purchase (Remove Ads) -- nothing is "granted" in
  // a currency, `entitlement` below names what was unlocked instead.
  currencyGranted: currencyEnum('currency_granted'),
  amountGranted: bigint('amount_granted', { mode: 'number' }),
  entitlement: text('entitlement'),
  priceUsdCents: integer('price_usd_cents').notNull(),
  provider: text('provider').notNull(),
  providerTransactionId: text('provider_transaction_id').notNull().unique(),
  status: purchaseStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per rewarded-ad reward. Two sources, see db/adEvents.ts:
//  - 'ssv'    : inserted by Google's server-side-verification callback
//               (GET /ads/ssv) the moment an ad is verifiably watched; waits
//               unredeemed (placement/redeemedAt null) until the client asks
//               for the reward. `transactionId` is Google's per-view id, so a
//               replayed callback can't create a second row.
//  - 'client' : the test-ID phase (ADS_REQUIRE_SSV off): inserted already
//               redeemed when the client reports a finished ad.
// Daily caps are counted from redeemed rows, per (user, placement).
export const adEvents = pgTable(
  'ad_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    transactionId: text('transaction_id').unique(),
    placement: text('placement'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
  },
  (t) => [index('ad_events_user_placement_idx').on(t.userId, t.placement, t.redeemedAt)],
);

export const vipGrants = pgTable('vip_grants', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  activeUntil: timestamp('active_until', { withTimezone: true }).notNull(),
  source: text('source').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Catalog (forge.tsx's boards/pieces/avatars) -- only ownership is tracked
// per-user below, the catalog content itself is small/static enough to seed
// once rather than model as heavily as user-generated data.
export const cosmeticItems = pgTable('cosmetic_items', {
  id: varchar('id', { length: 40 }).primaryKey(),
  category: cosmeticCategoryEnum('category').notNull(),
  name: text('name').notNull(),
  gemPrice: integer('gem_price').notNull().default(0),
  metadata: jsonb('metadata'),
});

export const userCosmetics = pgTable(
  'user_cosmetics',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: varchar('item_id', { length: 40 })
      .notNull()
      .references(() => cosmeticItems.id, { onDelete: 'cascade' }),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

// bots.tsx's roster stays a client-side constant (like cosmetics above) --
// this only tracks which locked bots a user has unlocked.
export const botUnlocks = pgTable(
  'bot_unlocks',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    botId: text('bot_id').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.botId] })],
);

// Chip wagers on online venues (Club and up). One row per wagered match, keyed
// by the in-memory match id (the `matches` row only exists once a match has
// ENDED, so it cannot hold an in-flight stake). The row is the escrow record:
// 'held' from pairing until the match ends, then exactly one of
//   'settled'  -- a winner took the pot minus the rake, or
//   'refunded' -- a draw / void early exit / server restart returned both stakes.
// The conditional status flip (held -> settled/refunded) is what makes
// settlement idempotent; see db/wagers.ts.
export const wagers = pgTable(
  'wagers',
  {
    matchId: uuid('match_id').primaryKey(),
    venueTier: text('venue_tier').notNull(),
    buyIn: bigint('buy_in', { mode: 'number' }).notNull(),
    // Nullable + set null (not cascade): deleting an account must not erase the
    // escrow record of the opponent it was playing. A null seat is simply never
    // credited (see db/wagers.ts).
    whiteUserId: uuid('white_user_id').references(() => users.id, { onDelete: 'set null' }),
    blackUserId: uuid('black_user_id').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('held'),
    resultType: text('result_type'),
    winnerUserId: uuid('winner_user_id'),
    payout: bigint('payout', { mode: 'number' }),
    rake: bigint('rake', { mode: 'number' }),
    plies: integer('plies'),
    // Safety Net (db/wagers.ts): per seat, the premium paid at escrow on top of the buy-in and
    // the cover a LOSS pays back. 0 = not insured. Fixed at escrow time, so a later config
    // change cannot re-price a wager already held.
    whitePremium: bigint('white_premium', { mode: 'number' }).notNull().default(0),
    blackPremium: bigint('black_premium', { mode: 'number' }).notNull().default(0),
    whiteCover: bigint('white_cover', { mode: 'number' }).notNull().default(0),
    blackCover: bigint('black_cover', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    settledAt: timestamp('settled_at', { withTimezone: true }),
  },
  (t) => [index('wagers_status_idx').on(t.status, t.createdAt)],
);

// Backstage Gear inventory (db/boosts.ts; items in economy.config.json -> gear). One row per
// (player, item): `quantity` is stock in the bag, `charges` is what is left on the copy the player
// has ACTIVATED (Amp Boost: wins left; Lucky Pick: 1 while armed). Both only change inside
// db/boosts.ts or the one transaction that spends a charge.
export const playerItems = pgTable(
  'player_items',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull(),
    quantity: integer('quantity').notNull().default(0),
    charges: integer('charges').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })],
);

// Festival Run: a paid ladder of server-hosted bot sets (see db/festival.ts). One row
// per run; the entry is debited in the same transaction that inserts it.
//   status 'active'   -- in progress; phase says whether a set is being played
//          'cashed'   -- banked the purse between sets
//          'won'      -- cleared every set, full purse paid
//          'lost'     -- lost (or twice drew) a set, or walked away: nothing paid
//          'refunded' -- a server fault (restart, stale sweep) returned the entry
// The partial unique index allows ONE active run per player, which also makes a
// double "enter" race safe. The conditional status flip out of 'active' is what
// makes cash-out / settlement idempotent.
export const festivalRuns = pgTable(
  'festival_runs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tierId: text('tier_id').notNull(),
    entryPaid: bigint('entry_paid', { mode: 'number' }).notNull(),
    // The set to play next (0-based). setsCleared = purse step reached.
    setIndex: integer('set_index').notNull().default(0),
    setsCleared: integer('sets_cleared').notNull().default(0),
    replaysUsed: integer('replays_used').notNull().default(0),
    status: text('status').notNull().default('active'),
    // 'ready' = waiting to start the next set; 'playing' = a set match is live.
    phase: text('phase').notNull().default('ready'),
    currentMatchId: uuid('current_match_id'),
    payout: bigint('payout', { mode: 'number' }),
    utcDay: text('utc_day').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('festival_runs_one_active_idx').on(t.userId).where(sql`${t.status} = 'active'`),
    index('festival_runs_user_day_idx').on(t.userId, t.tierId, t.utcDay),
    index('festival_runs_status_idx').on(t.status, t.updatedAt),
  ],
);

// First clear of each tier (the one-time title is granted when this row is inserted).
export const festivalClears = pgTable(
  'festival_clears',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tierId: text('tier_id').notNull(),
    clearedAt: timestamp('cleared_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.tierId] })],
);
