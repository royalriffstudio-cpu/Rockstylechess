import { and, count, desc, eq, isNull, lt } from 'drizzle-orm';

import { emitToUser } from '../realtime.js';
import { getAchievementsStatus } from './achievements.js';
import { db } from './client.js';
import { getDailyBonusStatus } from './dailyBonus.js';
import { getQuestsStatus } from './quests.js';
import { notifications, notificationTypeEnum } from './schema/index.js';

// Cap on a single feed page -- mirrors auth.ts's clampLimit / directMessages.ts's MAX_PAGE.
const MAX_PAGE = 100;
const DEFAULT_PAGE = 40;

export type NotificationType = (typeof notificationTypeEnum.enumValues)[number];
export type NotificationKind = NotificationType | 'quest_claimable' | 'achievement_claimable' | 'daily_bonus_claimable';

export interface NotificationDTO {
  id: string;
  type: NotificationKind;
  title: string;
  body: string;
  payload: unknown;
  createdAt: string;
  readAt: string | null;
  // Quest/achievement/daily-bonus "ready to claim" items are computed fresh
  // on every fetch (see syntheticNotifications below) rather than stored --
  // they have no id in the notifications table, can't be marked read, and
  // simply stop appearing once the real claim happens.
  synthetic: boolean;
}

function toDTO(row: typeof notifications.$inferSelect): NotificationDTO {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt ? row.readAt.toISOString() : null,
    synthetic: false,
  };
}

// Fire-and-forget-friendly: inserts the persisted row and pushes it live to
// any open app via the same emitToUser mechanism friend requests/DMs already
// use. Called from the real-event trigger sites (auth.ts, index.ts,
// persistMatchResult.ts) -- never for quest/achievement/daily-bonus status,
// see syntheticNotifications.
export async function insertNotification(
  userId: string,
  type: NotificationType,
  title: string,
  body: string,
  payload?: unknown,
): Promise<void> {
  const [row] = await db.insert(notifications).values({ userId, type, title, body, payload }).returning();
  emitToUser(userId, 'notification:new', { notification: toDTO(row) });
}

// Read-time reconciliation, same idea db/achievements.ts's getAchievementsStatus
// already uses for retroactive credit -- asks each status source directly
// rather than trying to detect the exact moment progress crosses a target
// (which bumpCumulative/bumpWatermark don't do today, and duplicate-firing
// that transition would be an easy bug to introduce). Self-healing: an item
// simply stops appearing the moment the real claim happens.
async function syntheticNotifications(userId: string): Promise<NotificationDTO[]> {
  const [quests, achievements, dailyBonus] = await Promise.all([
    getQuestsStatus(userId),
    getAchievementsStatus(userId),
    getDailyBonusStatus(userId),
  ]);

  const items: NotificationDTO[] = [];
  const now = new Date().toISOString();

  for (const quest of quests) {
    if (quest.progress >= quest.target && !quest.claimed) {
      items.push({
        id: `quest:${quest.id}`,
        type: 'quest_claimable',
        title: 'Quest complete',
        body: `${quest.title} is ready to claim.`,
        payload: { questId: quest.id },
        createdAt: now,
        readAt: null,
        synthetic: true,
      });
    }
  }
  for (const achievement of achievements) {
    if (achievement.progress >= achievement.target && !achievement.claimed) {
      items.push({
        id: `achievement:${achievement.id}`,
        type: 'achievement_claimable',
        title: 'Achievement unlocked',
        body: `${achievement.title} is ready to claim.`,
        payload: { achievementId: achievement.id },
        createdAt: now,
        readAt: null,
        synthetic: true,
      });
    }
  }
  if (dailyBonus.canClaimToday) {
    items.push({
      id: 'daily-bonus',
      type: 'daily_bonus_claimable',
      title: 'Daily bonus ready',
      body: "Claim today's reward and keep your streak going.",
      payload: {},
      createdAt: now,
      readAt: null,
      synthetic: true,
    });
  }
  return items;
}

async function unreadPersistedCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ unread: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.unread ?? 0;
}

// Persisted rows, newest-first, paginated exactly like directMessages.ts's
// getMessages (`before` = ISO cursor). Synthetic claimable items are only
// prepended on the first page (before === undefined) -- they're always
// "current," not part of history, so they shouldn't reappear when paging
// further back.
export async function getNotifications(
  userId: string,
  opts: { limit?: number; before?: string },
): Promise<{ notifications: NotificationDTO[]; unreadCount: number }> {
  const limit = Number.isFinite(opts.limit) && (opts.limit ?? 0) > 0 ? Math.min(Math.floor(opts.limit!), MAX_PAGE) : DEFAULT_PAGE;
  const before = opts.before ? new Date(opts.before) : null;

  const [rows, unread, synthetic] = await Promise.all([
    db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          before && !Number.isNaN(before.getTime()) ? lt(notifications.createdAt, before) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
    unreadPersistedCount(userId),
    before ? Promise.resolve([]) : syntheticNotifications(userId),
  ]);

  return {
    notifications: [...synthetic, ...rows.map(toDTO)],
    unreadCount: unread + synthetic.length,
  };
}

// Cheap variant for a badge-only fetch (Control Core doesn't need the full feed).
export async function getUnreadNotificationCount(userId: string): Promise<number> {
  const [unread, synthetic] = await Promise.all([unreadPersistedCount(userId), syntheticNotifications(userId)]);
  return unread + synthetic.length;
}

export async function markNotificationRead(userId: string, notificationId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId), isNull(notifications.readAt)));
}

export async function markAllNotificationsRead(userId: string): Promise<void> {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
}
