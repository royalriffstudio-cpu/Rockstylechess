import type { Chess, PieceSymbol } from 'chess.js';

import type { EngineMove } from './botEngine';

// Easy tier (Roadie Rick) and medium tier (Valkyrie Riff, Old School Roy):
// negamax with alpha-beta pruning over chess.js's own move()/undo(), no
// external engine -- just different max search depths (see EASY_HEURISTIC_DEPTH
// / HEURISTIC_MAX_SEARCH_DEPTH below).
//
// chess.js's move generation is not cheap (~ms per call, not microseconds --
// it's a naive JS implementation, not bitboards), and this runs synchronously
// on React Native's single JS thread, which also owns touch/gesture handling.
// A flat, unconditional depth 3 was once measured to genuinely freeze the
// app for many seconds -- tens of thousands of chess.js calls blocking
// everything, including input, which then queues up and fires all at once
// the moment it unblocks.
//
// pickHeuristicMove now iteratively deepens (1, 2, 3, ...) against a single
// shared wall-clock deadline instead of searching one fixed depth: depth 2
// always completes (it already finishes well inside the deadline today),
// and a bonus depth-3 pass is only kept if it *also* finishes before the
// deadline -- otherwise it's discarded and the depth-2 result is used, which
// is exactly today's behavior. Every node (including root-level ones) routes
// through the same state.aborted fast path below, so the worst case is
// bounded by the deadline itself no matter how deep a round gets -- this is
// the standard "iterative deepening with a time cutoff" pattern, not a
// repeat of the old flat depth-3 attempt.
export const HEURISTIC_MAX_SEARCH_DEPTH = 3; // medium tier (Valkyrie Riff, Old School Roy)
// Easy tier (Roadie Rick). 1-ply (no look at the opponent's reply at all) let
// it walk into any one-move recapture -- a real beginner still notices an
// immediate threat, it just doesn't plan ahead, so this sees exactly one
// opponent reply and no further.
export const EASY_HEURISTIC_DEPTH = 2;
// Hard safety net regardless of position complexity or depth -- once hit,
// remaining nodes fall back to an instant static eval instead of recursing
// further, so worst case is bounded no matter how many legal moves a given
// position has.
const SEARCH_TIME_BUDGET_MS = 450;

const MATE_SCORE = 100000;
const TIE_TOLERANCE_CP = 10;

const PIECE_VALUES: Record<PieceSymbol, number> = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Michniewski's public-domain "simplified evaluation function" piece-square
// tables, row 0 = rank 8 down to row 7 = rank 1, matching chess.js's own
// board() row order. Written for White; mirrored per-piece for Black below.
const PST: Record<PieceSymbol, number[][]> = {
  p: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [50, 50, 50, 50, 50, 50, 50, 50],
    [10, 10, 20, 30, 30, 20, 10, 10],
    [5, 5, 10, 25, 25, 10, 5, 5],
    [0, 0, 0, 20, 20, 0, 0, 0],
    [5, -5, -10, 0, 0, -10, -5, 5],
    [5, 10, 10, -20, -20, 10, 10, 5],
    [0, 0, 0, 0, 0, 0, 0, 0],
  ],
  n: [
    [-50, -40, -30, -30, -30, -30, -40, -50],
    [-40, -20, 0, 0, 0, 0, -20, -40],
    [-30, 0, 10, 15, 15, 10, 0, -30],
    [-30, 5, 15, 20, 20, 15, 5, -30],
    [-30, 0, 15, 20, 20, 15, 0, -30],
    [-30, 5, 10, 15, 15, 10, 5, -30],
    [-40, -20, 0, 5, 5, 0, -20, -40],
    [-50, -40, -30, -30, -30, -30, -40, -50],
  ],
  b: [
    [-20, -10, -10, -10, -10, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 10, 10, 5, 0, -10],
    [-10, 5, 5, 10, 10, 5, 5, -10],
    [-10, 0, 10, 10, 10, 10, 0, -10],
    [-10, 10, 10, 10, 10, 10, 10, -10],
    [-10, 5, 0, 0, 0, 0, 5, -10],
    [-20, -10, -10, -10, -10, -10, -10, -20],
  ],
  r: [
    [0, 0, 0, 0, 0, 0, 0, 0],
    [5, 10, 10, 10, 10, 10, 10, 5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [-5, 0, 0, 0, 0, 0, 0, -5],
    [0, 0, 0, 5, 5, 0, 0, 0],
  ],
  q: [
    [-20, -10, -10, -5, -5, -10, -10, -20],
    [-10, 0, 0, 0, 0, 0, 0, -10],
    [-10, 0, 5, 5, 5, 5, 0, -10],
    [-5, 0, 5, 5, 5, 5, 0, -5],
    [0, 0, 5, 5, 5, 5, 0, -5],
    [-10, 5, 5, 5, 5, 5, 0, -10],
    [-10, 0, 5, 0, 0, 0, 0, -10],
    [-20, -10, -10, -5, -5, -10, -10, -20],
  ],
  k: [
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-30, -40, -40, -50, -50, -40, -40, -30],
    [-20, -30, -30, -40, -40, -30, -30, -20],
    [-10, -20, -20, -20, -20, -20, -20, -10],
    [20, 20, 0, 0, 0, 0, 20, 20],
    [20, 30, 10, 0, 0, 10, 30, 20],
  ],
};

