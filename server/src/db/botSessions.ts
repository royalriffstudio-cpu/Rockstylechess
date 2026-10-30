import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { botChipReward } from '../matchRewards.js';
import { analyzeGame, type GameFacts } from '../matchAnalysis.js';
import { BACKSTAGE, BOT_RANK, botById, MIN_BOT_PLIES, type BotDifficulty, type TourMatchEvent } from '../tour.js';
import { reportMatchForAchievements } from './achievements.js';
import { db } from './client.js';
import { diffGoals, grantFame, type ProgressionSummary } from './progression.js';
import { getQuestsStatus, reportMatchForQuests } from './quests.js';
import { botSessions, playerProfiles } from './schema/index.js';
import { applyTour, claimBossKit, refundBossKit } from './tour.js';

// Verified bot matches. A bot game is played entirely on the device, so "the app
// says I won" is worthless as proof. The server therefore
//   1. issues the match first (which bot, which colour, when it started),
//   2. on finish, replays the submitted PGN with chess.js (any illegal move rejects
//      it) and reads the result from the position itself -- a win can only be a
//      real checkmate in a legal game,
//   3. refuses games that are implausibly short or fast, and
//   4. lets each session pay out exactly once.
// It cannot prove the opponent was really the engine, so bot rewards stay modest
// (see economy.config.json) and rating/wagers stay online-only.

const MAX_OPEN_SESSIONS = 5;
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;
// A plausible game: a few seconds of setup plus a fraction of a second per ply.
const MIN_MS_BASE = 3_000;
const MIN_MS_PER_PLY = 300;

export type StartResult =
  | { status: 'ok'; sessionId: string; kit: null | { takeTwos: number; tips: number; paid: number; chips: number | null } }
  | { status: 'unknown-bot' }
  | { status: 'invalid-color' }
  | { status: 'profile-not-found' }
  | { status: 'not-a-boss' | 'kit-locked' | 'insufficient-chips' };

// An abandoned or evicted session that carried a Roadie Kit gives the kit back (delete is the
// idempotency guard: only whoever actually removed the row refunds it).
async function dropSession(userId: string, session: { id: string; kitPaid: number | null; kitChapterId: string | null }) {
  const [gone] = await db.delete(botSessions).where(and(eq(botSessions.id, session.id), isNull(botSessions.finishedAt))).returning({ id: botSessions.id });
  if (gone && session.kitPaid !== null && session.kitChapterId) await refundBossKit(userId, session.kitChapterId, session.kitPaid);
}

