import { Chess, type Move, type Square } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';

import { resolveBotMove, type BotDifficulty, type RequestEngineMove } from '@/lib/botEngine';
import { canDeliverMate } from '@/lib/chessEndgame';
import { pickHeuristicMove } from '@/lib/heuristicBot';
import {
  boardGridFromChess,
  checkSquareFromChess,
  classifyMoveSound,
  pickVerboseLastMove,
  type MoveSoundKind,
  type VerboseLastMove,
} from '@/lib/chessBoardSnapshot';
import { getSocket } from '@/lib/socket';
import type {
  DrawOfferedPayload,
  MatchEndedPayload,
  MoveAppliedPayload,
  MoveRejectedPayload,
  QueueMatchedPayload,
} from '@/lib/onlineMatch';
import { getPlayerId } from '@/lib/playerId';
import { parseUciMove } from '@/lib/puzzleEngine';
import { playSound } from '@/lib/soundEffects';

export type { BotDifficulty } from '@/lib/botEngine';

export type GameMode = 'bot' | 'local' | 'online' | 'puzzle';

// Shared empty array so `legalTargets` keeps a stable identity whenever
// nothing is selected -- returning a fresh `[]` each render needlessly
// changed ChessBoard's `legalTargets` prop on every idle re-render. Never
// mutated (callers only read / `.includes`).
const NO_TARGETS: Square[] = [];

// `agreed` marks a negotiated draw; `reason` names a chess.js-detected one
// (or the FIDE 6.9 "flag fell but the opponent can't mate" case) so the
// result screen can show the specific cause instead of a bare "Draw".
export type DrawReason = 'repetition' | 'fiftyMove' | 'insufficient' | 'insufficientVsTimeout' | 'serverRestart';

export type ChessGameResult =
  | { type: 'checkmate'; winner: 'w' | 'b' }
  | { type: 'stalemate' }
  | { type: 'draw'; agreed?: boolean; reason?: DrawReason }
  | { type: 'resignation'; winner: 'w' | 'b' }
  | { type: 'forfeit'; winner: 'w' | 'b' }
  | { type: 'timeout'; winner: 'w' | 'b' };

export interface OnlineMatchInfo {
  matchId: string;
  playerColor: 'w' | 'b';
  initialFen: string;
}

export interface PuzzleInfo {
  puzzleId: string;
  /** Position BEFORE the opponent's forced setup move (Lichess convention). */
  fen: string;
  /**
   * Full raw UCI move list. moves[0] is the opponent's forced setup move
   * (auto-played on construction/reset); moves[1], moves[3], ... are the
   * solver's own moves; moves[2], moves[4], ... (if present) are scripted
   * opponent replies auto-played in between. See puzzleMoveIndexRef below.
   */
  moves: string[];
}

// 'revealed' = the player hit "Give Up" and the rest of the solution was
// played out for them. Terminal like 'solved' (no more interaction) but does
// NOT count as solved for progress.
export type PuzzleStatus = 'playing' | 'solved' | 'failed' | 'revealed';

type LastMoveSource = 'human' | 'bot' | 'opponent' | null;

interface GameSnapshot {
  board: string[][];
  turn: 'w' | 'b';
  checkSquare: Square | null;
  isGameOver: boolean;
  capturedByWhite: string[];
  capturedByBlack: string[];
  /** Full moves played so far (conventional "move 60" sense, not plies) -- used by match.tsx's achievement report (marathon/quickdraw wins). */
  moveCount: number;
  /** Half-moves played so far (a Roadie Kit "Take Two" needs at least 2 to rewind). */
  ply: number;
  lastMove: VerboseLastMove | null;
  // Which side made this snapshot's move -- ChessBoard uses this to only
  // play the slide-in travel animation for moves that weren't this device's
  // own tap/drag (bot moves, or an online opponent's moves), since the local
  // player's own moves already have visual feedback from the gesture itself.
  // Folded into the same snapshot (rather than a separate `useState`) so a
  // move's board/lastMove/source always land in one React commit together --
  // two separate `setState` calls per move let ChessBoard observe a
  // torn/partial update on some platforms, which was the root cause of a
  // slide-in animation glitch (see git history).
  lastMoveSource: LastMoveSource;
  // Which sound cue this move's landing should play -- null when there's no
  // move yet (initial mount/reset). See ChessBoard.tsx's lastMove-driven
  // effect, which plays it whenever lastMove changes, independent of
  // lastMoveSource (unlike the slide animation, sound isn't skipped for the
  // player's own move -- they still want to hear it land).
  lastMoveSound: MoveSoundKind | null;
  // 'playing' for every non-puzzle mode -- only meaningful when
  // mode === 'puzzle'. Folded into the snapshot for the same reason
  // lastMoveSource is: a wrong-guess/solved/failed transition must land in
  // the same atomic commit as the board it applies to.
  puzzleStatus: PuzzleStatus;
}

