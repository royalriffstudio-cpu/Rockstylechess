import { and, eq, gte, sql } from 'drizzle-orm';

import {
  allGigs,
  BACKSTAGE,
  bossGigId,
  botById,
  CHAPTERS,
  freeKitsEarned,
  gigDelta,
  isBossOf,
  kitPrice,
  kitUnlocked,
  perfectGigId,
  PERFECT_BONUS_GEMS,
  type Chapter,
  type Gig,
  type TourMatchEvent,
} from '../tour.js';
import { db } from './client.js';
import { playerProfiles, tourBossAttempts, tourProgress, tourState, userTitles } from './schema/index.js';

// The Tour, persisted. Rewards are paid in the SAME transaction that records the
// progress, and a gig/boss/perfect row is only ever completed once (its
// `completed_at` is checked before anything is credited), so a retried or
// replayed match cannot pay twice.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface TourUpdate {
  gigsCompleted: { id: string; title: string; chapterId: string; chips: number }[];
  gigsProgressed: { id: string; title: string; before: number; after: number; target: number }[];
  bossBeaten: null | { chapterId: string; chapterName: string; chips: number; gems: number; titleId: string; titleName: string };
  perfect: null | { chapterId: string; chapterName: string; gems: number };
  chapterUnlocked: null | { id: string; name: string };
  encore: null | { progress: number; total: number };
  // A real (long enough) loss to a chapter's boss: Crowd Energy grew. See "Backstage" below.
  bossAttempt: null | {
    chapterId: string;
    chapterName: string;
    losses: number;
    toUnlock: number; // real losses still needed to open the Roadie Kit (0 = open)
    kitJustOpened: boolean;
    freeKitJustEarned: boolean;
    toNextFree: number; // real losses until the crowd's next free kit
  };
  chips: number;
  gems: number;
}

export type TourInput = { event?: TourMatchEvent; puzzle?: boolean; rating?: number };

const emptyUpdate = (): TourUpdate => ({
  gigsCompleted: [],
  gigsProgressed: [],
  bossBeaten: null,
  perfect: null,
  chapterUnlocked: null,
  encore: null,
  bossAttempt: null,
  chips: 0,
  gems: 0,
});

const isEmpty = (u: TourUpdate) =>
  u.gigsCompleted.length === 0 && u.gigsProgressed.length === 0 && !u.bossBeaten && !u.perfect && !u.encore && !u.bossAttempt;

function unlockedChapters(done: Set<string>): Chapter[] {
  const out: Chapter[] = [];
  for (let i = 0; i < CHAPTERS.length; i++) {
    if (i === 0 || done.has(bossGigId(CHAPTERS[i - 1].id))) out.push(CHAPTERS[i]);
    else break;
  }
  return out;
}

async function loadProgress(tx: Tx, userId: string) {
  const rows = await tx.select().from(tourProgress).where(eq(tourProgress.userId, userId));
  const progress = new Map(rows.map((r) => [r.gigId, r.progress]));
  const done = new Set(rows.filter((r) => r.completedAt).map((r) => r.gigId));
  return { progress, done };
}

async function save(tx: Tx, userId: string, gigId: string, progress: number, completed: boolean, now: Date) {
  await tx
    .insert(tourProgress)
    .values({ userId, gigId, progress, completedAt: completed ? now : null })
    .onConflictDoUpdate({
      target: [tourProgress.userId, tourProgress.gigId],
      set: { progress, ...(completed ? { completedAt: now } : {}) },
    });
}

