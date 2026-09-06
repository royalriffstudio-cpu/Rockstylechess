import { and, count, eq, sql } from 'drizzle-orm';

import type { AchievementMetric } from '../achievementCatalog.js';
import { levelForXp } from '../leveling.js';
import { db } from './client.js';
import { friendIdsOf } from './friends.js';
import { achievements, messages, playerProfiles, userAchievements, userCosmetics, userQuestProgress, userSpinLog } from './schema/index.js';

export type { AchievementMetric } from '../achievementCatalog.js';

export interface AchievementStatusEntry {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  rewardType: 'chips' | 'gems' | 'xp';
  rewardAmount: number;
  featured: boolean;
  progress: number;
  claimed: boolean;
}

// Extracted from db.transaction's own callback signature rather than
// imported from a driver-specific type -- same approach db/quests.ts uses.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Metrics reconciled live from data that already exists elsewhere -- no
// event hook needed anywhere for these, and existing players get retroactive
// credit for lifetime totals the first time getAchievementsStatus runs for
// them. Everything NOT in this list has no prior history anywhere in the
// schema and is a genuine event-driven counter starting at 0 (see
// reportMatchForAchievements / reportPuzzleSolvedForAchievements /
// reportDailyStreakForAchievements below).
const RECONCILED_METRICS: readonly AchievementMetric[] = [
  'wins',
  'rating',
  'friends_added',
  'cosmetics_owned',
  'spins',
  'quests_claimed',
  'messages_sent',
];

async function liveValueFor(userId: string, metric: AchievementMetric): Promise<number> {
  switch (metric) {
    case 'wins': {
      const [row] = await db.select({ v: playerProfiles.wins }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
      return row?.v ?? 0;
    }
    case 'rating': {
      const [row] = await db.select({ v: playerProfiles.rating }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
      return row?.v ?? 0;
    }
    case 'friends_added':
      return (await friendIdsOf(userId)).length;
    case 'cosmetics_owned': {
      const [row] = await db.select({ v: count() }).from(userCosmetics).where(eq(userCosmetics.userId, userId));
      return row?.v ?? 0;
    }
    case 'spins': {
      const [row] = await db.select({ v: count() }).from(userSpinLog).where(eq(userSpinLog.userId, userId));
      return row?.v ?? 0;
    }
    case 'quests_claimed': {
      const [row] = await db
        .select({ v: count() })
        .from(userQuestProgress)
        .where(and(eq(userQuestProgress.userId, userId), sql`${userQuestProgress.claimedAt} is not null`));
      return row?.v ?? 0;
    }
    case 'messages_sent': {
      const [row] = await db.select({ v: count() }).from(messages).where(eq(messages.senderUserId, userId));
      return row?.v ?? 0;
    }
    default:
      return 0;
  }
}

// Reads the full catalog + this user's progress, reconciling every
// live-derived metric (capped by GREATEST against whatever's already
// stored, so a later decrease -- a rating drop, an unfriend -- can never
// claw back progress toward an already-earned unlock) before returning.
export async function getAchievementsStatus(userId: string): Promise<AchievementStatusEntry[]> {
  const catalog = await db.select().from(achievements);
  const progressRows = await db.select().from(userAchievements).where(eq(userAchievements.userId, userId));
  const progressById = new Map(progressRows.map((row) => [row.achievementId, row]));

  // One live query per distinct metric, not per achievement -- several
  // achievements can (and do) share the same metric.
  const neededMetrics = new Set(catalog.filter((a) => RECONCILED_METRICS.includes(a.metric)).map((a) => a.metric));
  const liveByMetric = new Map<AchievementMetric, number>();
  for (const metric of neededMetrics) {
    liveByMetric.set(metric, await liveValueFor(userId, metric));
  }

  const results: AchievementStatusEntry[] = [];
  for (const a of catalog) {
    const stored = progressById.get(a.id);
    let progress = stored?.progress ?? 0;
    if (RECONCILED_METRICS.includes(a.metric)) {
      const live = Math.min(liveByMetric.get(a.metric) ?? 0, a.target);
      if (live > progress) {
        progress = live;
        await db
          .insert(userAchievements)
          .values({ userId, achievementId: a.id, progress })
          .onConflictDoUpdate({ target: [userAchievements.userId, userAchievements.achievementId], set: { progress } });
      }
    }
    results.push({
      id: a.id,
      title: a.title,
      description: a.description,
      icon: a.icon,
      target: a.target,
      rewardType: a.rewardType,
      rewardAmount: a.rewardAmount,
      featured: a.featured,
      progress,
      claimed: stored?.claimedAt != null,
    });
  }
  return results;
}

// Bumps every achievement matching `metric` by `amount`, capped at each
// achievement's own target -- mirrors db/quests.ts's incrementMetric, minus
// the periodStart concept (achievements are one-time, not periodic).
async function bumpCumulative(tx: Tx, userId: string, metric: AchievementMetric, amount: number): Promise<void> {
  if (amount <= 0) return;
  const matching = await tx.select().from(achievements).where(eq(achievements.metric, metric));
  for (const a of matching) {
    await tx
      .insert(userAchievements)
      .values({ userId, achievementId: a.id, progress: Math.min(amount, a.target) })
      .onConflictDoUpdate({
        target: [userAchievements.userId, userAchievements.achievementId],
        set: { progress: sql`LEAST(${userAchievements.progress} + ${amount}, ${a.target})` },
      });
  }
}

// Same shape as bumpCumulative, but ratchets to the higher of stored/value
// instead of adding -- for metrics whose live current value can drop
// (a win streak resets on loss) where only the peak-ever should count.
async function bumpWatermark(tx: Tx, userId: string, metric: AchievementMetric, value: number): Promise<void> {
  if (value <= 0) return;
  const matching = await tx.select().from(achievements).where(eq(achievements.metric, metric));
  for (const a of matching) {
    const capped = Math.min(value, a.target);
    await tx
      .insert(userAchievements)
      .values({ userId, achievementId: a.id, progress: capped })
      .onConflictDoUpdate({
        target: [userAchievements.userId, userAchievements.achievementId],
        set: { progress: sql`GREATEST(${userAchievements.progress}, ${capped})` },
      });
  }
}

export interface MatchAchievementReport {
  won: boolean;
  checkmate: boolean;
  capturedCount: number;
  /** Undefined skips the color/flawless/marathon/quickdraw checks below rather than guessing. */
  opponentCapturedCount?: number;
  color?: 'w' | 'b';
  moveCount?: number;
  isBot?: boolean;
  /** Only known for online matches -- playerProfiles.winStreak isn't touched by bot/local play. */
  winStreak?: number;
}

// Shared by POST /me/quests/report-match (bot/local, client-reported) AND
// persistMatchResult.ts's online-match path -- same two call sites
// reportMatchForQuests already uses, see that function's comment.
export async function reportMatchForAchievements(userId: string, report: MatchAchievementReport): Promise<void> {
  await db.transaction(async (tx) => {
    if (report.won) {
      if (report.checkmate) await bumpCumulative(tx, userId, 'checkmates', 1);
      if (report.color) await bumpCumulative(tx, userId, report.color === 'w' ? 'wins_as_white' : 'wins_as_black', 1);
      if (report.opponentCapturedCount === 0) await bumpCumulative(tx, userId, 'flawless_wins', 1);
      if (typeof report.moveCount === 'number' && report.moveCount >= 60) await bumpCumulative(tx, userId, 'marathon_wins', 1);
      if (typeof report.moveCount === 'number' && report.moveCount > 0 && report.moveCount <= 20) await bumpCumulative(tx, userId, 'quickdraw_wins', 1);
      if (report.isBot) await bumpCumulative(tx, userId, 'bot_wins', 1);
      if (typeof report.winStreak === 'number') await bumpWatermark(tx, userId, 'win_streak', report.winStreak);
    }
    if (report.capturedCount > 0) await bumpCumulative(tx, userId, 'captures', report.capturedCount);
  });
}

export async function reportPuzzleSolvedForAchievements(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await bumpCumulative(tx, userId, 'puzzles_solved', 1);
  });
}

