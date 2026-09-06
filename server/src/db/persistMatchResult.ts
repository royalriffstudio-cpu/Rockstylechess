import { eq, sql } from 'drizzle-orm';

import { applyXpGain } from '../leveling.js';
import type { MatchState, PieceColor } from '../match.js';
import { MATCH_CHIP_REWARDS, MATCH_XP_REWARDS } from '../matchRewards.js';
import { reportMatchForAchievements } from './achievements.js';
import { db } from './client.js';
import { expectedScore, updatedRating } from './elo.js';
import { reportMatchForQuests } from './quests.js';
import { matchParticipants, matches, playerProfiles } from './schema/index.js';

type ResultType = 'checkmate' | 'stalemate' | 'draw' | 'resignation' | 'forfeit' | 'timeout';

function scoreFor(color: PieceColor, resultType: ResultType, winnerColor: PieceColor | null): number {
  if (resultType === 'stalemate' || resultType === 'draw') return 0.5;
  return winnerColor === color ? 1 : 0;
}

// Fire-and-forget from index.ts, always AFTER the socket broadcast that
// actually ends the match for both players -- a database hiccup here should
// degrade to "this result didn't save," never to blocking or delaying live
// gameplay. Only records anything when BOTH seats are real, server-verified
// accounts (see MatchPlayer.userId in match.ts); a guest-involving match
// plays identically to today and simply isn't persisted.
export async function persistMatchResult(
  match: MatchState,
  resultType: ResultType,
  winnerColor: PieceColor | null,
): Promise<void> {
  const white = match.players.w;
  const black = match.players.b;
  if (!white.userId || !black.userId) return;

  const [whiteProfile] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, white.userId)).limit(1);
  const [blackProfile] = await db.select().from(playerProfiles).where(eq(playerProfiles.userId, black.userId)).limit(1);
  if (!whiteProfile || !blackProfile) return;

  const whiteScore = scoreFor('w', resultType, winnerColor);
  const blackScore = 1 - whiteScore;

  // Quest progress ('captures') counts each side's OWN captures -- the piece
  // they took, not pieces taken from them -- same convention useChessGame.ts's
  // capturedByWhite/capturedByBlack already use client-side for the in-match
  // captured-piece trays.
  const history = match.chess.history({ verbose: true });
  const whiteCaptures = history.filter((move) => move.color === 'w' && move.captured).length;
  const blackCaptures = history.filter((move) => move.color === 'b' && move.captured).length;
  // history.length counts plies (each side's move is one entry); the
  // marathon/quickdraw achievements are phrased in full moves (the
  // conventional "move 60" chess notation sense), so convert here once.
  const moveCount = Math.ceil(history.length / 2);
  const whiteExpected = expectedScore(whiteProfile.rating, blackProfile.rating);
  const blackExpected = 1 - whiteExpected;
  const whiteRatingAfter = updatedRating(whiteProfile.rating, whiteExpected, whiteScore);
  const blackRatingAfter = updatedRating(blackProfile.rating, blackExpected, blackScore);

  const [insertedMatch] = await db
    .insert(matches)
    .values({
      whiteUserId: white.userId,
      blackUserId: black.userId,
      mode: 'online',
      resultType,
      winnerColor,
      pgn: match.chess.pgn(),
      moveElapsedMs: match.moveElapsedMs,
      startedAt: match.createdAt,
    })
    .returning();

  await db.insert(matchParticipants).values([
    {
      matchId: insertedMatch.id,
      userId: white.userId,
      color: 'w',
      outcome: outcomeFor(whiteScore),
      ratingBefore: whiteProfile.rating,
      ratingAfter: whiteRatingAfter,
      ratingDelta: whiteRatingAfter - whiteProfile.rating,
    },
    {
      matchId: insertedMatch.id,
      userId: black.userId,
      color: 'b',
      outcome: outcomeFor(blackScore),
      ratingBefore: blackProfile.rating,
      ratingAfter: blackRatingAfter,
      ratingDelta: blackRatingAfter - blackProfile.rating,
    },
  ]);

  const [whiteStats, blackStats] = await Promise.all([
    updateProfileStats(white.userId, whiteRatingAfter, whiteScore, whiteProfile.xp),
    updateProfileStats(black.userId, blackRatingAfter, blackScore, blackProfile.xp),
  ]);

  await Promise.all([
    reportMatchForQuests(white.userId, {
      won: whiteScore === 1,
      checkmate: whiteScore === 1 && resultType === 'checkmate',
      capturedCount: whiteCaptures,
    }),
    reportMatchForQuests(black.userId, {
      won: blackScore === 1,
      checkmate: blackScore === 1 && resultType === 'checkmate',
      capturedCount: blackCaptures,
    }),
    reportMatchForAchievements(white.userId, {
      won: whiteScore === 1,
      checkmate: whiteScore === 1 && resultType === 'checkmate',
      capturedCount: whiteCaptures,
      opponentCapturedCount: blackCaptures,
      color: 'w',
      moveCount,
      winStreak: whiteStats.winStreak,
    }),
    reportMatchForAchievements(black.userId, {
      won: blackScore === 1,
      checkmate: blackScore === 1 && resultType === 'checkmate',
      capturedCount: blackCaptures,
      opponentCapturedCount: whiteCaptures,
      color: 'b',
      moveCount,
      winStreak: blackStats.winStreak,
    }),
  ]);
}

function outcomeFor(score: number): 'win' | 'loss' | 'draw' {
  if (score === 1) return 'win';
  if (score === 0) return 'loss';
  return 'draw';
}

async function updateProfileStats(
  userId: string,
  ratingAfter: number,
  score: number,
  currentXp: number,
): Promise<{ winStreak: number }> {
  const outcome = outcomeFor(score);
  const chipsGranted = MATCH_CHIP_REWARDS[outcome];
  const { xp, level } = applyXpGain(currentXp, MATCH_XP_REWARDS[outcome]);
  const [row] = await db
    .update(playerProfiles)
    .set({
      rating: ratingAfter,
      wins: sql`${playerProfiles.wins} + ${score === 1 ? 1 : 0}`,
      losses: sql`${playerProfiles.losses} + ${score === 0 ? 1 : 0}`,
      draws: sql`${playerProfiles.draws} + ${score === 0.5 ? 1 : 0}`,
      winStreak: score === 1 ? sql`${playerProfiles.winStreak} + 1` : sql`0`,
      chips: sql`${playerProfiles.chips} + ${chipsGranted}`,
      xp,
      level,
      updatedAt: new Date(),
    })
    .where(eq(playerProfiles.userId, userId))
    .returning({ winStreak: playerProfiles.winStreak });
  return { winStreak: row.winStreak };
}
