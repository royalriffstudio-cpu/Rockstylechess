import type { Chess, Square } from 'chess.js';

import { EASY_HEURISTIC_DEPTH, pickHeuristicMove } from './heuristicBot';
import { pickRandomMove } from './randomBot';

/**
 * Six bots (bots.tsx), five engines. 'stockfish-basic' (Metal Head),
 * 'stockfish-lite' (The Reaper), and 'stockfish-strong' (King Axl) all run
 * through the same StockfishEngine WebView -- see STOCKFISH_PRESETS --
 * just at different depth/movetime.
 *
 * Difficulty is tuned by capping search depth/time, NOT by
 * UCI_LimitStrength/UCI_Elo. Stockfish's own Elo-limiting mode forces
 * internal MultiPV >= 4 and then randomly overrides its own best move via
 * Skill::pick_best with a "weakness" factor that stays close to its maximum
 * even at Elo 2800 -- that made every tier, including the hardest, look like
 * it was missing free captures/tactics it had actually already found. A
 * depth/time cap instead always plays the engine's genuine best move for
 * whatever it had time to search -- a shallower search misses deep tactics
 * for a real reason, not a coin flip on an already-solved position.
 */
export type BotDifficulty = 'easy' | 'medium' | 'stockfish-basic' | 'stockfish-lite' | 'stockfish-strong';

export interface EngineMove {
  from: Square;
  to: Square;
  promotion?: 'q' | 'r' | 'b' | 'n';
}

export interface StockfishConfig {
  depth: number;
  movetimeMs: number;
}

export const STOCKFISH_PRESETS: Record<'stockfish-basic' | 'stockfish-lite' | 'stockfish-strong', StockfishConfig> = {
  'stockfish-basic': { depth: 4, movetimeMs: 800 },
  'stockfish-lite': { depth: 8, movetimeMs: 1200 },
  'stockfish-strong': { depth: 20, movetimeMs: 3000 },
};

export type RequestEngineMove = (fen: string, config: StockfishConfig) => Promise<EngineMove | null>;

/**
 * Single dispatch point the bot-move effect calls into -- callers don't need
 * to know whether a tier is synchronous (easy/medium) or round-trips through
 * a WebView (the two Stockfish tiers), they just await a move.
 */
export async function resolveBotMove(
  chess: Chess,
  difficulty: BotDifficulty,
  requestEngineMove?: RequestEngineMove,
): Promise<EngineMove | null> {
  if (difficulty === 'easy') {
    return pickHeuristicMove(chess, EASY_HEURISTIC_DEPTH);
  }
  if (difficulty === 'medium') {
    return pickHeuristicMove(chess);
  }
  if (!requestEngineMove) {
    console.log('resolveBotMove: no requestEngineMove provided for Stockfish tier, falling back to random');
    return pickRandomMove(chess);
  }
  return requestEngineMove(chess.fen(), STOCKFISH_PRESETS[difficulty]);
}
