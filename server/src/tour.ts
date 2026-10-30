import { ECONOMY } from './economy.generated.js';

// The Tour's rules, pure (no database): the catalog and "does this finished
// match move this gig". db/tour.ts persists the result and pays the rewards.
// Numbers and gig text live in economy.config.json (`tour`, `bots`).

export type BotDifficulty = 'easy' | 'medium' | 'stockfish-basic' | 'stockfish-lite' | 'stockfish-strong';

export const BOT_RANK: Record<BotDifficulty, number> = {
  easy: 0,
  medium: 1,
  'stockfish-basic': 2,
  'stockfish-lite': 3,
  'stockfish-strong': 4,
};

export interface BotInfo {
  id: string;
  name: string;
  emoji: string;
  difficulty: BotDifficulty;
}
export const BOTS: BotInfo[] = ECONOMY.bots.map((b) => ({ ...b })) as BotInfo[];
export function botById(id: unknown): BotInfo | undefined {
  return typeof id === 'string' ? BOTS.find((b) => b.id === id) : undefined;
}

export interface Gig {
  id: string;
  title: string;
  description: string;
  kind: string;
  target: number;
  chips: number;
  minRank?: number;
  color?: 'w' | 'b';
  maxMoves?: number;
  minMoves?: number;
  piece?: string;
}

export interface Chapter {
  id: string;
  name: string;
  venue: string;
  tagline: string;
  bossBotId: string | null;
  encore?: string[];
  bossReward: { chips: number; gems: number };
  title: { id: string; name: string };
  gigs: Gig[];
}

export const CHAPTERS: Chapter[] = ECONOMY.tour.chapters.map((c) => ({ ...c, gigs: c.gigs.map((g) => ({ ...g })) })) as unknown as Chapter[];
export const PERFECT_BONUS_GEMS = ECONOMY.tour.perfectBonusGems;
export const MIN_BOT_PLIES = ECONOMY.tour.minBotPlies;
export const TOUR_TITLES = CHAPTERS.map((c) => c.title);

// Backstage: the Roadie Kit and Crowd Energy (db/tour.ts). Help for a player stuck on a
// chapter boss -- never a shortcut. See economy.config.json -> tour.backstage.
export const BACKSTAGE = ECONOMY.tour.backstage;

// What the kit costs for a chapter: a fraction of that boss's chip reward, to the nearest 10.
export function kitPrice(chapter: Chapter): number {
  return Math.round((chapter.bossReward.chips * BACKSTAGE.kitPriceFraction) / 10) * 10;
}

// Is this bot one of the chapter's boss fights (its boss, or any bot of the Encore gauntlet)?
export function isBossOf(chapter: Chapter, botId: string): boolean {
  return chapter.bossBotId === botId || (chapter.encore?.includes(botId) ?? false);
}

// Crowd Energy for `losses` real boss losses: is the kit open, and how many of the crowd's
// free kits have been earned so far (one every `crowdFreeEvery` losses)?
export const kitUnlocked = (losses: number) => losses >= BACKSTAGE.kitUnlockLosses;
export const freeKitsEarned = (losses: number) => Math.floor(losses / BACKSTAGE.crowdFreeEvery);

export const bossGigId = (chapterId: string) => `boss-${chapterId}`;
export const perfectGigId = (chapterId: string) => `perfect-${chapterId}`;

// What a finished, VERIFIED match looks like to the Tour. Built from the match's
// own PGN (never from a client claim) by db/botSessions.ts (bot games) and
// db/persistMatchResult.ts (online games).
export interface TourMatchEvent {
  source: 'bot' | 'online';
  outcome: 'win' | 'loss' | 'draw';
  color: 'w' | 'b';
  moveCount: number; // full moves
  plies?: number; // half-moves (bot games; used to tell a real boss attempt from a quick resign)
  // A Roadie Kit game: it can still beat the boss, but it advances no gigs.
  assisted?: boolean;
  myCaptures: number;
  queenLost: boolean; // the opponent captured my queen at some point
  checkmate: boolean;
  mateByPiece: string | null; // piece letter that delivered MY checkmate
  botId?: string;
  botRank?: number;
  wagered?: boolean;
  rating?: number; // my rating after an online match
}

// How much a gig advances for one event: `add` (a count) or `max` (a high-water
// mark), or nothing. Gigs that are not about matches (puzzles) are handled by
// db/tour.ts directly.
export type GigDelta = { add: number } | { max: number } | null;

export function gigDelta(gig: Gig, e: TourMatchEvent): GigDelta {
  const won = e.outcome === 'win';
  const rankOk = (e.botRank ?? 99) >= (gig.minRank ?? 0);
  switch (gig.kind) {
    case 'win_bot':
      return won && e.source === 'bot' && (e.botRank ?? -1) >= (gig.minRank ?? 0) ? { add: 1 } : null;
    case 'win_color':
      return won && e.color === gig.color ? { add: 1 } : null;
    case 'capture_game':
      return won ? { max: e.myCaptures } : null;
    case 'online_games':
      return e.source === 'online' ? { add: 1 } : null;
    case 'online_wins':
      return won && e.source === 'online' ? { add: 1 } : null;
    case 'wager_wins':
      return won && e.source === 'online' && e.wagered ? { add: 1 } : null;
    case 'win_moves':
      return won && e.moveCount <= (gig.maxMoves ?? 0) && (e.source === 'online' || rankOk) ? { add: 1 } : null;
    case 'win_marathon':
      return won && e.moveCount >= (gig.minMoves ?? 0) ? { add: 1 } : null;
    case 'win_no_queen_loss':
      return won && !e.queenLost && (e.source === 'online' || rankOk) ? { add: 1 } : null;
    case 'mate_piece':
      return won && e.checkmate && e.mateByPiece === gig.piece ? { add: 1 } : null;
    case 'rating':
      return e.rating !== undefined ? { max: e.rating } : null;
    default:
      return null;
  }
}

export function chapterById(id: string): Chapter | undefined {
  return CHAPTERS.find((c) => c.id === id);
}

export function allGigs(): { chapter: Chapter; gig: Gig }[] {
  return CHAPTERS.flatMap((chapter) => chapter.gigs.map((gig) => ({ chapter, gig })));
}