// Applies one thing that happened (a verified finished match, a solved puzzle, or a
// rating check) to every gig it can move, in the chapters the player has unlocked.
// Returns what changed for the Show Report, or null if nothing did.
export async function applyTour(userId: string, input: TourInput, now = new Date()): Promise<TourUpdate | null> {
  return db.transaction(async (tx) => {
    // Serialise a player's Tour writes (two matches finishing together must not both
    // read "not complete" and both pay).
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tour:${userId}`}))`);
    const { progress, done } = await loadProgress(tx, userId);
    const update = emptyUpdate();
    const unlockedBefore = unlockedChapters(done);

    // ---- gigs ----
    for (const chapter of unlockedBefore) {
      for (const gig of chapter.gigs) {
        if (done.has(gig.id)) continue;
        const before = progress.get(gig.id) ?? 0;
        let next = before;
        // A Roadie Kit game is a boss fight only: it never advances a gig.
        if (input.event && !input.event.assisted) {
          const delta = gigDelta(gig, input.event);
          if (delta && 'add' in delta) next = before + delta.add;
          else if (delta && 'max' in delta) next = Math.max(before, delta.max);
        }
        if (input.puzzle && gig.kind === 'puzzles') next = before + 1;
        if (input.rating !== undefined && gig.kind === 'rating') next = Math.max(before, input.rating);
        next = Math.min(next, gig.target);
        if (next === before) continue;

        const completed = next >= gig.target;
        await save(tx, userId, gig.id, next, completed, now);
        progress.set(gig.id, next);
        if (completed) {
          done.add(gig.id);
          update.chips += gig.chips;
          update.gigsCompleted.push({ id: gig.id, title: gig.title, chapterId: chapter.id, chips: gig.chips });
        } else {
          update.gigsProgressed.push({ id: gig.id, title: gig.title, before, after: next, target: gig.target });
        }
      }
    }

    // ---- bosses / the Encore ----
    const e = input.event;
    for (const chapter of unlockedBefore) {
      const bossId = bossGigId(chapter.id);
      if (done.has(bossId) || !e || e.source !== 'bot' || !e.botId) continue;
      // A real loss to this chapter's boss feeds Crowd Energy (an early resign does not).
      if (e.outcome === 'loss' && isBossOf(chapter, e.botId) && (e.plies ?? 0) >= BACKSTAGE.minAttemptPlies) {
        update.bossAttempt = await recordBossLoss(tx, userId, chapter, now);
      }
      let beaten = false;
      if (chapter.encore) {
        const [state] = await tx.select().from(tourState).where(eq(tourState.userId, userId)).for('update');
        const current = state?.encoreProgress ?? 0;
        let nextEncore = current;
        if (e.outcome === 'loss' && chapter.encore.includes(e.botId)) nextEncore = 0; // any boss loss resets the gauntlet
        else if (e.outcome === 'win' && chapter.encore[current] === e.botId) nextEncore = current + 1;
        if (nextEncore !== current) {
          await tx
            .insert(tourState)
            .values({ userId, encoreProgress: nextEncore })
            .onConflictDoUpdate({ target: tourState.userId, set: { encoreProgress: nextEncore } });
        }
        if (nextEncore !== current || (state === undefined && nextEncore > 0)) {
          update.encore = { progress: nextEncore, total: chapter.encore.length };
        }
        beaten = nextEncore >= chapter.encore.length;
      } else {
        beaten = e.outcome === 'win' && e.botId === chapter.bossBotId;
      }
      if (!beaten) continue;

      await save(tx, userId, bossId, 1, true, now);
      done.add(bossId);
      update.chips += chapter.bossReward.chips;
      update.gems += chapter.bossReward.gems;
      await tx.insert(userTitles).values({ userId, titleId: chapter.title.id }).onConflictDoNothing();
      update.bossBeaten = {
        chapterId: chapter.id,
        chapterName: chapter.name,
        chips: chapter.bossReward.chips,
        gems: chapter.bossReward.gems,
        titleId: chapter.title.id,
        titleName: chapter.title.name,
      };
      const index = CHAPTERS.findIndex((c) => c.id === chapter.id);
      const next = CHAPTERS[index + 1];
      if (next) update.chapterUnlocked = { id: next.id, name: next.name };
    }

    // ---- perfect-chapter bonus (every gig done) ----
    for (const chapter of CHAPTERS) {
      const perfectId = perfectGigId(chapter.id);
      if (done.has(perfectId) || !chapter.gigs.every((g) => done.has(g.id))) continue;
      await save(tx, userId, perfectId, 1, true, now);
      done.add(perfectId);
      update.gems += PERFECT_BONUS_GEMS;
      update.perfect = { chapterId: chapter.id, chapterName: chapter.name, gems: PERFECT_BONUS_GEMS };
    }

    if (isEmpty(update)) return null;

    await tx
      .update(playerProfiles)
      .set({
        chips: update.chips > 0 ? sql`${playerProfiles.chips} + ${update.chips}` : playerProfiles.chips,
        gems: update.gems > 0 ? sql`${playerProfiles.gems} + ${update.gems}` : playerProfiles.gems,
        // A chapter title is a trophy: wear it straight away.
        ...(update.bossBeaten ? { equippedTitleId: update.bossBeaten.titleId } : {}),
        updatedAt: now,
      })
      .where(eq(playerProfiles.userId, userId));
    return update;
  });
}

