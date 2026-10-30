import { and, eq, lte, sql } from 'drizzle-orm';

import type { QuestMetric } from '../questCatalog.js';
import { db } from './client.js';
import { playerProfiles, quests, userQuestProgress } from './schema/index.js';
import { utcDayStart } from './utcDay.js';

// Daily quests reset at 00:00 UTC; weekly ones on Monday 00:00 UTC.
export type QuestType = 'daily' | 'weekly';
export function questPeriodStart(type: QuestType, now = new Date()): Date {
  const day = utcDayStart(now);
  if (type === 'daily') return day;
  const sinceMonday = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - sinceMonday * 86_400_000);
}

export type { QuestMetric } from '../questCatalog.js';

export interface QuestStatusEntry {
  id: string;
  title: string;
  description: string;
  icon: string;
  target: number;
  rewardChips: number;
  progress: number;
  claimed: boolean;
}

export async function getQuestsStatus(userId: string, type: QuestType = 'daily'): Promise<QuestStatusEntry[]> {
  const [profile] = await db.select({ level: playerProfiles.level }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  const level = profile?.level ?? 1;
  const periodStart = questPeriodStart(type);

  const dailyQuests = await db
    .select()
    .from(quests)
    .where(and(eq(quests.type, type), lte(quests.minLevel, level)));

  const progressRows = await db
    .select()
    .from(userQuestProgress)
    .where(and(eq(userQuestProgress.userId, userId), eq(userQuestProgress.periodStart, periodStart)));
  const progressByQuestId = new Map(progressRows.map((row) => [row.questId, row]));

  return dailyQuests.map((quest) => {
    const progressRow = progressByQuestId.get(quest.id);
    return {
      id: quest.id,
      title: quest.title,
      description: quest.description,
      icon: quest.icon,
      target: quest.target,
      rewardChips: quest.rewardChips,
      progress: progressRow?.progress ?? 0,
      claimed: progressRow?.claimedAt != null,
    };
  });
}

// Extracted from db.transaction's own callback signature rather than
// imported from a driver-specific type, so this stays correct regardless of
// which drizzle postgres driver client.ts uses.
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Bumps every daily quest matching `metric` for one user, capped at each
// quest's own target -- never overshoots. `level` is passed in rather than
// re-queried per metric since callers already have it (a match/puzzle report
// touches 1-3 metrics per call).
async function incrementMetric(tx: Tx, userId: string, metric: QuestMetric, amount: number, now: Date, level: number): Promise<void> {
  if (amount <= 0) return;
  // Every quest on this metric, daily AND weekly, each against its own period.
  const matchingQuests = await tx
    .select()
    .from(quests)
    .where(and(eq(quests.metric, metric), lte(quests.minLevel, level)));

  for (const quest of matchingQuests) {
    const periodStart = questPeriodStart(quest.type, now);
    await tx
      .insert(userQuestProgress)
      .values({ userId, questId: quest.id, periodStart, progress: Math.min(amount, quest.target) })
      .onConflictDoUpdate({
        target: [userQuestProgress.userId, userQuestProgress.questId, userQuestProgress.periodStart],
        set: { progress: sql`LEAST(${userQuestProgress.progress} + ${amount}, ${quest.target})` },
      });
  }
}

export interface MatchQuestReport {
  won: boolean;
  checkmate: boolean;
  capturedCount: number;
  // Online (rated, server-hosted) matches only -- feeds "play N online matches".
  onlineGame?: boolean;
}

// Shared by POST /me/quests/report-match (bot/local, client-reported -- same
// trust boundary POST /me/match-reward already accepts, see that route's
// comment) AND persistMatchResult.ts's online-match path (server-computed
// from the authoritative PGN, called directly in-process rather than over
// HTTP). No row lock -- same accepted double-request race window documented
// in dailyBonus.ts's claimDailyBonus.
export async function reportMatchForQuests(userId: string, { won, checkmate, capturedCount, onlineGame }: MatchQuestReport): Promise<void> {
  await db.transaction(async (tx) => {
    const [profile] = await tx.select({ level: playerProfiles.level }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
    const level = profile?.level ?? 1;
    const now = new Date();

    if (won) await incrementMetric(tx, userId, 'wins', 1, now, level);
    if (won && checkmate) await incrementMetric(tx, userId, 'checkmates', 1, now, level);
    if (capturedCount > 0) await incrementMetric(tx, userId, 'captures', capturedCount, now, level);
    if (onlineGame) await incrementMetric(tx, userId, 'online_games', 1, now, level);
  });
}

export async function reportPuzzleSolvedForQuests(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [profile] = await tx.select({ level: playerProfiles.level }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
    const level = profile?.level ?? 1;
    await incrementMetric(tx, userId, 'puzzles_solved', 1, new Date(), level);
  });
}

export type ClaimQuestResult =
  | { status: 'ok'; chips: number; rewardChips: number }
  | { status: 'not-found' }
  | { status: 'not-complete' }
  | { status: 'already-claimed' };

// No row lock (see dailyBonus.ts's claimDailyBonus for the same accepted
// tradeoff on the double-request race window).
export async function claimQuest(userId: string, questId: string): Promise<ClaimQuestResult> {
  return db.transaction(async (tx) => {
    const [quest] = await tx.select().from(quests).where(eq(quests.id, questId)).limit(1);
    if (!quest) return { status: 'not-found' as const };

    const periodStart = questPeriodStart(quest.type);
    const [progressRow] = await tx
      .select()
      .from(userQuestProgress)
      .where(
        and(
          eq(userQuestProgress.userId, userId),
          eq(userQuestProgress.questId, questId),
          eq(userQuestProgress.periodStart, periodStart),
        ),
      )
      .limit(1);

    if (!progressRow || progressRow.progress < quest.target) return { status: 'not-complete' as const };
    if (progressRow.claimedAt) return { status: 'already-claimed' as const };

    const now = new Date();
    await tx
      .update(userQuestProgress)
      .set({ claimedAt: now })
      .where(
        and(
          eq(userQuestProgress.userId, userId),
          eq(userQuestProgress.questId, questId),
          eq(userQuestProgress.periodStart, periodStart),
        ),
      );

    const [profile] = await tx
      .update(playerProfiles)
      .set({ chips: sql`${playerProfiles.chips} + ${quest.rewardChips}`, updatedAt: now })
      .where(eq(playerProfiles.userId, userId))
      .returning({ chips: playerProfiles.chips });

    return { status: 'ok' as const, chips: profile.chips, rewardChips: quest.rewardChips };
  });
}
