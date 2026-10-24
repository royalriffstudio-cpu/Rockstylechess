import { and, eq } from 'drizzle-orm';

import { db } from './client.js';
import { pushDevices, pushPreferences } from './schema/index.js';

export const PUSH_CATEGORIES = ['social', 'invites', 'results', 'daily'] as const;
export type PushCategory = (typeof PUSH_CATEGORIES)[number];
export type PushPrefs = Record<PushCategory, boolean>;

const ALL_ON: PushPrefs = { social: true, invites: true, results: true, daily: true };

// No row means "everything on": accounts that never opened Settings need no backfill.
export async function getPushPrefs(userId: string): Promise<PushPrefs> {
  const [row] = await db.select().from(pushPreferences).where(eq(pushPreferences.userId, userId)).limit(1);
  if (!row) return { ...ALL_ON };
  return { social: row.social, invites: row.invites, results: row.results, daily: row.daily };
}

export async function setPushPrefs(userId: string, patch: Partial<PushPrefs>): Promise<PushPrefs> {
  const next = { ...(await getPushPrefs(userId)), ...patch };
  await db
    .insert(pushPreferences)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: pushPreferences.userId, set: next });
  return next;
}

// Expo tokens look like ExponentPushToken[xxxx] (older SDKs) or ExpoPushToken[xxxx].
export function isExpoPushToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 255 && /^(Expo|Exponent)PushToken\[[^\]\s]+\]$/.test(value);
}

/** Register (or move to this account) one device. Idempotent: the app calls it on every launch. */
export async function upsertPushDevice(userId: string, token: string, platform: string, tzOffsetMin: number): Promise<void> {
  await db
    .insert(pushDevices)
    .values({ token, userId, platform, tzOffsetMin })
    .onConflictDoUpdate({ target: pushDevices.token, set: { userId, platform, tzOffsetMin, lastSeenAt: new Date() } });
}

/** Only removes the caller's own device row, so one account cannot unregister another's phone. */
export async function removePushDevice(userId: string, token: string): Promise<void> {
  await db.delete(pushDevices).where(and(eq(pushDevices.token, token), eq(pushDevices.userId, userId)));
}
