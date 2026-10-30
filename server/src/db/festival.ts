import { and, eq, isNotNull, lt, ne, sql } from 'drizzle-orm';

import { bankedPurse, dailyRunsFor, entryFee, FESTIVAL_SET_CLOCK_MS, FESTIVAL_TIERS, tierById, type FestivalTier } from '../festival.js';
import { botById, CHAPTERS } from '../tour.js';
import { db } from './client.js';
import { festivalClears, festivalRuns, playerProfiles, tourProgress, userTitles } from './schema/index.js';

// Festival Run, persisted. The same three guarantees as wagers.ts:
//   1. The ENTRY is debited atomically (conditional `chips >= fee`) in the transaction that
//      inserts the run, or neither happens.
//   2. Every payout is behind a conditional status flip out of 'active' (row locked FOR
//      UPDATE), so a retried set result, a double cash-out or a sweeper race pays once.
//   3. Chips are never created: the purse is the only payout, and every server-side fault
//      ends in a cash-out of what was already banked or a refund of the entry.
// Nothing outside this file moves chips for a Festival run.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type RunStatus = 'active' | 'cashed' | 'won' | 'lost' | 'refunded';

export interface RunSetView {
  botId: string;
  name: string;
  emoji: string;
  difficulty: string;
  state: 'done' | 'current' | 'next';
}

export interface RunView {
  id: string;
  tierId: string;
  status: RunStatus;
  phase: 'ready' | 'playing';
  entryPaid: number;
  setIndex: number;
  setsCleared: number;
  totalSets: number;
  replaysUsed: number;
  purse: number[];
  banked: number; // what cashing out right now would pay
  nextPurse: number | null; // what clearing the next set would bank
  canCashOut: boolean;
  sets: RunSetView[];
  payout: number | null;
  // The live set's match id while phase is 'playing' (so the app can rejoin it).
  matchId: string | null;
}

type RunRow = typeof festivalRuns.$inferSelect;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

function toView(run: RunRow): RunView {
  const tier = tierById(run.tierId) as FestivalTier;
  const banked = bankedPurse(tier, run.setsCleared);
  const active = run.status === 'active';
  return {
    id: run.id,
    tierId: run.tierId,
    status: run.status as RunStatus,
    phase: run.phase as 'ready' | 'playing',
    entryPaid: run.entryPaid,
    setIndex: run.setIndex,
    setsCleared: run.setsCleared,
    totalSets: tier.sets.length,
    replaysUsed: run.replaysUsed,
    purse: tier.purse,
    banked,
    nextPurse: run.setsCleared < tier.sets.length ? tier.purse[run.setsCleared] : null,
    canCashOut: active && run.phase === 'ready' && run.setsCleared >= 1,
    sets: tier.sets.map((botId, i) => {
      const bot = botById(botId);
      return {
        botId,
        name: bot?.name ?? botId,
        emoji: bot?.emoji ?? '',
        difficulty: bot?.difficulty ?? 'easy',
        state: i < run.setsCleared ? 'done' : i === run.setIndex && active ? 'current' : 'next',
      };
    }),
    payout: run.payout,
    matchId: run.phase === 'playing' ? run.currentMatchId : null,
  };
}

async function addChips(tx: Tx, userId: string, amount: number): Promise<number> {
  const [row] = await tx
    .update(playerProfiles)
    .set({ chips: sql`${playerProfiles.chips} + ${amount}`, updatedAt: new Date() })
    .where(eq(playerProfiles.userId, userId))
    .returning({ chips: playerProfiles.chips });
  return row?.chips ?? 0;
}

async function isUnlocked(tx: Tx, userId: string, tier: FestivalTier): Promise<boolean> {
  const [row] = await tx
    .select({ completedAt: tourProgress.completedAt })
    .from(tourProgress)
    .where(and(eq(tourProgress.userId, userId), eq(tourProgress.gigId, `boss-${tier.unlockChapter}`)))
    .limit(1);
  return !!row?.completedAt;
}

async function runsToday(tx: Tx, userId: string, tierId: string, now: Date): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(festivalRuns)
    .where(and(eq(festivalRuns.userId, userId), eq(festivalRuns.tierId, tierId), eq(festivalRuns.utcDay, dayKey(now)), ne(festivalRuns.status, 'refunded')));
  return row?.n ?? 0;
}

// ---- read model -------------------------------------------------------------------------

export interface TierView {
  id: string;
  name: string;
  tagline: string;
  entry: number; // base entry
  nextEntry: number; // what the next run costs today (repeat surcharge included)
  purse: number[];
  sets: { botId: string; name: string; emoji: string; difficulty: string }[];
  unlocked: boolean;
  unlockChapterId: string;
  unlockChapterName: string;
  runsToday: number;
  dailyRuns: number;
  cleared: boolean;
  titleName: string;
}