function evaluateWhitePerspective(chess: Chess): number {
  const board = chess.board();
  let score = 0;
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const cell = board[row][col];
      if (!cell) continue;
      const isWhite = cell.color === 'w';
      const pstRow = isWhite ? row : 7 - row;
      const value = PIECE_VALUES[cell.type] + PST[cell.type][pstRow][col];
      score += isWhite ? value : -value;
    }
  }
  return score;
}

// Negamax convention: positive is good for the side to move.
function evaluate(chess: Chess): number {
  const whiteScore = evaluateWhitePerspective(chess);
  return chess.turn() === 'w' ? whiteScore : -whiteScore;
}

function orderedMoves(chess: Chess) {
  return chess.moves({ verbose: true }).sort((a, b) => Number(b.isCapture()) - Number(a.isCapture()));
}

interface SearchState {
  deadline: number;
  nodeCount: number;
  aborted: boolean;
}

// Checking every node would cost more than it saves (Date.now() isn't free
// at that frequency); checking too rarely risks overshooting the budget by a
// visible amount. Every 32 nodes is a reasonable middle ground.
const DEADLINE_CHECK_INTERVAL = 32;

// A plain fixed-depth search that stops dead at a leaf mid-capture-sequence
// suffers the classic "horizon effect": it happily grabs a piece that gets
// recaptured one ply past where it stopped looking, because the static eval
// at that leaf counts the material gained but never sees the reply that
// takes it back. Quiescence search fixes this by continuing to search
// *only* captures (a much narrower, cheaper search than a full ply) past
// the nominal leaf until the position is "quiet" -- i.e. no capture still
// improves on just standing pat -- so a leaf's score reflects a settled
// position instead of a snapshot mid-trade. Capped at QUIESCENCE_MAX_PLY so
// a long forced capture chain can't blow the wall-clock budget.
const QUIESCENCE_MAX_PLY = 4;

function quiescence(chess: Chess, alpha: number, beta: number, state: SearchState, qDepth: number): number {
  state.nodeCount += 1;
  if (!state.aborted && state.nodeCount % DEADLINE_CHECK_INTERVAL === 0 && Date.now() > state.deadline) {
    state.aborted = true;
  }
  const standPat = evaluate(chess);
  if (state.aborted || qDepth <= 0) return standPat;
  if (standPat >= beta) return beta;
  if (standPat > alpha) alpha = standPat;

  // MVV ordering (highest-value victim first) so the strongest refutation of
  // a bad capture is found early and prunes the rest via the beta cutoff.
  const captures = chess
    .moves({ verbose: true })
    .filter((move) => move.isCapture())
    .sort((a, b) => PIECE_VALUES[b.captured ?? 'p'] - PIECE_VALUES[a.captured ?? 'p']);

  for (const move of captures) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
    const score = -quiescence(chess, -beta, -alpha, state, qDepth - 1);
    chess.undo();
    if (state.aborted) break;
    if (score >= beta) return beta;
    if (score > alpha) alpha = score;
  }
  return alpha;
}