// ---- Backstage: Crowd Energy and the Roadie Kit --------------------------------
// A player stuck on a boss is helped, not rescued. Every REAL loss to the boss (past
// backstage.minAttemptPlies, so resigning early earns nothing) grows Crowd Energy. After
// `kitUnlockLosses` the Roadie Kit can be bought, and every `crowdFreeEvery` losses the crowd
// hands one over free, so a broke-but-persistent player is never locked out. The kit is
// Take Two + Roadie's Tip for ONE boss game: it can still beat the boss (the win must be
// played and is verified like any other), advances no gigs, and can't be bought once the
// boss is beaten. The price is the chip sink.

async function recordBossLoss(tx: Tx, userId: string, chapter: Chapter, now: Date): Promise<NonNullable<TourUpdate['bossAttempt']>> {
  const [row] = await tx
    .insert(tourBossAttempts)
    .values({ userId, chapterId: chapter.id, losses: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [tourBossAttempts.userId, tourBossAttempts.chapterId],
      set: { losses: sql`${tourBossAttempts.losses} + 1`, updatedAt: now },
    })
    .returning({ losses: tourBossAttempts.losses });
  const losses = row.losses;
  return {
    chapterId: chapter.id,
    chapterName: chapter.name,
    losses,
    toUnlock: Math.max(0, BACKSTAGE.kitUnlockLosses - losses),
    kitJustOpened: losses === BACKSTAGE.kitUnlockLosses,
    freeKitJustEarned: losses % BACKSTAGE.crowdFreeEvery === 0,
    toNextFree: BACKSTAGE.crowdFreeEvery - (losses % BACKSTAGE.crowdFreeEvery),
  };
}

export type KitClaim =
  | { ok: true; paid: number; chapterId: string; chips: number | null }
  | { ok: false; reason: 'not-a-boss' | 'kit-locked' | 'insufficient-chips' };