export async function getFestival(userId: string, now = new Date()): Promise<{ tiers: TierView[]; activeRun: RunView | null }> {
  const [done, clears, today, active] = await Promise.all([
    db.select({ gigId: tourProgress.gigId }).from(tourProgress).where(and(eq(tourProgress.userId, userId), isNotNull(tourProgress.completedAt))),
    db.select({ tierId: festivalClears.tierId }).from(festivalClears).where(eq(festivalClears.userId, userId)),
    db
      .select({ tierId: festivalRuns.tierId, n: sql<number>`count(*)::int` })
      .from(festivalRuns)
      .where(and(eq(festivalRuns.userId, userId), eq(festivalRuns.utcDay, dayKey(now)), ne(festivalRuns.status, 'refunded')))
      .groupBy(festivalRuns.tierId),
    db.select().from(festivalRuns).where(and(eq(festivalRuns.userId, userId), eq(festivalRuns.status, 'active'))).limit(1),
  ]);
  const doneIds = new Set(done.map((r) => r.gigId));
  const clearedIds = new Set(clears.map((r) => r.tierId));
  const todayBy = new Map(today.map((r) => [r.tierId, r.n]));
  const tiers = FESTIVAL_TIERS.map((tier): TierView => {
    const n = todayBy.get(tier.id) ?? 0;
    const chapter = CHAPTERS.find((c) => c.id === tier.unlockChapter);
    return {
      id: tier.id,
      name: tier.name,
      tagline: tier.tagline,
      entry: tier.entry,
      nextEntry: entryFee(tier, n),
      purse: tier.purse,
      sets: tier.sets.map((botId) => {
        const bot = botById(botId);
        return { botId, name: bot?.name ?? botId, emoji: bot?.emoji ?? '', difficulty: bot?.difficulty ?? 'easy' };
      }),
      unlocked: doneIds.has(`boss-${tier.unlockChapter}`),
      unlockChapterId: tier.unlockChapter,
      unlockChapterName: chapter?.name ?? tier.unlockChapter,
      runsToday: n,
      dailyRuns: dailyRunsFor(tier),
      cleared: clearedIds.has(tier.id),
      titleName: tier.title.name,
    };
  });
  return { tiers, activeRun: active[0] ? toView(active[0]) : null };
}

// ---- entering ---------------------------------------------------------------------------

export type StartResult =
  | { status: 'ok'; run: RunView; chips: number; fee: number }
  | { status: 'unknown-tier' }
  | { status: 'profile-not-found' }
  | { status: 'locked'; chapterName: string }
  | { status: 'daily-limit'; limit: number }
  | { status: 'already-active'; run: RunView }
  | { status: 'insufficient-chips'; required: number; chips: number };

export async function startRun(userId: string, tierId: unknown, now = new Date()): Promise<StartResult> {
  const tier = tierById(tierId);
  if (!tier) return { status: 'unknown-tier' };
  return db.transaction(async (tx): Promise<StartResult> => {
    // Locking the profile row serialises this player's concurrent "enter" taps.
    const [profile] = await tx.select({ chips: playerProfiles.chips }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).for('update');
    if (!profile) return { status: 'profile-not-found' };

    const [active] = await tx.select().from(festivalRuns).where(and(eq(festivalRuns.userId, userId), eq(festivalRuns.status, 'active'))).limit(1);
    if (active) return { status: 'already-active', run: toView(active) };

    if (!(await isUnlocked(tx, userId, tier))) {
      return { status: 'locked', chapterName: CHAPTERS.find((c) => c.id === tier.unlockChapter)?.name ?? tier.unlockChapter };
    }
    const n = await runsToday(tx, userId, tier.id, now);
    if (n >= dailyRunsFor(tier)) return { status: 'daily-limit', limit: dailyRunsFor(tier) };

    const fee = entryFee(tier, n);
    const [debited] = await tx
      .update(playerProfiles)
      .set({ chips: sql`${playerProfiles.chips} - ${fee}`, updatedAt: now })
      .where(and(eq(playerProfiles.userId, userId), sql`${playerProfiles.chips} >= ${fee}`))
      .returning({ chips: playerProfiles.chips });
    if (!debited) return { status: 'insufficient-chips', required: fee, chips: profile.chips };

    const [run] = await tx.insert(festivalRuns).values({ userId, tierId: tier.id, entryPaid: fee, utcDay: dayKey(now) }).returning();
    return { status: 'ok', run: toView(run), chips: debited.chips, fee };
  });
}

// ---- playing sets -----------------------------------------------------------------------

