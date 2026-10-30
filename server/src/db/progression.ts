import { and, desc, eq, sql } from 'drizzle-orm';

import { ECONOMY, LEVEL_REWARDS, type BotRewardDifficulty } from '../economy.generated.js';
import { levelForXp, getLevelProgress } from '../leveling.js';
import { spendAmpCharge } from './boosts.js';
import type { MatchOutcome } from '../matchRewards.js';
import { FESTIVAL_TITLES } from '../festival.js';
import { TOUR_TITLES } from '../tour.js';
import { ratingTier, type RatingTier } from '../tier.js';
import { db } from './client.js';
import type { QuestStatusEntry } from './quests.js';
import type { TourUpdate } from './tour.js';
import { dailyProgress, levelRewardsGranted, playerProfiles, progressionEvents, userTitles } from './schema/index.js';
import { utcDayStart } from './utcDay.js';

// Fame (= XP) and everything that hangs off it: the daily rules (bot cap,
// "Opening Night"), the Hot Streak multiplier, level rewards, titles, and the
// stored "what just happened" event the client turns into the Show Report and
// the Level Up moment. All numbers are in economy.config.json (`fame`, `levels`).
// Chips are NEVER multiplied here; level rewards are small fixed amounts.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TitleInfo {
  id: string;
  name: string;
  minLevel: number;
}
export const TITLES: TitleInfo[] = [...ECONOMY.levels.titles].sort((a, b) => a.minLevel - b.minLevel);

export function titleById(id: string | null | undefined): TitleInfo | null {
  const level = TITLES.find((t) => t.id === id);
  if (level) return level;
  // Chapter and Festival titles (earned by beating a Tour boss / clearing a run) have no level requirement.
  const earned = TOUR_TITLES.find((t) => t.id === id) ?? FESTIVAL_TITLES.find((t) => t.id === id);
  return earned ? { id: earned.id, name: earned.name, minLevel: Number.POSITIVE_INFINITY } : null;
}

export interface GoalProgress {
  id: string;
  title: string;
  before: number;
  after: number;
  target: number;
  completed: boolean; // reached its target during THIS match
}

// What changed in today's daily goals between two snapshots of getQuestsStatus.
export function diffGoals(before: QuestStatusEntry[], after: QuestStatusEntry[]): GoalProgress[] {
  const beforeById = new Map(before.map((q) => [q.id, q]));
  const changed: GoalProgress[] = [];
  for (const quest of after) {
    const prev = beforeById.get(quest.id)?.progress ?? 0;
    if (quest.progress > prev) {
      changed.push({
        id: quest.id,
        title: quest.title,
        before: prev,
        after: quest.progress,
        target: quest.target,
        completed: prev < quest.target && quest.progress >= quest.target,
      });
    }
  }
  return changed;
}

export interface FameInput {
  source: 'online' | 'bot';
  outcome: MatchOutcome;
  difficulty?: BotRewardDifficulty; // bot only
  winStreak?: number; // online only: the streak AFTER this match
  matchId?: string;
  rating?: { before: number; after: number };
  goals?: GoalProgress[];
  tour?: TourUpdate | null; // what the Tour did with this match (already paid by db/tour.ts)
  // online only: a Lucky Pick just saved this streak from the loss (db/persistMatchResult.ts)
  luckyPickSaved?: number;
}

export interface ProgressionSummary {
  eventId: string;
  source: 'online' | 'bot';
  matchId: string | null;
  outcome: MatchOutcome;
  fame: {
    base: number; // before multipliers (and after the daily bot cap)
    gained: number;
    openingNight: boolean; // first win of the UTC day: x2
    hotStreak: number; // multiplier applied (1 = none)
    streak: number; // current win streak (online), else 0
    capped: boolean; // bot Fame was cut by the daily cap
    botFameLeftToday: number | null; // bot only
    ampBonus: number; // Amp Boost: added to the multiplier (0 = none was active)
    ampWinsLeft: number; // wins left on the active Amp Boost after this one
    luckyPickSaved: number; // the win streak a Lucky Pick just saved from a loss (0 = none)
  };
  xpBefore: number;
  xpAfter: number;
  levelBefore: number;
  levelAfter: number;
  levelProgress: { xpIntoLevel: number; xpForNextLevel: number; progress: number };
  rewards: { chips: number; gems: number; byLevel: { level: number; chips: number; gems: number }[] };
  titlesUnlocked: { id: string; name: string }[];
  equippedTitle: { id: string; name: string } | null;
  rating: null | { before: number; after: number; delta: number; tierBefore: RatingTier; tierAfter: RatingTier };
  goals: GoalProgress[];
  tour: TourUpdate | null;
}

