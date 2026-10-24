import { Chess } from 'chess.js';
import { reportError } from './monitoring.js';

import { EASY_HEURISTIC_DEPTH, pickHeuristicMove } from './bots/heuristicBot.generated.js';
import { STOCKFISH_PRESETS } from './bots/presets.generated.js';
import { goCommand, loadStockfish, parseBestMove, type UciEngine } from './bots/stockfishNode.js';
import type { EngineMove } from './bots/types.js';
import type { BotDifficulty } from './tour.js';

// The opponent in a Festival set runs HERE, not on the player's device. That is the whole
// point: a purse several times the entry cannot depend on a client-reported game (a script
// could submit a legal, plausible checkmate), so the server plays the bot itself and the
// resulting game is authoritative. Same engines and presets as the app (see
// scripts/gen-server-bots.mjs): easy/medium = the heuristic bot, the rest = Stockfish 18 lite.
//
// Concurrency: one move is computed at a time (a promise chain), so a burst of runs queues
// instead of piling CPU onto the event loop. A move that overruns falls back to the heuristic
// bot so a paid run can never stall on a slow engine.

const ENGINE_TIMEOUT_SLACK_MS = 4_000;

let engineReady: Promise<UciEngine> | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getEngine(): Promise<UciEngine> {
  if (!engineReady) {
    engineReady = loadStockfish().then(async (engine) => {
      engine.send('uci');
      engine.send('isready');
      await new Promise((resolve) => setTimeout(resolve, 150));
      return engine;
    });
    engineReady.catch(() => {
      engineReady = null; // retry on the next request
    });
  }
  return engineReady;
}

/** Warm the engine at boot so the first Stockfish set does not pay the load time. */
export function warmServerBot(): void {
  void getEngine().catch((error) => reportError(error, { area: 'server-bot-load' }));
}

function stockfishMove(fen: string, difficulty: 'stockfish-basic' | 'stockfish-lite' | 'stockfish-strong'): Promise<EngineMove | null> {
  const config = STOCKFISH_PRESETS[difficulty];
  return getEngine().then(
    (engine) =>
      new Promise<EngineMove | null>((resolve, reject) => {
        const timer = setTimeout(() => {
          engine.onLine(() => {});
          engineReady = null; // drop a wedged engine; the next move reloads a fresh one
          reject(new Error('stockfish timeout'));
        }, config.movetimeMs + ENGINE_TIMEOUT_SLACK_MS);
        engine.onLine((line) => {
          const move = parseBestMove(line);
          if (move === undefined) return;
          clearTimeout(timer);
          engine.onLine(() => {});
          resolve(move);
        });
        engine.send('ucinewgame');
        engine.send(`position fen ${fen}`);
        engine.send(goCommand(config));
      }),
  );
}

function heuristicMove(fen: string, difficulty: BotDifficulty): EngineMove | null {
  const chess = new Chess(fen);
  return difficulty === 'easy' ? pickHeuristicMove(chess, EASY_HEURISTIC_DEPTH) : pickHeuristicMove(chess);
}

/** The bot's reply for this position (a FEN, so no caller's board is ever shared or mutated). */
export function pickBotMove(fen: string, difficulty: BotDifficulty): Promise<EngineMove | null> {
  const run = async (): Promise<EngineMove | null> => {
    if (difficulty === 'easy' || difficulty === 'medium') return heuristicMove(fen, difficulty);
    try {
      return await stockfishMove(fen, difficulty);
    } catch (error) {
      reportError(error, { area: 'server-bot-engine' });
      return heuristicMove(fen, 'medium');
    }
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}