/** Claims the next set for a live match: ready -> playing, atomically. Null = not allowed. */
export async function beginSet(userId: string, runId: string, matchId: string, now = new Date()): Promise<RunRow | null> {
  const [row] = await db
    .update(festivalRuns)
    .set({ phase: 'playing', currentMatchId: matchId, updatedAt: now })
    .where(and(eq(festivalRuns.id, runId), eq(festivalRuns.userId, userId), eq(festivalRuns.status, 'active'), eq(festivalRuns.phase, 'ready')))
    .returning();
  return row ?? null;
}

/** The match could not be created after beginSet: put the run back so the set can be started again. */
export async function revertSet(runId: string, matchId: string): Promise<void> {
  await db
    .update(festivalRuns)
    .set({ phase: 'ready', currentMatchId: null, updatedAt: new Date() })
    .where(and(eq(festivalRuns.id, runId), eq(festivalRuns.currentMatchId, matchId), eq(festivalRuns.status, 'active')));
}

export type SetKind = 'advance' | 'replay' | 'cleared' | 'lost';

export interface SetSettlement {
  kind: SetKind;
  userId: string;
  run: RunView;
  payout: number; // paid right now (0 unless the run was just cleared)
  chips: number | null; // balance after, when chips moved
  titleUnlocked: { id: string; name: string } | null;
}

/** Applies a finished set to its run. Null when there is nothing to do (already settled / not this set). */
export async function settleSet(runId: string, matchId: string, outcome: 'win' | 'loss' | 'draw', now = new Date()): Promise<SetSettlement | null> {
  return db.transaction(async (tx): Promise<SetSettlement | null> => {
    const [run] = await tx.select().from(festivalRuns).where(eq(festivalRuns.id, runId)).for('update');
    if (!run || run.status !== 'active' || run.phase !== 'playing' || run.currentMatchId !== matchId) return null;
    const tier = tierById(run.tierId) as FestivalTier;

    let effective = outcome;
    if (outcome === 'draw' && run.replaysUsed >= 1) effective = 'loss'; // a second draw ends the run

    const base = { currentMatchId: null, phase: 'ready', updatedAt: now };
    if (effective === 'draw') {
      const [next] = await tx.update(festivalRuns).set({ ...base, replaysUsed: run.replaysUsed + 1 }).where(eq(festivalRuns.id, runId)).returning();
      return { kind: 'replay', userId: run.userId, run: toView(next), payout: 0, chips: null, titleUnlocked: null };
    }
    if (effective === 'loss') {
      const [next] = await tx.update(festivalRuns).set({ ...base, status: 'lost', payout: 0, finishedAt: now }).where(eq(festivalRuns.id, runId)).returning();
      return { kind: 'lost', userId: run.userId, run: toView(next), payout: 0, chips: null, titleUnlocked: null };
    }

    const cleared = run.setsCleared + 1;
    if (cleared < tier.sets.length) {
      const [next] = await tx.update(festivalRuns).set({ ...base, setsCleared: cleared, setIndex: run.setIndex + 1 }).where(eq(festivalRuns.id, runId)).returning();
      return { kind: 'advance', userId: run.userId, run: toView(next), payout: 0, chips: null, titleUnlocked: null };
    }

    // Final set: the full purse, once.
    const payout = bankedPurse(tier, cleared);
    const [next] = await tx
      .update(festivalRuns)
      .set({ ...base, status: 'won', setsCleared: cleared, payout, finishedAt: now })
      .where(eq(festivalRuns.id, runId))
      .returning();
    const chips = await addChips(tx, run.userId, payout);
    let titleUnlocked: SetSettlement['titleUnlocked'] = null;
    const [firstClear] = await tx.insert(festivalClears).values({ userId: run.userId, tierId: tier.id }).onConflictDoNothing().returning({ tierId: festivalClears.tierId });
    if (firstClear) {
      await tx.insert(userTitles).values({ userId: run.userId, titleId: tier.title.id }).onConflictDoNothing();
      // A title is a trophy: wear it straight away.
      await tx.update(playerProfiles).set({ equippedTitleId: tier.title.id }).where(eq(playerProfiles.userId, run.userId));
      titleUnlocked = tier.title;
    }
    return { kind: 'cleared', userId: run.userId, run: toView(next), payout, chips, titleUnlocked };
  });
}

// ---- banking ----------------------------------------------------------------------------

export type CashOutResult =
  | { status: 'ok'; run: RunView; payout: number; chips: number }
  | { status: 'not-found' }
  | { status: 'not-allowed'; reason: 'no-sets-cleared' | 'set-in-progress' | 'finished' };