// Buys (or takes the free) Roadie Kit for a boss fight against `botId`. Runs INSIDE the
// caller's transaction (db/botSessions.ts), so the chips leave in the very transaction that
// creates the session: either you have a kit session or you still have your chips.
export async function claimBossKit(tx: Tx, userId: string, botId: string, now = new Date()): Promise<KitClaim> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`tour:${userId}`}))`);
  const { done } = await loadProgress(tx, userId);
  const chapter = unlockedChapters(done).find((c) => !done.has(bossGigId(c.id)) && isBossOf(c, botId));
  if (!chapter) return { ok: false, reason: 'not-a-boss' };

  const [attempts] = await tx
    .select()
    .from(tourBossAttempts)
    .where(and(eq(tourBossAttempts.userId, userId), eq(tourBossAttempts.chapterId, chapter.id)))
    .for('update');
  const losses = attempts?.losses ?? 0;
  if (!kitUnlocked(losses)) return { ok: false, reason: 'kit-locked' };

  if (freeKitsEarned(losses) > (attempts?.freeKitsUsed ?? 0)) {
    await tx
      .update(tourBossAttempts)
      .set({ freeKitsUsed: sql`${tourBossAttempts.freeKitsUsed} + 1`, updatedAt: now })
      .where(and(eq(tourBossAttempts.userId, userId), eq(tourBossAttempts.chapterId, chapter.id)));
    return { ok: true, paid: 0, chapterId: chapter.id, chips: null };
  }

  const price = kitPrice(chapter);
  const [paid] = await tx
    .update(playerProfiles)
    .set({ chips: sql`${playerProfiles.chips} - ${price}`, updatedAt: now })
    .where(and(eq(playerProfiles.userId, userId), gte(playerProfiles.chips, price)))
    .returning({ chips: playerProfiles.chips });
  if (!paid) return { ok: false, reason: 'insufficient-chips' };
  return { ok: true, paid: price, chapterId: chapter.id, chips: paid.chips };
}

// A kit game that could not be verified (too short, never finished properly) is refunded --
// nothing was won or lost, so the kit goes back in the case. Called once per session (the
// session is claimed atomically before it gets here).
export async function refundBossKit(userId: string, chapterId: string, kitPaid: number, now = new Date()): Promise<void> {
  await db.transaction(async (tx) => {
    if (kitPaid > 0) {
      await tx
        .update(playerProfiles)
        .set({ chips: sql`${playerProfiles.chips} + ${kitPaid}`, updatedAt: now })
        .where(eq(playerProfiles.userId, userId));
    } else {
      await tx
        .update(tourBossAttempts)
        .set({ freeKitsUsed: sql`greatest(${tourBossAttempts.freeKitsUsed} - 1, 0)`, updatedAt: now })
        .where(and(eq(tourBossAttempts.userId, userId), eq(tourBossAttempts.chapterId, chapterId)));
    }
  });
}

// ---- read model for the Tour screen ----------------------------------------

export interface TourGigView {
  id: string;
  title: string;
  description: string;
  kind: string;
  target: number;
  progress: number;
  completed: boolean;
  chips: number;
}

export interface TourChapterView {
  id: string;
  name: string;
  venue: string;
  tagline: string;
  unlocked: boolean;
  bossBeaten: boolean;
  perfect: boolean;
  gigsDone: number;
  boss: null | { botId: string; name: string; emoji: string; difficulty: string };
  encore: null | { progress: number; bots: { id: string; name: string; emoji: string }[] };
  reward: { chips: number; gems: number; titleName: string };
  // Crowd Energy + the Roadie Kit; null when there is no boss to be stuck on (locked / beaten).
  backstage: null | {
    losses: number;
    kitUnlockLosses: number;
    kitOpen: boolean;
    toNextFree: number;
    crowdFreeEvery: number;
    freeKit: boolean; // a free kit is waiting
    price: number; // chips, when no free kit is waiting
    kit: { takeTwos: number; tips: number };
  };
  gigs: TourGigView[];
}

function backstageView(chapter: Chapter, fightable: boolean, attempts?: { losses: number; freeKitsUsed: number }): TourChapterView['backstage'] {
  if (!fightable) return null;
  const losses = attempts?.losses ?? 0;
  return {
    losses,
    kitUnlockLosses: BACKSTAGE.kitUnlockLosses,
    kitOpen: kitUnlocked(losses),
    toNextFree: BACKSTAGE.crowdFreeEvery - (losses % BACKSTAGE.crowdFreeEvery),
    crowdFreeEvery: BACKSTAGE.crowdFreeEvery,
    freeKit: freeKitsEarned(losses) > (attempts?.freeKitsUsed ?? 0),
    price: kitPrice(chapter),
    kit: { takeTwos: BACKSTAGE.kit.takeTwos, tips: BACKSTAGE.kit.tips },
  };
}

export async function getTour(userId: string): Promise<{ chapters: TourChapterView[]; gigsDone: number; gigsTotal: number }> {
  // A rating gig can be earned retroactively by the rating you already have.
  const [profile] = await db.select({ rating: playerProfiles.rating }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  if (profile) await applyTour(userId, { rating: profile.rating });

  const { progress, done } = await db.transaction((tx) => loadProgress(tx, userId));
  const [state] = await db.select().from(tourState).where(eq(tourState.userId, userId)).limit(1);
  const attemptRows = await db.select().from(tourBossAttempts).where(eq(tourBossAttempts.userId, userId));
  const attemptsByChapter = new Map(attemptRows.map((r) => [r.chapterId, r]));
  const unlocked = new Set(unlockedChapters(done).map((c) => c.id));
  const gigView = (gig: Gig): TourGigView => ({
    id: gig.id,
    title: gig.title,
    description: gig.description,
    kind: gig.kind,
    target: gig.target,
    progress: Math.min(progress.get(gig.id) ?? 0, gig.target),
    completed: done.has(gig.id),
    chips: gig.chips,
  });

  const chapters: TourChapterView[] = CHAPTERS.map((chapter) => {
    const boss = chapter.bossBotId ? botById(chapter.bossBotId) : undefined;
    return {
      id: chapter.id,
      name: chapter.name,
      venue: chapter.venue,
      tagline: chapter.tagline,
      unlocked: unlocked.has(chapter.id),
      bossBeaten: done.has(bossGigId(chapter.id)),
      perfect: done.has(perfectGigId(chapter.id)),
      gigsDone: chapter.gigs.filter((g) => done.has(g.id)).length,
      boss: boss ? { botId: boss.id, name: boss.name, emoji: boss.emoji, difficulty: boss.difficulty } : null,
      encore: chapter.encore
        ? {
            progress: done.has(bossGigId(chapter.id)) ? chapter.encore.length : (state?.encoreProgress ?? 0),
            bots: chapter.encore.map((id) => ({ id, name: botById(id)?.name ?? id, emoji: botById(id)?.emoji ?? '' })),
          }
        : null,
      reward: { chips: chapter.bossReward.chips, gems: chapter.bossReward.gems, titleName: chapter.title.name },
      backstage: backstageView(chapter, unlocked.has(chapter.id) && !done.has(bossGigId(chapter.id)), attemptsByChapter.get(chapter.id)),
      gigs: chapter.gigs.map(gigView),
    };
  });
  return {
    chapters,
    gigsDone: chapters.reduce((s, c) => s + c.gigsDone, 0),
    gigsTotal: allGigs().length,
  };
}

export type { TourMatchEvent };