interface UseChessGameOptions {
  mode: GameMode;
  /** Which of the four bot engines to use. Only relevant when mode === 'bot'. */
  difficulty?: BotDifficulty;
  /** Bridges to the mounted StockfishEngine; required for the two Stockfish difficulties. */
  requestEngineMove?: RequestEngineMove;
  /**
   * Which color the bot plays -- the human takes the other side. Only relevant
   * when mode === 'bot'. Defaults to 'b' (human is White, the historical
   * behaviour); the bots screen's "Play As" pick flips it.
   */
  botColor?: 'w' | 'b';
  /** Fires exactly once per game, whatever ends it (mate/draw/resign/forfeit/timeout). */
  onGameOver?: (result: ChessGameResult) => void;
  /** Match id, which color this device plays, and the starting FEN handed
   * back by the server's queue:matched event. Required when mode === 'online'. */
  online?: OnlineMatchInfo;
  /** The puzzle being solved. Required when mode === 'puzzle'. */
  puzzle?: PuzzleInfo;
  /** Online only -- forwards the server's authoritative remaining-time payload
   * (from move:applied) to whatever owns the live clock display (match.tsx's
   * useChessClock). Pure passthrough, no clock semantics live in this hook --
   * see reportTimeout's comment for why. */
  onClockSync?: (clocks: { w: number; b: number }) => void;
}

// Bot "thinks" for a beat so its move doesn't feel instant -- long enough
// that the player has clearly finished seeing their own move settle before
// the opponent's piece starts sliding. Only used for easy/medium, which
// resolve near-instantly on their own; the Stockfish tiers get their pacing
// from the engine's own movetime instead (see HARD_PRE_DELAY_MS).
const BOT_MOVE_DELAY_MS = 1100;
// Stockfish's own `go movetime` already provides a "thinking" pause -- stacking
// the full BOT_MOVE_DELAY_MS on top would make it feel slower than easy/medium
// for no reason. Still a small delay so the board doesn't flash instantly.
const HARD_PRE_DELAY_MS = 250;

// Loads a puzzle's starting FEN and auto-plays the opponent's forced setup
// move (moves[0]) -- shared by the initial chessRef construction and
// resetPuzzle(), so the very first snapshot a puzzle screen sees already
// reflects the post-setup-move position (and its lastMove highlight shows
// what the opponent just played).
function createPuzzleChess(puzzle: PuzzleInfo): Chess {
  const chess = new Chess(puzzle.fen);
  try {
    chess.move(parseUciMove(puzzle.moves[0]));
  } catch (error) {
    console.log('Puzzle setup move rejected unexpectedly', error);
  }
  return chess;
}

// Running tally of everything a snapshot needs that used to be re-derived
// from scratch via `chess.history({ verbose: true })` on every single move.
// That call replays the whole game internally (generating moves at each ply
// for SAN) -- ~4.5ms at move 40 on a fast desktop, several times that on a
// mid-range phone, and it grows with game length, so a match visibly "lags
// up" the longer it runs. This ledger is instead updated by one O(1)
// `recordMove` call per applied move (see the hook body).
interface MoveLedger {
  capturedByWhite: string[];
  capturedByBlack: string[];
  /** Plies played so far. */
  ply: number;
  lastMove: VerboseLastMove | null;
}

// The old history-scan, run ONCE (at mount / puzzle load / reset) to seed the
// ledger -- covers a puzzle's auto-played setup move and an online match
// resumed from a mid-game FEN, both of which arrive with existing history.
function deriveLedger(chess: Chess): MoveLedger {
  const history = chess.history({ verbose: true });
  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  for (const move of history) {
    if (move.captured) {
      if (move.color === 'w') capturedByWhite.push(move.captured);
      else capturedByBlack.push(move.captured);
    }
  }
  return {
    capturedByWhite,
    capturedByBlack,
    ply: history.length,
    lastMove: pickVerboseLastMove(history[history.length - 1]),
  };
}

function buildSnapshot(
  chess: Chess,
  ledger: MoveLedger,
  lastMoveSource: LastMoveSource,
  puzzleStatus: PuzzleStatus,
): GameSnapshot {
  const cells = chess.board();
  const board = boardGridFromChess(chess, cells);
  const turn = chess.turn();
  const checkSquare = checkSquareFromChess(chess, cells);

  const lastMove = ledger.lastMove;
  const lastMoveSound = classifyMoveSound(chess, lastMove ?? undefined);

  return {
    board,
    turn,
    checkSquare,
    isGameOver: chess.isGameOver(),
    capturedByWhite: ledger.capturedByWhite.slice(),
    capturedByBlack: ledger.capturedByBlack.slice(),
    moveCount: Math.ceil(ledger.ply / 2),
    ply: ledger.ply,
    lastMove,
    lastMoveSource,
    lastMoveSound,
    puzzleStatus,
  };
}