export async function cashOut(userId: string, runId: string, now = new Date()): Promise<CashOutResult> {
  return db.transaction(async (tx): Promise<CashOutResult> => {
    const [run] = await tx.select().from(festivalRuns).where(and(eq(festivalRuns.id, runId), eq(festivalRuns.userId, userId))).for('update');
    if (!run) return { status: 'not-found' };
    if (run.status !== 'active') return { status: 'not-allowed', reason: 'finished' };
    if (run.phase !== 'ready') return { status: 'not-allowed', reason: 'set-in-progress' };
    if (run.setsCleared < 1) return { status: 'not-allowed', reason: 'no-sets-cleared' };
    const tier = tierById(run.tierId) as FestivalTier;
    const payout = bankedPurse(tier, run.setsCleared);
    const [next] = await tx.update(festivalRuns).set({ status: 'cashed', payout, finishedAt: now, updatedAt: now }).where(eq(festivalRuns.id, runId)).returning();
    const chips = await addChips(tx, userId, payout);
    return { status: 'ok', run: toView(next), payout, chips };
  });
}

// ---- server faults ----------------------------------------------------------------------

export interface Resolved {
  runId: string;
  userId: string;
  how: 'cashed' | 'refunded';
  payout: number;
  chips: number;
  run: RunView;
}

// A run the SERVER interrupted (restart, crash, abandoned in the stale sweep): the player
// keeps what they already banked -- or gets the entry back if they had cleared nothing --
// and only the set that was in flight is lost to the interruption.
export async function resolveInterrupted(runId: string, now = new Date()): Promise<Resolved | null> {
  return db.transaction(async (tx): Promise<Resolved | null> => {
    const [run] = await tx.select().from(festivalRuns).where(eq(festivalRuns.id, runId)).for('update');
    if (!run || run.status !== 'active') return null;
    const tier = tierById(run.tierId) as FestivalTier;
    const how: Resolved['how'] = run.setsCleared >= 1 ? 'cashed' : 'refunded';
    const payout = how === 'cashed' ? bankedPurse(tier, run.setsCleared) : run.entryPaid;
    const [next] = await tx
      .update(festivalRuns)
      .set({ status: how, phase: 'ready', currentMatchId: null, payout, finishedAt: now, updatedAt: now })
      .where(eq(festivalRuns.id, runId))
      .returning();
    const chips = await addChips(tx, run.userId, payout);
    return { runId, userId: run.userId, how, payout, chips, run: toView(next) };
  });
}

export type RecoverResult = { status: 'resolved'; resolved: Resolved } | { status: 'live' } | { status: 'not-found' } | { status: 'nothing-to-recover' };

// The app lost a set it cannot rejoin (the server restarted without a clean shutdown): if no
// live match is behind the run any more, resolve it now instead of making the player wait
// for the sweeper. A set that IS still live is left alone.
export async function recoverDeadSet(userId: string, runId: string, isMatchLive: (matchId: string) => boolean): Promise<RecoverResult> {
  const [run] = await db.select().from(festivalRuns).where(and(eq(festivalRuns.id, runId), eq(festivalRuns.userId, userId))).limit(1);
  if (!run) return { status: 'not-found' };
  if (run.status !== 'active' || run.phase !== 'playing') return { status: 'nothing-to-recover' };
  if (run.currentMatchId && isMatchLive(run.currentMatchId)) return { status: 'live' };
  const resolved = await resolveInterrupted(runId);
  return resolved ? { status: 'resolved', resolved } : { status: 'nothing-to-recover' };
}

const STALE_SET_MS = FESTIVAL_SET_CLOCK_MS * 2; // the longest set plus the reconnect grace, with room

// Runs nothing will ever finish: a set 'playing' with no live match behind it (a restart
// or crash wiped the in-memory match), or a run left between sets for hours.
export async function sweepStaleRuns(staleReadyMs: number, isMatchLive: (matchId: string) => boolean, now = new Date()): Promise<Resolved[]> {
  const candidates = await db
    .select({ id: festivalRuns.id, phase: festivalRuns.phase, matchId: festivalRuns.currentMatchId, updatedAt: festivalRuns.updatedAt })
    .from(festivalRuns)
    .where(and(eq(festivalRuns.status, 'active'), lt(festivalRuns.updatedAt, new Date(now.getTime() - STALE_SET_MS))));
  const out: Resolved[] = [];
  for (const c of candidates) {
    const age = now.getTime() - c.updatedAt.getTime();
    if (c.phase === 'playing') {
      if (c.matchId && isMatchLive(c.matchId)) continue;
    } else if (age < staleReadyMs) {
      continue;
    }
    const resolved = await resolveInterrupted(c.id, now);
    if (resolved) out.push(resolved);
  }
  return out;
}