function hotStreakMultiplier(streak: number): number {
  let mult = 1;
  for (const step of ECONOMY.fame.hotStreak) if (streak >= step.minStreak) mult = step.mult;
  return mult;
}

function baseFame(input: FameInput): number {
  if (input.source === 'online') return ECONOMY.fame.online[input.outcome];
  const win = ECONOMY.fame.botWin[input.difficulty ?? 'easy'];
  if (input.outcome === 'win') return win;
  if (input.outcome === 'draw') return Math.round(win * ECONOMY.fame.botDrawFraction);
  return 0;
}

// Grants Fame for one finished match and returns the full summary. ONE
// transaction: the XP, level, level rewards, titles and the stored event commit
// together or not at all, and each reward / title is protected by a primary-key
// conflict so a retry can never pay twice.
export async function grantFame(userId: string, input: FameInput, now = new Date()): Promise<ProgressionSummary> {
  return db.transaction(async (tx) => {
    const [profile] = await tx
      .select({ xp: playerProfiles.xp, level: playerProfiles.level, equippedTitleId: playerProfiles.equippedTitleId })
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, userId))
      .for('update');
    if (!profile) throw new Error('profile-not-found');

    const dayStart = utcDayStart(now);
    await tx.insert(dailyProgress).values({ userId, dayStart }).onConflictDoNothing();
    const [daily] = await tx
      .select()
      .from(dailyProgress)
      .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.dayStart, dayStart)))
      .for('update');

    // ---- how much Fame ----
    let base = baseFame(input);
    let capped = false;
    let botFameLeftToday: number | null = null;
    if (input.source === 'bot') {
      const left = Math.max(0, ECONOMY.fame.dailyBotFameCap - daily.botFame);
      if (base > left) {
        base = left;
        capped = true;
      }
      botFameLeftToday = left - base;
    }
    const isWin = input.outcome === 'win';
    const openingNight = isWin && !daily.firstWinDone && base > 0;
    const streak = input.source === 'online' ? (input.winStreak ?? 0) : 0;
    const hotStreak = isWin && input.source === 'online' ? hotStreakMultiplier(streak) : 1;
    // Amp Boost (db/boosts.ts): a Fame-paying win spends one charge and adds a flat share of BASE
    // Fame on top of Opening Night / Hot Streak (added, not multiplied, so it is never wasted and
    // never compounds). The daily bot cap above already limited `base`, so it still holds.
    const amp = isWin && base > 0 ? await spendAmpCharge(tx, userId, now) : null;
    const gained = Math.round(base * ((openingNight ? ECONOMY.fame.openingNight : 1) * hotStreak + (amp?.bonus ?? 0)));

    await tx
      .update(dailyProgress)
      .set({
        botFame: input.source === 'bot' ? daily.botFame + base : daily.botFame,
        firstWinDone: daily.firstWinDone || isWin,
      })
      .where(and(eq(dailyProgress.userId, userId), eq(dailyProgress.dayStart, dayStart)));

    // ---- XP / level ----
    const xpBefore = profile.xp;
    const xpAfter = xpBefore + gained;
    const levelBefore = profile.level;
    const levelAfter = Math.max(levelBefore, levelForXp(xpAfter));

    // ---- level rewards (exactly once per level) ----
    const byLevel: { level: number; chips: number; gems: number }[] = [];
    for (let level = levelBefore + 1; level <= levelAfter; level++) {
      const reward = LEVEL_REWARDS[level];
      if (!reward) continue;
      const inserted = await tx
        .insert(levelRewardsGranted)
        .values({ userId, level, chips: reward.chips, gems: reward.gems })
        .onConflictDoNothing()
        .returning({ level: levelRewardsGranted.level });
      if (inserted.length > 0) byLevel.push({ level, chips: reward.chips, gems: reward.gems });
    }
    const chips = byLevel.reduce((s, r) => s + r.chips, 0);
    const gems = byLevel.reduce((s, r) => s + r.gems, 0);

    // ---- titles: every title the new level qualifies for (also backfills players
    // who were already past a threshold when titles shipped) ----
    const newTitles: TitleInfo[] = [];
    for (const title of TITLES) {
      if (title.minLevel > levelAfter) continue;
      const inserted = await tx
        .insert(userTitles)
        .values({ userId, titleId: title.id })
        .onConflictDoNothing()
        .returning({ titleId: userTitles.titleId });
      if (inserted.length > 0) newTitles.push(title);
    }
    const highest = newTitles.length ? newTitles[newTitles.length - 1] : null;
    // A newly earned level title is worn when a level was actually gained (or nothing is
    // worn yet). A first-grant BACKFILL of old titles must not displace what the player
    // already wears -- e.g. a chapter title the Tour just gave them in the same match.
    const equippedTitleId = highest && (levelAfter > levelBefore || !profile.equippedTitleId) ? highest.id : profile.equippedTitleId;

    const [updated] = await tx
      .update(playerProfiles)
      .set({
        xp: xpAfter,
        level: levelAfter,
        equippedTitleId,
        chips: chips > 0 ? sql`${playerProfiles.chips} + ${chips}` : playerProfiles.chips,
        gems: gems > 0 ? sql`${playerProfiles.gems} + ${gems}` : playerProfiles.gems,
        updatedAt: now,
      })
      .where(eq(playerProfiles.userId, userId))
      .returning({ xp: playerProfiles.xp });

    const equipped = titleById(equippedTitleId);
    const summary: Omit<ProgressionSummary, 'eventId'> = {
      source: input.source,
      matchId: input.matchId ?? null,
      outcome: input.outcome,
      fame: {
        base,
        gained,
        openingNight,
        hotStreak,
        streak,
        capped,
        botFameLeftToday,
        ampBonus: amp?.bonus ?? 0,
        ampWinsLeft: amp?.chargesLeft ?? 0,
        luckyPickSaved: input.luckyPickSaved ?? 0,
      },
      xpBefore,
      xpAfter: updated.xp,
      levelBefore,
      levelAfter,
      levelProgress: (({ xpIntoLevel, xpForNextLevel, progress }) => ({ xpIntoLevel, xpForNextLevel, progress }))(
        getLevelProgress(updated.xp),
      ),
      rewards: { chips, gems, byLevel },
      titlesUnlocked: newTitles.map((t) => ({ id: t.id, name: t.name })),
      equippedTitle: equipped ? { id: equipped.id, name: equipped.name } : null,
      rating: input.rating
        ? {
            before: input.rating.before,
            after: input.rating.after,
            delta: input.rating.after - input.rating.before,
            tierBefore: ratingTier(input.rating.before),
            tierAfter: ratingTier(input.rating.after),
          }
        : null,
      goals: input.goals ?? [],
      tour: input.tour ?? null,
    };

    // A beaten boss (chapter complete) is a big moment too.
    const celebratory = levelAfter > levelBefore || newTitles.length > 0 || !!input.tour?.bossBeaten;
    const [event] = await tx
      .insert(progressionEvents)
      .values({
        userId,
        source: input.source,
        matchId: input.matchId ?? null,
        payload: summary,
        celebratory,
        // Nothing to celebrate = nothing to show later; mark seen so it never queues.
        seenAt: celebratory ? null : now,
      })
      .returning({ id: progressionEvents.id });

    return { eventId: event.id, ...summary };
  });
}

