import { and, eq, gt, sql } from 'drizzle-orm';

import { AMP_BONUS, GEAR_ITEMS, GEAR_MAX_STOCK, LUCKY_PICK_MIN_STREAK, gearById, type GearItem } from '../gear.js';
import { db } from './client.js';
import { playerItems, playerProfiles } from './schema/index.js';

// Backstage Gear: consumables bought with chips (the sink), activated by the player, spent one
// charge at a time inside the transaction that gives them effect. Never a shortcut: nothing here
// touches chess strength or rating. Rules and numbers: economy.config.json -> `gear`.
//   - Amp Boost:  +ampBonus of BASE Fame on the next 3 Fame-paying wins (spent in db/progression.ts)
//   - Lucky Pick: a win streak of LUCKY_PICK_MIN_STREAK+ survives one loss (spent in persistMatchResult.ts)
// Spending is a conditional UPDATE (`charges > 0`), so two matches ending together cannot both use
// the same charge.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface GearItemView {
  id: string;
  name: string;
  tagline: string;
  price: number;
  charges: number; // uses on one copy
  quantity: number; // in the bag
  activeCharges: number; // left on the copy the player has activated (0 = none active)
  atCap: boolean; // bag is full
}

export interface GearStatus {
  items: GearItemView[];
  maxStock: number;
  chips: number;
}

export async function getGear(userId: string): Promise<GearStatus> {
  const rows = await db.select().from(playerItems).where(eq(playerItems.userId, userId));
  const byId = new Map(rows.map((r) => [r.itemId, r]));
  const [profile] = await db.select({ chips: playerProfiles.chips }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  return {
    maxStock: GEAR_MAX_STOCK,
    chips: profile?.chips ?? 0,
    items: GEAR_ITEMS.map((item) => {
      const row = byId.get(item.id);
      const quantity = row?.quantity ?? 0;
      return {
        id: item.id,
        name: item.name,
        tagline: item.tagline,
        price: item.chips,
        charges: item.charges,
        quantity,
        activeCharges: row?.charges ?? 0,
        atCap: quantity >= GEAR_MAX_STOCK,
      };
    }),
  };
}

export type BuyGearResult =
  | { status: 'ok'; chips: number; quantity: number }
  | { status: 'unknown-item' | 'stock-full' | 'insufficient-chips' | 'profile-not-found' };

// Buys one copy: the chips leave and the bag grows in ONE transaction (the same atomic-spend idiom
// as db/cosmetics.ts), and a full bag refuses before any chip moves.
export async function buyGear(userId: string, itemId: unknown, now = new Date()): Promise<BuyGearResult> {
  const item = gearById(itemId);
  if (!item) return { status: 'unknown-item' };
  return db.transaction(async (tx): Promise<BuyGearResult> => {
    const [profile] = await tx.select({ userId: playerProfiles.userId }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).for('update');
    if (!profile) return { status: 'profile-not-found' };

    await tx.insert(playerItems).values({ userId, itemId: item.id }).onConflictDoNothing();
    const [row] = await tx.select().from(playerItems).where(and(eq(playerItems.userId, userId), eq(playerItems.itemId, item.id))).for('update');
    if (row.quantity >= GEAR_MAX_STOCK) return { status: 'stock-full' };

    const [paid] = await tx
      .update(playerProfiles)
      .set({ chips: sql`${playerProfiles.chips} - ${item.chips}`, updatedAt: now })
      .where(and(eq(playerProfiles.userId, userId), sql`${playerProfiles.chips} >= ${item.chips}`))
      .returning({ chips: playerProfiles.chips });
    if (!paid) return { status: 'insufficient-chips' };

    await tx
      .update(playerItems)
      .set({ quantity: sql`${playerItems.quantity} + 1`, updatedAt: now })
      .where(and(eq(playerItems.userId, userId), eq(playerItems.itemId, item.id)));
    return { status: 'ok', chips: paid.chips, quantity: row.quantity + 1 };
  });
}

export type ActivateGearResult =
  | { status: 'ok'; quantity: number; activeCharges: number }
  | { status: 'unknown-item' | 'already-active' | 'none-in-bag' };

// Moves one copy from the bag onto the player: it is now "on" until its charges are spent. One
// active copy per item (so a stack of five cannot be burned at once).
export async function activateGear(userId: string, itemId: unknown, now = new Date()): Promise<ActivateGearResult> {
  const item = gearById(itemId);
  if (!item) return { status: 'unknown-item' };
  return db.transaction(async (tx): Promise<ActivateGearResult> => {
    const [row] = await tx.select().from(playerItems).where(and(eq(playerItems.userId, userId), eq(playerItems.itemId, item.id))).for('update');
    if (!row || row.quantity < 1) return { status: 'none-in-bag' };
    if (row.charges > 0) return { status: 'already-active' };
    await tx
      .update(playerItems)
      .set({ quantity: row.quantity - 1, charges: item.charges, updatedAt: now })
      .where(and(eq(playerItems.userId, userId), eq(playerItems.itemId, item.id)));
    return { status: 'ok', quantity: row.quantity - 1, activeCharges: item.charges };
  });
}

// Spends one charge of `item` if one is active; returns the charges left, or null when none was active.
async function spendCharge(tx: Tx, userId: string, item: GearItem, now: Date): Promise<number | null> {
  const [row] = await tx
    .update(playerItems)
    .set({ charges: sql`${playerItems.charges} - 1`, updatedAt: now })
    .where(and(eq(playerItems.userId, userId), eq(playerItems.itemId, item.id), gt(playerItems.charges, 0)))
    .returning({ charges: playerItems.charges });
  return row ? row.charges : null;
}

// For grantFame: a Fame-paying win spends one Amp Boost charge, if one is active. Returns the bonus
// to ADD to the Fame multiplier and how many wins the boost has left, or null.
export async function spendAmpCharge(tx: Tx, userId: string, now = new Date()): Promise<{ bonus: number; chargesLeft: number } | null> {
  const left = await spendCharge(tx, userId, gearById('amp-boost') as GearItem, now);
  return left === null ? null : { bonus: AMP_BONUS, chargesLeft: left };
}

// For the online stats update: a LOSS on a streak of LUCKY_PICK_MIN_STREAK+ spends an armed Lucky Pick
// so the streak survives. A shorter streak never spends it (nothing to save). true = the pick saved it.
export async function spendLuckyPick(tx: Tx, userId: string, streak: number, now = new Date()): Promise<boolean> {
  if (streak < LUCKY_PICK_MIN_STREAK) return false;
  return (await spendCharge(tx, userId, gearById('lucky-pick') as GearItem, now)) !== null;
}
