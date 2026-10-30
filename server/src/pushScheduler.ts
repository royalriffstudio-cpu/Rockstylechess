import { sql } from 'drizzle-orm';

import { resolveDailyBonusClaim } from './db/dailyBonus.js';
import { db } from './db/client.js';
import { utcDayDiff } from './db/utcDay.js';
import { checkPendingReceipts, pushEnabled, pushToUser } from './push.js';

// Daily reminder: one push per account per UTC day, in the player's local evening, only when there is
// something unclaimed (the daily bonus and/or the free daily spin). The "already sent today" marker is
// claimed with one atomic upsert, so several server instances (or an overlapping tick) can never double-send.

const EVENING_FROM_HOUR = 17; // local, inclusive
const EVENING_TO_HOUR = 21; // local, exclusive
const TICK_MS = 10 * 60_000;

export interface DailyCopyInput {
  bonusReady: boolean;
  spinReady: boolean;
  streak: number;
  /** Claiming today is what keeps the streak alive (last claim was yesterday UTC). */
  streakAtRisk: boolean;
}

/** Pure so it can be checked without a database. Returns null when there is nothing to remind about. */
export function dailyPushCopy(i: DailyCopyInput): { title: string; body: string } | null {
  if (!i.bonusReady && !i.spinReady) return null;
  if (i.bonusReady && i.streakAtRisk && i.streak >= 2) {
    return {
      title: `Keep your ${i.streak}-day streak alive`,
      body: i.spinReady ? 'Claim your daily bonus and take your free spin.' : 'Claim your daily bonus before the day resets.',
    };
  }
  if (i.bonusReady && i.spinReady) return { title: 'Your daily rewards are ready', body: 'Daily bonus and a free spin are waiting.' };
  if (i.bonusReady) return { title: 'Your daily bonus is ready', body: 'Claim it before the day resets.' };
  return { title: 'Your free spin is ready', body: 'Give the wheel a spin.' };
}

type Candidate = {
  user_id: string;
  streak: number | null;
  last_claimed_at: Date | string | null;
  last_spun_at: Date | string | null;
};

/**
 * Candidates: accounts with a device whose local hour is in the evening window, daily pushes on, and not
 * already reminded today. The bonus/spin check happens in JS against the same pure rule the claim uses.
 */
async function eveningCandidates(now: Date): Promise<Candidate[]> {
  const rows = await db.execute<Candidate>(sql`
    SELECT DISTINCT ON (d.user_id)
      d.user_id,
      c.current_streak AS streak,
      c.last_claimed_at,
      (SELECT max(spun_at) FROM user_spin_log s WHERE s.user_id = d.user_id) AS last_spun_at
    FROM push_devices d
    LEFT JOIN push_preferences p ON p.user_id = d.user_id
    LEFT JOIN daily_reward_claims c ON c.user_id = d.user_id
    WHERE coalesce(p.daily, true)
      AND p.last_daily_push_day IS DISTINCT FROM (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date
      AND floor(mod(extract(hour FROM ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') * 60
            + extract(minute FROM ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') + d.tz_offset_min + 2880, 1440) / 60)
          >= ${EVENING_FROM_HOUR}
      AND floor(mod(extract(hour FROM ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') * 60
            + extract(minute FROM ${now.toISOString()}::timestamptz AT TIME ZONE 'UTC') + d.tz_offset_min + 2880, 1440) / 60)
          < ${EVENING_TO_HOUR}
    ORDER BY d.user_id
  `);
  return [...rows] as Candidate[];
}

/** Atomically takes today's reminder slot for the account. True for exactly one caller per UTC day. */
async function claimDailySlot(userId: string, now: Date): Promise<boolean> {
  const rows = await db.execute(sql`
    INSERT INTO push_preferences (user_id, last_daily_push_day)
    VALUES (${userId}, (${now.toISOString()}::timestamptz AT TIME ZONE 'UTC')::date)
    ON CONFLICT (user_id) DO UPDATE SET last_daily_push_day = EXCLUDED.last_daily_push_day
    WHERE push_preferences.last_daily_push_day IS DISTINCT FROM EXCLUDED.last_daily_push_day
    RETURNING user_id
  `);
  return rows.length > 0;
}

/** One scheduler pass. Exported so the live test can drive it with a chosen clock. Returns users reminded. */
export async function runDailyPushPass(now = new Date()): Promise<string[]> {
  if (!pushEnabled()) return [];
  const sent: string[] = [];
  for (const row of await eveningCandidates(now)) {
    const streak = row.streak ?? 0;
    const lastClaimedAt = row.last_claimed_at ? new Date(row.last_claimed_at) : null;
    const bonusReady = resolveDailyBonusClaim(lastClaimedAt, streak, now).canClaimToday;
    const spinReady = !row.last_spun_at || utcDayDiff(new Date(row.last_spun_at), now) !== 0;
    const copy = dailyPushCopy({
      bonusReady,
      spinReady,
      streak,
      streakAtRisk: lastClaimedAt !== null && utcDayDiff(lastClaimedAt, now) === 1,
    });
    if (!copy) continue;
    if (!(await claimDailySlot(row.user_id, now))) continue;
    const addressed = await pushToUser(row.user_id, 'daily', { ...copy, data: { kind: 'daily' }, ttl: 6 * 3600 });
    if (addressed > 0) sent.push(row.user_id);
  }
  return sent;
}

export function startPushScheduler(): void {
  const timer = setInterval(() => {
    runDailyPushPass().catch((err) => console.error('daily push pass failed', err));
    checkPendingReceipts().catch((err) => console.error('push receipt check failed', err));
  }, TICK_MS);
  timer.unref();
}