// Celebrations the player has not seen yet (missed because they were offline or
// the app was closed). Oldest first so level-ups play in order.
export async function getUnseenCelebrations(userId: string): Promise<ProgressionSummary[]> {
  const rows = await db
    .select()
    .from(progressionEvents)
    .where(and(eq(progressionEvents.userId, userId), eq(progressionEvents.celebratory, true), sql`${progressionEvents.seenAt} is null`))
    .orderBy(progressionEvents.createdAt)
    .limit(10);
  return rows.map((row) => ({ eventId: row.id, ...(row.payload as Omit<ProgressionSummary, 'eventId'>) }));
}

export async function markProgressionSeen(userId: string, eventId: string): Promise<boolean> {
  const updated = await db
    .update(progressionEvents)
    .set({ seenAt: new Date() })
    .where(and(eq(progressionEvents.id, eventId), eq(progressionEvents.userId, userId), sql`${progressionEvents.seenAt} is null`))
    .returning({ id: progressionEvents.id });
  return updated.length > 0;
}

export async function getOwnedTitleIds(userId: string): Promise<string[]> {
  const rows = await db.select({ titleId: userTitles.titleId }).from(userTitles).where(eq(userTitles.userId, userId)).orderBy(desc(userTitles.unlockedAt));
  return rows.map((r) => r.titleId);
}

// Used by queue:matched so both players see the other's real rating + title.
export async function getPublicStanding(userId: string): Promise<{ rating: number; level: number; title: string | null } | null> {
  const [row] = await db
    .select({ rating: playerProfiles.rating, level: playerProfiles.level, equippedTitleId: playerProfiles.equippedTitleId })
    .from(playerProfiles)
    .where(eq(playerProfiles.userId, userId))
    .limit(1);
  if (!row) return null;
  return { rating: row.rating, level: row.level, title: titleById(row.equippedTitleId)?.name ?? null };
}

export type { Tx };