function negamax(chess: Chess, depth: number, alpha: number, beta: number, state: SearchState): number {
  state.nodeCount += 1;
  if (!state.aborted && state.nodeCount % DEADLINE_CHECK_INTERVAL === 0 && Date.now() > state.deadline) {
    state.aborted = true;
  }
  // Once aborted, every remaining node takes the cheap static-eval fast path
  // (skipping quiescence too) so the search unwinds quickly instead of
  // completing its full depth.
  if (state.aborted) return evaluate(chess);
  // Leaf: hand off to quiescence instead of returning the static eval
  // directly -- see QUIESCENCE_MAX_PLY above for why. The previous version
  // generated moves at every leaf too, just to check for checkmate, which
  // alone accounted for roughly half the total search cost for no benefit (a
  // checkmate discovered only at the deepest ply is already an acceptable
  // miss for a "medium" bot), so this still skips move generation for
  // non-captures at the leaf.
  if (depth === 0) return quiescence(chess, alpha, beta, state, QUIESCENCE_MAX_PLY);

  const moves = orderedMoves(chess);
  if (moves.length === 0) {
    return chess.isCheckmate() ? -MATE_SCORE : 0;
  }
  if (chess.isDraw()) return 0;

  let best = -Infinity;
  for (const move of moves) {
    chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
    const score = -negamax(chess, depth - 1, -beta, -alpha, state);
    chess.undo();
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta || state.aborted) break;
  }
  return best;
}

type ScoredMove = { move: ReturnType<typeof orderedMoves>[number]; score: number };

export function pickHeuristicMove(chess: Chess, maxDepth = HEURISTIC_MAX_SEARCH_DEPTH): EngineMove | null {
  let moves = orderedMoves(chess);
  if (moves.length === 0) return null;
  // Forced move -- searching it would just burn the time budget for nothing.
  if (moves.length === 1) {
    const only = moves[0];
    return { from: only.from, to: only.to, promotion: (only.promotion as EngineMove['promotion']) ?? 'q' };
  }

  const state: SearchState = { deadline: Date.now() + SEARCH_TIME_BUDGET_MS, nodeCount: 0, aborted: false };
  let scored: ScoredMove[] = [];
  let bestScore = -Infinity;

  // Iterative deepening: always keep the last round that finished in full.
  // A deeper round that gets cut off partway through is discarded outright
  // (its later moves would only have a cheap, inconsistent 1-ply-equivalent
  // score once state.aborted trips), so bestScore/scored only ever reflect a
  // fully-completed round -- never a mix of two depths.
  for (let depth = 1; depth <= maxDepth; depth += 1) {
    let roundBest = -Infinity;
    const roundScored: ScoredMove[] = [];

    for (const move of moves) {
      chess.move({ from: move.from, to: move.to, promotion: move.promotion ?? 'q' });
      // Full (-Infinity, Infinity) window for every root move, deliberately
      // *not* narrowed by a sibling's already-found score -- root moves feed
      // the tied-move randomization below, which needs each one's real
      // score, not a fail-soft alpha-beta bound that's merely "at least this
      // bad" for a move a tighter window gave up on early. Deeper, non-root
      // nodes still narrow their window from the caller as usual; only the
      // root treats every candidate to a full search.
      const score = -negamax(chess, depth - 1, -Infinity, Infinity, state);
      chess.undo();
      roundScored.push({ move, score });
      if (score > roundBest) roundBest = score;
    }

    // The very first round is always kept even if it got cut off partway
    // through (guarantees scored/bestScore are never empty) -- only a
    // deeper *bonus* round, with an already-valid shallower result to fall
    // back to, gets discarded on abort.
    if (state.aborted && scored.length > 0) break;
    scored = roundScored;
    bestScore = roundBest;
    if (state.aborted) break;
    // Best-first ordering for the next, deeper round -- improves alpha-beta
    // pruning and raises the odds that round also finishes before the
    // deadline.
    moves = [...roundScored].sort((a, b) => b.score - a.score).map((s) => s.move);
  }

  // Randomize among near-tied top moves so this bot doesn't always play the
  // exact same reply in a given position.
  const tied = scored.filter((s) => bestScore - s.score <= TIE_TOLERANCE_CP);
  const chosen = tied[Math.floor(Math.random() * tied.length)];
  return { from: chosen.move.from, to: chosen.move.to, promotion: (chosen.move.promotion as EngineMove['promotion']) ?? 'q' };
}
