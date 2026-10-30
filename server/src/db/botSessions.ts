import { and, eq, isNull, lt, sql } from 'drizzle-orm';

import { botChipReward } from '../matchRewards.js';
import { analyzeGame } from '../matchAnalysis.js';
import { BOT_RANK, botById, MIN_BOT_PLIES, type TourMatchEvent } from '../tour.js';
import { reportMatchForAchievements } from './achievements.js';
import { db } from './client.js';
import { diffGoals, grantFame, type ProgressionSummary } from './progression.js';
import { getQuestsStatus, reportMatchForQuests } from './quests.js';
import { botSessions, playerProfiles } from './schema/index.js';
import { applyTour } from './tour.js';

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
  | { status: 'ok'; sessionId: string }
  | { status: 'unknown-bot' }
  | { status: 'invalid-color' }
  | { status: 'profile-not-found' };

export async function startBotSession(userId: string, botId: unknown, color: unknown): Promise<StartResult> {
  const bot = botById(botId);
  if (!bot) return { status: 'unknown-bot' };
  if (color !== 'w' && color !== 'b') return { status: 'invalid-color' };

  const [profile] = await db.select({ userId: playerProfiles.userId }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  if (!profile) return { status: 'profile-not-found' };

  // Housekeeping: abandoned sessions expire, and a player cannot hoard open ones.
  await db.delete(botSessions).where(and(eq(botSessions.userId, userId), isNull(botSessions.finishedAt), lt(botSessions.startedAt, new Date(Date.now() - SESSION_TTL_MS))));
  const open = await db
    .select({ id: botSessions.id, startedAt: botSessions.startedAt })
    .from(botSessions)
    .where(and(eq(botSessions.userId, userId), isNull(botSessions.finishedAt)))
    .orderBy(botSessions.startedAt);
  if (open.length >= MAX_OPEN_SESSIONS) {
    // Drop the oldest rather than refuse: an app that was killed mid-game leaves one behind.
    await db.delete(botSessions).where(eq(botSessions.id, open[0].id));
  }

  const [row] = await db.insert(botSessions).values({ userId, botId: bot.id, difficulty: bot.difficulty, color }).returning({ id: botSessions.id });
  return { status: 'ok', sessionId: row.id };
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

  const myColor = session.color as 'w' | 'b';
  const facts = typeof input.pgn === 'string' ? analyzeGame(input.pgn, myColor) : null;
  if (!facts) {
    await finish('invalid-pgn');
    return { status: 'no-result', reason: 'invalid-pgn' };
  }

  // The position decides when it is conclusive; otherwise only a LOSS claim is believed
  // (claiming to have lost can never pay anything).
  let outcome: 'win' | 'loss' | 'draw' | null = null;
  if (facts.result) {
    outcome = facts.result === 'draw' ? 'draw' : facts.result === (myColor === 'w' ? 'white' : 'black') ? 'win' : 'loss';
  } else if (input.endedBy === 'resign' || input.endedBy === 'timeout' || input.endedBy === 'abandon') {
    outcome = 'loss';
  }
  if (!outcome) {
    await finish('unverifiable');
    return { status: 'no-result', reason: 'unverifiable' };
  }
  if (facts.plies < MIN_BOT_PLIES) {
    await finish('too-short');
    return { status: 'no-result', reason: 'too-short' };
  }
  if (now.getTime() - session.startedAt.getTime() < MIN_MS_BASE + facts.plies * MIN_MS_PER_PLY) {
    await finish('too-fast');
    return { status: 'no-result', reason: 'too-fast' };
  }

  const difficulty = session.difficulty as keyof typeof BOT_RANK;
  const chipsGranted = botChipReward(difficulty, outcome);
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
    myCaptures: facts.myCaptures,
    queenLost: facts.queenLost,
    checkmate: facts.checkmate,
    mateByPiece: facts.mateByPiece,
    botId: session.botId,
    botRank: BOT_RANK[difficulty],
  };
  const tour = await applyTour(userId, { event }, now);

  const progression = await grantFame(userId, { source: 'bot', outcome, difficulty, goals, tour });
  const [after] = await db.select({ chips: playerProfiles.chips }).from(playerProfiles).where(eq(playerProfiles.userId, userId)).limit(1);
  await finish(outcome);
  return { status: 'ok', outcome, chipsGranted, chips: after?.chips ?? credited.chips, progression };
}
