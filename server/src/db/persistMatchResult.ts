import { eq, sql } from 'drizzle-orm';

import type { MatchState, PieceColor } from '../match.js';
import { MATCH_CHIP_REWARDS } from '../matchRewards.js';
import { emitToUser } from '../realtime.js';
import { reportMatchForAchievements } from './achievements.js';
import { db } from './client.js';
import { expectedScore, updatedRating } from './elo.js';
import { insertNotification } from './notifications.js';
import { analyzeGame } from '../matchAnalysis.js';
import { applyTour } from './tour.js';
import { diffGoals, grantFame } from './progression.js';
import { getQuestsStatus, reportMatchForQuests } from './quests.js';
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
//
// `opts` (wagered matches only -- see db/wagers.ts): the flat per-win chip reward
// is skipped (a wagered win pays the pot instead, never both), and each
// player's net wager result is recorded on their participant row for history.
// A VOID wagered match (someone left in the first 3 moves) is never persisted
// at all -- the caller skips this function, so there is no rating, XP or row.
export interface PersistOptions {
  wagered?: boolean;
  chipsDeltaByUser?: Record<string, number>;
}

export async function persistMatchResult(
  match: MatchState,
  resultType: ResultType,
  winnerColor: PieceColor | null,
  opts: PersistOptions = {},
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
      venueTier: match.venueTier ?? null,
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
      chipsDelta: opts.chipsDeltaByUser?.[white.userId] ?? null,
    },
    {
      matchId: insertedMatch.id,
      userId: black.userId,
      color: 'b',
      outcome: outcomeFor(blackScore),
      ratingBefore: blackProfile.rating,
      ratingAfter: blackRatingAfter,
      ratingDelta: blackRatingAfter - blackProfile.rating,
      chipsDelta: opts.chipsDeltaByUser?.[black.userId] ?? null,
    },
  ]);

  const [whiteStats, blackStats] = await Promise.all([
    updateProfileStats(white.userId, whiteRatingAfter, whiteScore, !opts.wagered),
    updateProfileStats(black.userId, blackRatingAfter, blackScore, !opts.wagered),
  ]);

  // Quests first (so the Show Report can say which goals this match moved), then
  // Fame. Fame / level / titles / rewards are one transaction per player (see
  // db/progression.ts); a failure there must never lose the match record above.
  const [questsBeforeW, questsBeforeB] = await Promise.all([getQuestsStatus(white.userId), getQuestsStatus(black.userId)]);
  await Promise.all([
    reportMatchForQuests(white.userId, { won: whiteScore === 1, checkmate: whiteScore === 1 && resultType === 'checkmate', capturedCount: whiteCaptures, onlineGame: true }),
    reportMatchForQuests(black.userId, { won: blackScore === 1, checkmate: blackScore === 1 && resultType === 'checkmate', capturedCount: blackCaptures, onlineGame: true }),
  ]);
  const [questsAfterW, questsAfterB] = await Promise.all([getQuestsStatus(white.userId), getQuestsStatus(black.userId)]);
  await Promise.all(
    [
      { userId: white.userId, score: whiteScore, stats: whiteStats, before: whiteProfile.rating, after: whiteRatingAfter, goals: diffGoals(questsBeforeW, questsAfterW) },
      { userId: black.userId, score: blackScore, stats: blackStats, before: blackProfile.rating, after: blackRatingAfter, goals: diffGoals(questsBeforeB, questsAfterB) },
    ].map(async (p) => {
      try {
        // The Tour reads the same authoritative PGN (never a client claim).
        const myColor = p.userId === white.userId ? 'w' : 'b';
        const facts = analyzeGame(match.chess.pgn(), myColor);
        const tour = facts
          ? await applyTour(p.userId, {
              event: {
                source: 'online',
                outcome: outcomeFor(p.score),
                color: myColor,
                moveCount: facts.moveCount,
                myCaptures: facts.myCaptures,
                queenLost: facts.queenLost,
                checkmate: facts.checkmate,
                mateByPiece: facts.mateByPiece,
                wagered: opts.wagered === true,
                rating: p.after,
              },
            })
          : null;
        const summary = await grantFame(p.userId, {
          source: 'online',
          outcome: outcomeFor(p.score),
          winStreak: p.stats.winStreak,
          matchId: match.id,
          rating: { before: p.before, after: p.after },
          goals: p.goals,
          tour,
        });
        emitToUser(p.userId, 'progression:update', summary);
      } catch (error) {
        console.error('fame grant failed', error);
      }
    }),
  );

  await Promise.all([
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
    insertNotification(white.userId, 'match_ended', ...matchNotificationText(whiteScore, resultType, black.displayName), {
      matchId: insertedMatch.id,
      opponentUserId: black.userId,
      opponentDisplayName: black.displayName,
      resultType,
      color: 'w',
      playedAt: new Date().toISOString(),
    }),
    insertNotification(black.userId, 'match_ended', ...matchNotificationText(blackScore, resultType, white.displayName), {
      matchId: insertedMatch.id,
      opponentUserId: white.userId,
      opponentDisplayName: white.displayName,
      resultType,
      color: 'b',
      playedAt: new Date().toISOString(),
    }),
  ]);
}

// [title, body] tuple so the two insertNotification calls above can spread
// it straight into their (type, title, body, payload) positional args.
function matchNotificationText(score: number, resultType: ResultType, opponentName: string): [string, string] {
  if (score === 0.5) return ['Match drawn', `Your match vs ${opponentName} ended in a draw.`];
  const won = score === 1;
  const reason =
    resultType === 'checkmate' ? 'by checkmate' :
    resultType === 'resignation' ? 'by resignation' :
    resultType === 'timeout' ? 'on time' :
    resultType === 'forfeit' ? 'by forfeit' : '';
  return [won ? 'Victory!' : 'Defeat', `You ${won ? 'won' : 'lost'} vs ${opponentName}${reason ? ` ${reason}` : ''}.`];
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
  grantFlatChips: boolean,
): Promise<{ winStreak: number }> {
  const outcome = outcomeFor(score);
  // Wagered matches pay through the escrow settlement (db/wagers.ts) instead.
  const chipsGranted = grantFlatChips ? MATCH_CHIP_REWARDS[outcome] : 0;
  // Fame/XP/level are granted separately by db/progression.ts's grantFame.
  const [row] = await db
    .update(playerProfiles)
    .set({
      rating: ratingAfter,
      wins: sql`${playerProfiles.wins} + ${score === 1 ? 1 : 0}`,
      losses: sql`${playerProfiles.losses} + ${score === 0 ? 1 : 0}`,
      draws: sql`${playerProfiles.draws} + ${score === 0.5 ? 1 : 0}`,
      // A draw no longer breaks a win streak (it neither extends nor resets it);
      // only a loss does.
      winStreak: score === 1 ? sql`${playerProfiles.winStreak} + 1` : score === 0 ? sql`0` : playerProfiles.winStreak,
      chips: sql`${playerProfiles.chips} + ${chipsGranted}`,
      updatedAt: new Date(),
    })
    .where(eq(playerProfiles.userId, userId))
    .returning({ winStreak: playerProfiles.winStreak });
  return { winStreak: row.winStreak };
}