export async function reportDailyStreakForAchievements(userId: string, streak: number): Promise<void> {
  await db.transaction(async (tx) => {
    await bumpWatermark(tx, userId, 'daily_streak', streak);
  });
}

export type ClaimAchievementResult =
  | { status: 'ok'; rewardType: 'chips' | 'gems' | 'xp'; rewardAmount: number; chips: number; gems: number; xp: number }
  | { status: 'not-found' }
  | { status: 'not-complete' }
  | { status: 'already-claimed' };

// No row lock -- same accepted double-request race window db/quests.ts's
// claimQuest and db/dailyBonus.ts's claimDailyBonus already document.
export async function claimAchievement(userId: string, achievementId: string): Promise<ClaimAchievementResult> {
  return db.transaction(async (tx) => {
    const [achievement] = await tx.select().from(achievements).where(eq(achievements.id, achievementId)).limit(1);
    if (!achievement) return { status: 'not-found' as const };

    const [progressRow] = await tx
      .select()
      .from(userAchievements)
      .where(and(eq(userAchievements.userId, userId), eq(userAchievements.achievementId, achievementId)))
      .limit(1);
    if (!progressRow || progressRow.progress < achievement.target) return { status: 'not-complete' as const };
    if (progressRow.claimedAt) return { status: 'already-claimed' as const };

    const now = new Date();
    await tx
      .update(userAchievements)
      .set({ claimedAt: now })
      .where(and(eq(userAchievements.userId, userId), eq(userAchievements.achievementId, achievementId)));

    const [profile] = await tx
      .update(playerProfiles)
      .set(
        achievement.rewardType === 'chips'
          ? { chips: sql`${playerProfiles.chips} + ${achievement.rewardAmount}`, updatedAt: now }
          : achievement.rewardType === 'gems'
            ? { gems: sql`${playerProfiles.gems} + ${achievement.rewardAmount}`, updatedAt: now }
            : { xp: sql`${playerProfiles.xp} + ${achievement.rewardAmount}`, updatedAt: now },
      )
      .where(eq(playerProfiles.userId, userId))
      .returning({ chips: playerProfiles.chips, gems: playerProfiles.gems, xp: playerProfiles.xp });

    if (achievement.rewardType === 'xp') {
      await tx.update(playerProfiles).set({ level: levelForXp(profile.xp) }).where(eq(playerProfiles.userId, userId));
    }

    return {
      status: 'ok' as const,
      rewardType: achievement.rewardType,
      rewardAmount: achievement.rewardAmount,
      chips: profile.chips,
      gems: profile.gems,
      xp: profile.xp,
    };
  });
}