// `kit` = also buy the Roadie Kit for a boss fight (db/tour.ts claimBossKit): the chips leave in
// the SAME transaction that creates the session.
export async function startBotSession(userId: string, botId: unknown, color: unknown, kit: unknown = false): Promise<StartResult> {
  const bot = botById(botId);
  if (!bot) return { status: 'unknown-bot' };
  if (color !== 'w' && color !== 'b') return { status: 'invalid-color' };

  const [profile] = await db.select({ userId: playerProfiles.userId }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  if (!profile) return { status: 'profile-not-found' };

  // Housekeeping: abandoned sessions expire, and a player cannot hoard open ones.
  const stale = await db
    .select({ id: botSessions.id, kitPaid: botSessions.kitPaid, kitChapterId: botSessions.kitChapterId })
    .from(botSessions)
    .where(and(eq(botSessions.userId, userId), isNull(botSessions.finishedAt), lt(botSessions.startedAt, new Date(Date.now() - SESSION_TTL_MS))));
  for (const old of stale) await dropSession(userId, old);
  const open = await db
    .select({ id: botSessions.id, kitPaid: botSessions.kitPaid, kitChapterId: botSessions.kitChapterId })
    .from(botSessions)
    .where(and(eq(botSessions.userId, userId), isNull(botSessions.finishedAt)))
    .orderBy(botSessions.startedAt);
  if (open.length >= MAX_OPEN_SESSIONS) {
    // Drop the oldest rather than refuse: an app that was killed mid-game leaves one behind.
    // (A kit session, if it is the one evicted, is refunded.)
    await dropSession(userId, open[0]);
  }

  if (kit !== true) {
    const [row] = await db.insert(botSessions).values({ userId, botId: bot.id, difficulty: bot.difficulty, color }).returning({ id: botSessions.id });
    return { status: 'ok', sessionId: row.id, kit: null };
  }

  return db.transaction(async (tx): Promise<StartResult> => {
    const claim = await claimBossKit(tx, userId, bot.id);
    if (!claim.ok) return { status: claim.reason };
    const [row] = await tx
      .insert(botSessions)
      .values({ userId, botId: bot.id, difficulty: bot.difficulty, color, kitPaid: claim.paid, kitChapterId: claim.chapterId })
      .returning({ id: botSessions.id });
    return { status: 'ok', sessionId: row.id, kit: { takeTwos: BACKSTAGE.kit.takeTwos, tips: BACKSTAGE.kit.tips, paid: claim.paid, chips: claim.chips } };
  });
}

export type EndedBy = 'game' | 'resign' | 'timeout' | 'abandon' | 'bot-timeout';
export const ENDED_BY: EndedBy[] = ['game', 'resign', 'timeout', 'abandon', 'bot-timeout'];

export type FinishResult =
  | { status: 'ok'; outcome: 'win' | 'loss' | 'draw'; chipsGranted: number; chips: number; progression: ProgressionSummary }
  | { status: 'no-result'; reason: 'invalid-pgn' | 'too-short' | 'too-fast' | 'unverifiable' }
  | { status: 'not-found' }
  | { status: 'already-finished' };

export async function finishBotSession(
  userId: string,
  sessionId: string,
  input: { pgn: unknown; endedBy: unknown },
  now = new Date(),
): Promise<FinishResult> {
  // Claim the session atomically: the first finisher wins, a replay finds nothing.
  const claimed = await db
    .update(botSessions)
    .set({ finishedAt: now })
    .where(and(eq(botSessions.id, sessionId), eq(botSessions.userId, userId), isNull(botSessions.finishedAt)))
    .returning();
  if (claimed.length === 0) {
    const [exists] = await db.select({ id: botSessions.id }).from(botSessions).where(and(eq(botSessions.id, sessionId), eq(botSessions.userId, userId))).limit(1);
    return exists ? { status: 'already-finished' } : { status: 'not-found' };
  }
  const session = claimed[0];
  const finish = async (result: string) => {
    await db.update(botSessions).set({ result }).where(eq(botSessions.id, sessionId));
  };
  // A Roadie Kit game that can't be verified gives the kit back (nothing was won or lost).
  const noResult = async (reason: 'invalid-pgn' | 'too-short' | 'too-fast' | 'unverifiable'): Promise<FinishResult> => {
    await finish(reason);
    if (session.kitPaid !== null && session.kitChapterId) await refundBossKit(userId, session.kitChapterId, session.kitPaid, now);
    return { status: 'no-result', reason };
  };

  const myColor = session.color as 'w' | 'b';
  const facts = typeof input.pgn === 'string' ? analyzeGame(input.pgn, myColor) : null;
  if (!facts) return noResult('invalid-pgn');

  // The position decides when it is conclusive; otherwise only a LOSS claim is believed
  // (claiming to have lost can never pay anything).
  let outcome: 'win' | 'loss' | 'draw' | null = null;
  if (facts.result) {
    outcome = facts.result === 'draw' ? 'draw' : facts.result === (myColor === 'w' ? 'white' : 'black') ? 'win' : 'loss';
  } else if (input.endedBy === 'resign' || input.endedBy === 'timeout' || input.endedBy === 'abandon') {
    outcome = 'loss';
  }
  if (!outcome) return noResult('unverifiable');
  if (facts.plies < MIN_BOT_PLIES) return noResult('too-short');
  if (now.getTime() - session.startedAt.getTime() < MIN_MS_BASE + facts.plies * MIN_MS_PER_PLY) return noResult('too-fast');

  const paid = await applyVerifiedBotResult(
    userId,
    { botId: session.botId, difficulty: session.difficulty as BotDifficulty, color: myColor, outcome, facts, payChips: true, assisted: session.kitPaid !== null },
    now,
  );
  await finish(outcome);
  return { status: 'ok', outcome, chipsGranted: paid.chipsGranted, chips: paid.chips, progression: paid.progression };
}

export interface VerifiedBotResult {
  botId: string;
  difficulty: BotDifficulty;
  color: 'w' | 'b';
  outcome: 'win' | 'loss' | 'draw';
  facts: GameFacts;
  // false for a Festival set: the purse (db/festival.ts) replaces the flat bot reward.
  payChips: boolean;
  // Online-style key so the app can match a socket-pushed report to its match (Festival sets).
  matchId?: string;
  // Played with a Roadie Kit: may beat the boss, advances no gigs (db/tour.ts).
  assisted?: boolean;
}

// Everything a finished bot game that has ALREADY been verified is worth: the flat chip
// reward, daily goals, achievements, the Tour and Fame. Shared by the device-played bot
// sessions above and the server-hosted Festival sets, so both pay through one path.
export async function applyVerifiedBotResult(
  userId: string,
  input: VerifiedBotResult,
  now = new Date(),
): Promise<{ chipsGranted: number; chips: number; progression: ProgressionSummary }> {
  const { outcome, facts, color: myColor, difficulty } = input;
  const chipsGranted = input.payChips ? botChipReward(difficulty, outcome) : 0;
  const [credited] = await db
    .update(playerProfiles)
    .set({ chips: sql`${playerProfiles.chips} + ${chipsGranted}`, updatedAt: now })
    .where(eq(playerProfiles.userId, userId))
    .returning({ chips: playerProfiles.chips });

  // Daily goals (with before/after for the Show Report), achievements, the Tour --
  // all from the VERIFIED facts, never from client claims.
  const questsBefore = await getQuestsStatus(userId);
  await reportMatchForQuests(userId, {
    won: outcome === 'win',
    checkmate: outcome === 'win' && facts.checkmate,
    capturedCount: facts.myCaptures,
  });
  const goals = diffGoals(questsBefore, await getQuestsStatus(userId));
  await reportMatchForAchievements(userId, {
    won: outcome === 'win',
    checkmate: outcome === 'win' && facts.checkmate,
    capturedCount: facts.myCaptures,
    opponentCapturedCount: facts.opponentCaptures,
    color: myColor,
    moveCount: facts.moveCount,
    isBot: true,
  });

  const event: TourMatchEvent = {
    source: 'bot',
    outcome,
    color: myColor,
    moveCount: facts.moveCount,
    plies: facts.plies,
    assisted: input.assisted,
    myCaptures: facts.myCaptures,
    queenLost: facts.queenLost,
    checkmate: facts.checkmate,
    mateByPiece: facts.mateByPiece,
    botId: input.botId,
    botRank: BOT_RANK[difficulty],
  };
  const tour = await applyTour(userId, { event }, now);

  const progression = await grantFame(userId, { source: 'bot', outcome, difficulty, goals, tour, matchId: input.matchId });
  const [after] = await db.select({ chips: playerProfiles.chips }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  return { chipsGranted, chips: after?.chips ?? credited?.chips ?? 0, progression };
}