// Wraps chess.js's mutable Chess instance in React state. chess.js owns all
// real chess logic (legal moves, check/checkmate/stalemate/draw detection) --
// this hook just asks it questions and mirrors the answers into a snapshot
// React can render and diff.
export function useChessGame({
  mode,
  difficulty = 'easy',
  requestEngineMove,
  botColor = 'b',
  onGameOver,
  online,
  puzzle,
  onClockSync,
}: UseChessGameOptions) {
  const chessRef = useRef<Chess>(puzzle ? createPuzzleChess(puzzle) : new Chess(online?.initialFen));
  // Incrementally maintained (see recordMove) instead of re-scanned from
  // chess.history() every move -- seeded once here from whatever history the
  // starting position already carries (a puzzle's setup move, a resumed FEN).
  const ledgerRef = useRef<MoveLedger>(deriveLedger(chessRef.current));
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() =>
    buildSnapshot(chessRef.current, ledgerRef.current, null, 'playing'),
  );
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  // A legal pawn move to the last rank that the player has committed to but
  // not yet picked a piece for -- the board keeps showing the pre-move
  // position while match.tsx / puzzle-match.tsx render the PromotionPicker.
  // null the rest of the time. Cleared by completePromotion / cancelPromotion.
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);
  // Which side currently has an outstanding draw offer, or null. Cleared by
  // the server's draw:cleared (any move) / draw:declined, and locally on every
  // move for instant feedback.
  const [drawOfferFrom, setDrawOfferFrom] = useState<'w' | 'b' | null>(null);
  // Held in refs so the async callers below (setTimeout, socket handlers)
  // always reach the latest callback without those callbacks being effect
  // dependencies. Assigned in an effect rather than the render body -- a
  // render-phase ref write bails React Compiler out of optimizing this whole
  // hook, and every call site is post-commit anyway.
  const onGameOverRef = useRef(onGameOver);
  const onClockSyncRef = useRef(onClockSync);
  useEffect(() => {
    onGameOverRef.current = onGameOver;
    onClockSyncRef.current = onClockSync;
  });
  const gameOverFiredRef = useRef(false);
  // Next index to consume from puzzle.moves -- 0 was already auto-played by
  // createPuzzleChess. Odd indices are the solver's own moves (applied via
  // handlePuzzleAttempt); even indices >= 2 are scripted opponent replies
  // (applied by the puzzle-reply effect below).
  const puzzleMoveIndexRef = useRef(1);
  const isSolverTurnInPuzzle = puzzleMoveIndexRef.current % 2 === 1;
  // Bot/local matches never reach the server, so unlike online (server/src/
  // match.ts's applyMove) they'd otherwise have no timing data for a replay
  // feature to use -- mirrors that exact Date.now()-since-start pattern
  // client-side, only for the modes that need it.
  const matchStartRef = useRef(Date.now());
  const moveElapsedMsRef = useRef<number[]>([]);

  function recordMoveTiming() {
    if (mode !== 'bot' && mode !== 'local') return;
    moveElapsedMsRef.current.push(Date.now() - matchStartRef.current);
  }

  // O(1) per-move ledger update -- call with the Move that chess.js just
  // returned from a successful chess.move(). Keeps capturedBy*/ply/lastMove
  // current without the per-move history replay buildSnapshot used to do.
  function recordMove(move: Move) {
    const ledger = ledgerRef.current;
    if (move.captured) {
      if (move.color === 'w') ledger.capturedByWhite.push(move.captured);
      else ledger.capturedByBlack.push(move.captured);
    }
    ledger.ply += 1;
    ledger.lastMove = pickVerboseLastMove(move);
  }

  // Legal moves per origin square for the CURRENT position, filled lazily and
  // thrown away with the position (`snapshot` is a new object on every
  // refresh()). Verbose move lists are expensive in chess.js (every move also
  // recomputes the before/after FEN), and a tap used to build one for the
  // highlight and another for the promotion check; now each square is built at
  // most once per position and every later question is a lookup.
  const legalMoves = useMemo(() => {
    const bySquare = new Map<Square, Move[]>();
    return {
      from(square: Square): Move[] {
        let moves = bySquare.get(square);
        if (!moves) {
          moves = chessRef.current.moves({ square, verbose: true });
          bySquare.set(square, moves);
        }
        return moves;
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshot]);

  const legalTargets = useMemo(() => {
    if (!selectedSquare) return NO_TARGETS;
    return legalMoves.from(selectedSquare).map((move) => move.to);
  }, [selectedSquare, legalMoves]);

  function refresh(source: LastMoveSource = null, puzzleStatus: PuzzleStatus = 'playing') {
    setSnapshot(buildSnapshot(chessRef.current, ledgerRef.current, source, puzzleStatus));
  }

  function reportGameOverIfDone() {
    const chess = chessRef.current;
    if (!chess.isGameOver() || gameOverFiredRef.current) return;
    gameOverFiredRef.current = true;

    if (chess.isCheckmate()) {
      // The side to move is the one with no legal moves -- the other side won.
      const winner: 'w' | 'b' = chess.turn() === 'w' ? 'b' : 'w';
      onGameOverRef.current?.({ type: 'checkmate', winner });
    } else if (chess.isStalemate()) {
      onGameOverRef.current?.({ type: 'stalemate' });
    } else {
      const reason: DrawReason | undefined = chess.isInsufficientMaterial()
        ? 'insufficient'
        : chess.isThreefoldRepetition()
          ? 'repetition'
          : chess.isDrawByFiftyMoves()
            ? 'fiftyMove'
            : undefined;
      onGameOverRef.current?.({ type: 'draw', reason });
    }
  }

  // A wrong guess must never mutate the real chess.js position -- the board
  // stays put and only puzzleStatus flips, so the very next attempt still
  // retries against the same expected move (standard puzzle-trainer UX,
  // matching Lichess's own "try again" behavior rather than treating a
  // wrong guess as game over).
  function handlePuzzleAttempt(from: Square, to: Square, promotion?: 'q' | 'r' | 'b' | 'n') {
    if (!puzzle) return;
    const chess = chessRef.current;
    const expected = parseUciMove(puzzle.moves[puzzleMoveIndexRef.current]);
    // When the solution is a promotion, the chosen piece is part of the
    // answer (under-promotion puzzles are the whole point) -- a queen where a
    // knight was needed is just as wrong as the wrong square.
    if (from !== expected.from || to !== expected.to || (expected.promotion && promotion !== expected.promotion)) {
      playSound('illegal');
      refresh(null, 'failed');
      return;
    }
    try {
      recordMove(chess.move({ from, to, promotion: expected.promotion ?? 'q' }));
    } catch (error) {
      console.log('Puzzle move unexpectedly rejected by chess.js', error);
      playSound('illegal');
      refresh(null, 'failed');
      return;
    }
    puzzleMoveIndexRef.current += 1;
    const solved = puzzleMoveIndexRef.current >= puzzle.moves.length;
    // Deliberately never calls reportGameOverIfDone() -- some puzzles end in
    // real checkmate, and without this the final correct move would
    // spuriously fire onGameOver with real-match semantics that don't apply
    // here. Puzzle completion is signaled purely via puzzleStatus.
    refresh('human', solved ? 'solved' : 'playing');
  }

  // A wrong puzzle guess leaves puzzleStatus 'failed' purely to drive the
  // "Not quite -- try again" label; the position is untouched and still
  // retriable. Picking a piece back up to retry clears that label (flips
  // status back to 'playing') without moving anything. Puzzle-only.
  function clearFailedPuzzleStatus() {
    if (mode === 'puzzle' && puzzle && snapshot.puzzleStatus === 'failed') {
      refresh(null, 'playing');
    }
  }

  // The shared move-application path for a human move (tap, drag-drop, or a
  // promotion resolved by the picker) in bot/local/online. Puzzle attempts go
  // through handlePuzzleAttempt instead (they must never mutate on a wrong
  // guess). `promotion` is only meaningful for a pawn reaching the last rank.
  function applyLocalMove(from: Square, to: Square, promotion: 'q' | 'r' | 'b' | 'n' = 'q') {
    const chess = chessRef.current;
    try {
      recordMove(chess.move({ from, to, promotion }));
    } catch (error) {
      console.log('Unexpected illegal move rejected by chess.js', error);
      playSound('illegal');
      return;
    }
    recordMoveTiming();
    setDrawOfferFrom(null);
    refresh('human');
    reportGameOverIfDone();
    if (mode === 'online' && online) {
      // Applied locally already for instant feedback; this is the server's
      // authoritative copy. A rejection comes back as move:rejected (handled
      // in the online effect -- it resyncs from the server FEN).
      getSocket().emit('move:make', { matchId: online.matchId, from, to, promotion });
    }
  }

  // True if a from->to move for the currently selected piece is a promotion
  // (the player must still choose the piece). chess.js emits one verbose move
  // per promotion option, all sharing the same `to`.
  function isPromotionMove(from: Square, to: Square): boolean {
    return legalMoves.from(from).some((m) => m.to === to && Boolean(m.promotion));
  }

  function handleSquarePress(square: Square) {
    const chess = chessRef.current;
    if (chess.isGameOver()) return;
    // A promotion choice is pending -- ignore board taps until the picker is
    // answered (completePromotion / cancelPromotion).
    if (pendingPromotion) return;
    // Once a puzzle is solved (or its solution was revealed) there's nothing
    // left to do with further taps -- but a 'failed' guess stays retriable.
    if (mode === 'puzzle' && puzzle && (snapshot.puzzleStatus === 'solved' || snapshot.puzzleStatus === 'revealed'))
      return;
    // Online: only this device's own color may act, and only on its turn --
    // the opponent's moves arrive exclusively via the server (see the online
    // effect below), never through local taps.
    if (mode === 'online' && online && chess.turn() !== online.playerColor) return;
    // Bot: the human only controls the non-bot color, and never while it's the
    // bot's turn (including the pre-move "thinking" delay before the bot effect
    // applies its move). Local pass-and-play stays ungated -- two humans share
    // the one device.
    if (mode === 'bot' && chess.turn() === botColor) return;
    // Puzzle: scripted opponent replies (even indices) are auto-played by
    // the effect below, never through local taps.
    if (mode === 'puzzle' && puzzle && !isSolverTurnInPuzzle) return;

    if (selectedSquare) {
      if (legalTargets.includes(square)) {
        const from = selectedSquare;
        // A pawn reaching the last rank: hold the move and let the screen show
        // the piece picker. Keep the pre-move board (don't apply anything yet).
        if (isPromotionMove(from, square)) {
          setSelectedSquare(null);
          setPendingPromotion({ from, to: square });
          return;
        }
        setSelectedSquare(null);
        if (mode === 'puzzle' && puzzle) {
          handlePuzzleAttempt(from, square);
          return;
        }
        applyLocalMove(from, square);
        return;
      }

      const piece = chess.get(square);
      // Tapping a different piece of the side to move reselects instead of
      // moving; tapping anything else (empty/illegal/opponent piece) deselects.
      if (piece && piece.color === chess.turn()) {
        clearFailedPuzzleStatus();
        setSelectedSquare(square);
      } else {
        setSelectedSquare(null);
      }
      return;
    }

    const piece = chess.get(square);
    if (piece && piece.color === chess.turn()) {
      clearFailedPuzzleStatus();
      setSelectedSquare(square);
    }
  }

  // The PromotionPicker's four choices land here. In puzzle mode the picked
  // piece is validated against the solution; otherwise it's applied like any
  // human move.
  function completePromotion(piece: 'q' | 'r' | 'b' | 'n') {
    if (!pendingPromotion) return;
    const { from, to } = pendingPromotion;
    setPendingPromotion(null);
    if (mode === 'puzzle' && puzzle) {
      handlePuzzleAttempt(from, to, piece);
      return;
    }
    applyLocalMove(from, to, piece);
  }

  // Backing out of the picker -- nothing was applied, so just drop the pending
  // move; the player re-taps to try again.
  function cancelPromotion() {
    setPendingPromotion(null);
  }

  // Resets to the puzzle's starting position (re-applying the opponent's setup
  // move) -- the "Retry" action, and used after a "Give Up" reveal.
  function resetPuzzle() {
    if (!puzzle) return;
    chessRef.current = createPuzzleChess(puzzle);
    ledgerRef.current = deriveLedger(chessRef.current);
    puzzleMoveIndexRef.current = 1;
    // Otherwise a piece the solver had selected stays selected against the
    // reset position -- either a stuck highlight or, worse, the next tap gets
    // routed as a move from that stale square (spurious 'failed' + illegal sound).
    setSelectedSquare(null);
    refresh(null, 'playing');
  }

  // "Give Up": lock the puzzle in a terminal 'revealed' state; the effect
  // below then plays out the remaining solution one move at a time so the
  // player can watch the answer. Never records a solve (that's the point).
  function revealSolution() {
    if (mode !== 'puzzle' || !puzzle) return;
    if (snapshot.puzzleStatus === 'solved' || snapshot.puzzleStatus === 'revealed') return;
    setSelectedSquare(null);
    refresh(null, 'revealed');
  }

  function resign(resigningColor: 'w' | 'b') {
    if (gameOverFiredRef.current) return;
    if (mode === 'online' && online) {
      // Wait for the server's match:ended broadcast (below) rather than
      // firing locally -- it needs to reach the opponent too.
      getSocket().emit('match:resign', { matchId: online.matchId });
      return;
    }
    gameOverFiredRef.current = true;
    onGameOverRef.current?.({ type: 'resignation', winner: resigningColor === 'w' ? 'b' : 'w' });
  }

  // Draw offer -- structurally mirrors resign(). Online defers to the server's
  // authoritative match:ended (it must reach the opponent + persist); local
  // pass-and-play is mutual by definition so it ends immediately; bot has no
  // one to negotiate with (match.tsx hides the button for that mode).
  function offerDraw() {
    if (gameOverFiredRef.current) return;
    if (mode === 'online' && online) {
      getSocket().emit('draw:offer', { matchId: online.matchId });
      return;
    }
    if (mode === 'local') {
      gameOverFiredRef.current = true;
      onGameOverRef.current?.({ type: 'draw', agreed: true });
    }
  }

  function respondToDraw(accept: boolean) {
    if (mode === 'online' && online) {
      getSocket().emit('draw:respond', { matchId: online.matchId, accept });
    }
    setDrawOfferFrom(null);
  }

  // The clock (match.tsx's useChessClock) lives entirely outside this hook --
  // ticking on wall-clock time independent of any chess.js mutation would be
  // a real boundary violation of "thin chess.js mirror" (every other change
  // in this hook is move-triggered). This is the one narrow door it calls
  // through when a side's clock actually reaches 0, structurally mirroring
  // resign() exactly: online defers to the server's authoritative
  // match:ended (a client can't be trusted to declare its own opponent timed
  // out, or itself), bot/local fire immediately since nothing else could.
  function reportTimeout(flaggedColor: 'w' | 'b') {
    if (gameOverFiredRef.current) return;
    if (mode === 'online') return;
    gameOverFiredRef.current = true;
    const winner: 'w' | 'b' = flaggedColor === 'w' ? 'b' : 'w';
    // FIDE 6.9: a flag-fall is only a loss if the other side could still
    // checkmate. Bare king / K+N / K+B on time -> draw, not a win.
    if (!canDeliverMate(chessRef.current, winner)) {
      onGameOverRef.current?.({ type: 'draw', reason: 'insufficientVsTimeout' });
      return;
    }
    onGameOverRef.current?.({ type: 'timeout', winner });
  }

  useEffect(() => {
    if (mode !== 'online' || !online) return;
    const socket = getSocket();
    const chess = chessRef.current;
    const matchId = online.matchId;

    // Snap the local position back to whatever the server says is truth --
    // used both when the server rejects a move (we're desynced) and on a
    // reconnect resync. Rolls back any optimistic local move.
    function resyncFromServer(fen: string, clocks?: { w: number; b: number }) {
      try {
        chess.load(fen);
      } catch (error) {
        console.log('Failed to resync position from server FEN', error);
        return;
      }
      ledgerRef.current = deriveLedger(chess);
      setSelectedSquare(null);
      setPendingPromotion(null);
      setDrawOfferFrom(null);
      refresh(null);
      if (clocks) onClockSyncRef.current?.(clocks);
    }

    function handleMoveApplied(payload: MoveAppliedPayload) {
      // Called unconditionally, BEFORE the early-return below -- that guard
      // exists to skip re-applying a move the player already applied
      // optimistically themselves, but it would just as happily (and
      // wrongly) skip syncing clock data for the mover's own moves too,
      // since payload.turn after their own move never equals their own
      // color. The server's clocks are authoritative regardless of whose
      // move this was.
      onClockSyncRef.current?.(payload.clocks);

      // Our own moves are applied locally the instant the player taps (see
      // handleSquarePress) -- this broadcast only needs acting on when it's
      // the opponent's move, identifiable because the turn just became ours.
      if (!online || payload.turn !== online.playerColor) return;
      try {
        recordMove(chess.move({ from: payload.from, to: payload.to, promotion: payload.promotion ?? 'q' }));
      } catch (error) {
        console.log('Opponent move rejected unexpectedly', error);
      }
      setDrawOfferFrom(null);
      refresh('opponent');
      reportGameOverIfDone();
    }

    function handleMatchEnded(payload: MatchEndedPayload) {
      setDrawOfferFrom(null);
      if (gameOverFiredRef.current) return;
      gameOverFiredRef.current = true;
      // A broadcast "draw" is a negotiated one UNLESS the server tagged a
      // reason (today: a flag-fall where the winner couldn't mate -- FIDE
      // 6.9). chess.js-detected draws are derived client-side, never broadcast.
      const result: ChessGameResult =
        payload.result.type === 'draw'
          ? { type: 'draw', agreed: !payload.result.reason, reason: payload.result.reason }
          : payload.result;
      onGameOverRef.current?.(result);
    }

    function handleDrawOffered(payload: DrawOfferedPayload) {
      setDrawOfferFrom(payload.color);
    }
    function handleDrawGone() {
      setDrawOfferFrom(null);
    }

    // The server rejected our move -- we're out of sync with its position.
    // Snap back to the FEN it sent instead of dead-ending (every further move
    // would also be rejected).
    function handleMoveRejected(payload: MoveRejectedPayload) {
      if (payload.fen) resyncFromServer(payload.fen);
    }

    // Socket.IO fires 'connect' for every automatic reconnect after a network
    // blip (a fresh socket.id each time). Ask the server to seat us back in
    // the match -- without this the server's whole match:rejoin path is dead
    // code and a disconnect is force-forfeited after the 60s grace even
    // though we're back.
    function handleReconnect() {
      void getPlayerId().then((guestId) => socket.emit('match:rejoin', { matchId, guestId }));
    }

    // The server's response to match:rejoin (same event shape as the initial
    // pairing). Any queue:matched seen while this effect is mounted is a
    // rejoin -- the first one already fired back in matchmaking.tsx.
    function handleRejoined(payload: QueueMatchedPayload) {
      resyncFromServer(payload.fen, payload.clocks);
    }

    socket.on('move:applied', handleMoveApplied);
    socket.on('match:ended', handleMatchEnded);
    socket.on('draw:offered', handleDrawOffered);
    socket.on('draw:declined', handleDrawGone);
    socket.on('draw:cleared', handleDrawGone);
    socket.on('move:rejected', handleMoveRejected);
    socket.on('connect', handleReconnect);
    socket.on('queue:matched', handleRejoined);
    return () => {
      socket.off('move:applied', handleMoveApplied);
      socket.off('match:ended', handleMatchEnded);
      socket.off('draw:offered', handleDrawOffered);
      socket.off('draw:declined', handleDrawGone);
      socket.off('draw:cleared', handleDrawGone);
      socket.off('move:rejected', handleMoveRejected);
      socket.off('connect', handleReconnect);
      socket.off('queue:matched', handleRejoined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, online?.matchId]);

  useEffect(() => {
    if (mode !== 'bot') return;
    const chess = chessRef.current;
    // gameOverFiredRef covers the endings chess.js can't see (resign, agreed
    // draw, timeout) -- without this guard a resign during the bot's think
    // delay still lets the pending move land, animating a phantom bot move
    // over the result-screen transition.
    if (chess.isGameOver() || gameOverFiredRef.current || chess.turn() !== botColor) return;

    // The Stockfish tiers resolve asynchronously (a round trip through the
    // WebView), unlike easy/medium's synchronous lookups -- so the move can
    // arrive after this effect's own cleanup has already fired (unmount,
    // rapid state changes). `cancelled` stops it from being applied then,
    // which the old purely-synchronous version never had to guard against.
    let cancelled = false;
    const isStockfish =
      difficulty === 'stockfish-basic' || difficulty === 'stockfish-lite' || difficulty === 'stockfish-strong';
    const delay = isStockfish ? HARD_PRE_DELAY_MS : BOT_MOVE_DELAY_MS;

    const timeout = setTimeout(async () => {
      const move = await resolveBotMove(chess, difficulty, requestEngineMove);
      if (cancelled || !move || gameOverFiredRef.current) return;
      try {
        recordMove(chess.move(move));
      } catch (error) {
        console.log('Bot move rejected unexpectedly', error);
      }
      recordMoveTiming();
      refresh('bot');
      reportGameOverIfDone();
    }, delay);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, difficulty, botColor, snapshot]);

  // NOTE: this hook does not react to `puzzle` changing identity mid-mount --
  // puzzle-match.tsx wraps its body in a component keyed by puzzleId, so every
  // "Next Puzzle" is a fresh mount (fresh chessRef/ledger/indices). Any future
  // puzzle caller that does NOT remount per puzzle must add that keying.

  useEffect(() => {
    if (mode !== 'puzzle' || !puzzle) return;
    if (snapshot.puzzleStatus !== 'playing') return;
    const index = puzzleMoveIndexRef.current;
    // Even indices >= 2 are the opponent's scripted replies between solver
    // moves -- index 0 was already auto-played by createPuzzleChess, and odd
    // indices are the solver's own moves, applied via handlePuzzleAttempt.
    if (index === 0 || index % 2 !== 0 || index >= puzzle.moves.length) return;

    let cancelled = false;
    // Shorter than BOT_MOVE_DELAY_MS -- this isn't "thinking", just a beat
    // so the reply doesn't feel instant/jarring after the solver's move.
    const timeout = setTimeout(() => {
      if (cancelled) return;
      const chess = chessRef.current;
      try {
        recordMove(chess.move(parseUciMove(puzzle.moves[index])));
      } catch (error) {
        console.log('Puzzle opponent reply rejected unexpectedly', error);
      }
      puzzleMoveIndexRef.current += 1;
      const solved = puzzleMoveIndexRef.current >= puzzle.moves.length;
      refresh('opponent', solved ? 'solved' : 'playing');
    }, 500);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, puzzle, snapshot]);

  // "Give Up" reveal: once revealSolution() flips the status to 'revealed',
  // step through the remaining solution moves one at a time (same cadence as
  // the scripted-reply effect above) so the player watches the answer play
  // out. Each move is a single ply from the current position, so ChessBoard
  // animates it normally.
  useEffect(() => {
    if (mode !== 'puzzle' || !puzzle) return;
    if (snapshot.puzzleStatus !== 'revealed') return;
    const index = puzzleMoveIndexRef.current;
    if (index >= puzzle.moves.length) return; // whole line shown

    let cancelled = false;
    const timeout = setTimeout(() => {
      if (cancelled) return;
      try {
        recordMove(chessRef.current.move(parseUciMove(puzzle.moves[index])));
        puzzleMoveIndexRef.current += 1;
      } catch (error) {
        console.log('Puzzle solution move rejected while revealing', error);
        puzzleMoveIndexRef.current = puzzle.moves.length;
      }
      refresh('opponent', 'revealed');
    }, 650);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, puzzle, snapshot]);

  // Not part of GameSnapshot (like legalTargets) -- purely derived from the
  // puzzle's next expected move, for the puzzle screen's Hint button.
  const hintSquare = useMemo(() => {
    // Available while 'playing' AND after a wrong guess ('failed') -- a failed
    // attempt is fully retriable, so the hint must stay usable (this guard
    // used to also exclude 'failed', which silently disabled the Hint button
    // until the next correct move).
    if (mode !== 'puzzle' || !puzzle || snapshot.puzzleStatus === 'solved' || snapshot.puzzleStatus === 'revealed')
      return null;
    const index = puzzleMoveIndexRef.current;
    if (index >= puzzle.moves.length) return null;
    return parseUciMove(puzzle.moves[index]).from;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, puzzle, snapshot]);

  // The Hint button: just select the piece the solver should move. Must NOT go
  // through handleSquarePress(hintSquare) -- if the solver already has some
  // other piece selected that can legally reach hintSquare, that path treats
  // the press as a move and burns a (failed) attempt. Selecting directly can't.
  function revealHint() {
    if (mode !== 'puzzle' || !puzzle || !isSolverTurnInPuzzle || !hintSquare) return;
    clearFailedPuzzleStatus();
    setSelectedSquare(hintSquare);
  }

  // ---- Roadie Kit (Tour boss fights, bot mode only; see server/src/db/tour.ts) ----
  // Both helps work on the player's own turn only and never decide the game for them.

  // "Take Two": rewind to the position before the player's last move (undoes the bot's reply
  // and the move it answered). The clock is NOT given back -- the take costs real time.
  // The ledger is re-derived (a backwards step is the one place it can't be updated in O(1)),
  // and ChessBoard sees a non-forward change and snaps instead of animating.
  function takeBack(): boolean {
    if (mode !== 'bot' || gameOverFiredRef.current || pendingPromotion) return false;
    const chess = chessRef.current;
    const humanColor = botColor === 'w' ? 'b' : 'w';
    if (chess.isGameOver() || chess.turn() !== humanColor || chess.history().length < 2) return false;
    chess.undo();
    chess.undo();
    moveElapsedMsRef.current.splice(-2);
    ledgerRef.current = deriveLedger(chess);
    setSelectedSquare(null);
    setDrawOfferFrom(null);
    refresh(null);
    return true;
  }

  // "Roadie's Tip": the roadie's read of the position -- a medium-strength search, so a
  // decent move, not the best one. It only selects the PIECE to move (like the puzzle Hint);
  // where it goes and whether it is right is still the player's call.
  function suggestTip(): Square | null {
    if (mode !== 'bot' || gameOverFiredRef.current || pendingPromotion) return null;
    const chess = chessRef.current;
    const humanColor = botColor === 'w' ? 'b' : 'w';
    if (chess.isGameOver() || chess.turn() !== humanColor) return null;
    const move = pickHeuristicMove(chess);
    if (!move) return null;
    setSelectedSquare(move.from);
    return move.from;
  }

  // Bot/local/online -- match.tsx's handleGameOver reads this once at
  // game-over and hands it to localMatchReplayStore.ts for the immediate
  // post-match "Replay"/"Analyze Game" entry points (a *separate* thing
  // from online's existing server-backed replay reached later via Iron
  // ID's match history, which stays untouched -- see localMatchReplayStore.ts's
  // header comment for why the immediate post-game moment needs this
  // client-side capture instead of the persisted matches.id). null only
  // for puzzle (no replay concept there at all). moveElapsedMs is only
  // ever populated for bot/local (recordMoveTiming's own guard) -- online
  // callers just get an empty array here, which is fine since analysis
  // doesn't use timing at all, only useMatchReplay's auto-play pacing does.
  function getReplayData(): { pgn: string; moveElapsedMs: number[] } | null {
    if (mode !== 'bot' && mode !== 'local' && mode !== 'online') return null;
    return { pgn: chessRef.current.pgn(), moveElapsedMs: [...moveElapsedMsRef.current] };
  }

  return {
    board: snapshot.board,
    turn: snapshot.turn,
    checkSquare: snapshot.checkSquare,
    isGameOver: snapshot.isGameOver,
    capturedByWhite: snapshot.capturedByWhite,
    capturedByBlack: snapshot.capturedByBlack,
    moveCount: snapshot.moveCount,
    ply: snapshot.ply,
    lastMove: snapshot.lastMove,
    lastMoveSource: snapshot.lastMoveSource,
    lastMoveSound: snapshot.lastMoveSound,
    puzzleStatus: snapshot.puzzleStatus,
    hintSquare,
    revealHint,
    revealSolution,
    selectedSquare,
    legalTargets,
    pendingPromotion,
    completePromotion,
    cancelPromotion,
    handleSquarePress,
    resetPuzzle,
    resign,
    offerDraw,
    respondToDraw,
    drawOfferFrom,
    reportTimeout,
    getReplayData,
    takeBack,
    suggestTip,
  };
}
