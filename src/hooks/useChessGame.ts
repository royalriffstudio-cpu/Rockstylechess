import { Chess, type Square } from 'chess.js';
import { useEffect, useMemo, useRef, useState } from 'react';

import { resolveBotMove, type BotDifficulty, type RequestEngineMove } from '@/lib/botEngine';
import {
  boardGridFromChess,
  checkSquareFromChess,
  classifyMoveSound,
  pickVerboseLastMove,
  type MoveSoundKind,
  type VerboseLastMove,
} from '@/lib/chessBoardSnapshot';
import { getSocket } from '@/lib/socket';
import type { DrawOfferedPayload, MatchEndedPayload, MoveAppliedPayload } from '@/lib/onlineMatch';
import { parseUciMove } from '@/lib/puzzleEngine';
import { playSound } from '@/lib/soundEffects';

export type { BotDifficulty } from '@/lib/botEngine';

export type GameMode = 'bot' | 'local' | 'online' | 'puzzle';

export type ChessGameResult =
  | { type: 'checkmate'; winner: 'w' | 'b' }
  | { type: 'stalemate' }
  // `agreed` distinguishes a negotiated draw (players agreed) from a
  // chess.js-detected one (repetition, 50-move, insufficient material).
  | { type: 'draw'; agreed?: boolean }
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

export type PuzzleStatus = 'playing' | 'solved' | 'failed';

type LastMoveSource = 'human' | 'bot' | 'opponent' | null;

interface GameSnapshot {
  board: string[][];
  turn: 'w' | 'b';
  checkSquare: Square | null;
  isGameOver: boolean;
  capturedByWhite: string[];
  capturedByBlack: string[];
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

function buildSnapshot(chess: Chess, lastMoveSource: LastMoveSource, puzzleStatus: PuzzleStatus): GameSnapshot {
  const cells = chess.board();
  const board = boardGridFromChess(chess, cells);
  const turn = chess.turn();
  const checkSquare = checkSquareFromChess(chess, cells);

  const history = chess.history({ verbose: true });
  const capturedByWhite: string[] = [];
  const capturedByBlack: string[] = [];
  for (const move of history) {
    if (move.captured) {
      if (move.color === 'w') capturedByWhite.push(move.captured);
      else capturedByBlack.push(move.captured);
    }
  }

  const lastHistoryMove = history[history.length - 1];
  const lastMove = pickVerboseLastMove(lastHistoryMove);
  const lastMoveSound = classifyMoveSound(chess, lastHistoryMove);

  return {
    board,
    turn,
    checkSquare,
    isGameOver: chess.isGameOver(),
    capturedByWhite,
    capturedByBlack,
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
  const [snapshot, setSnapshot] = useState<GameSnapshot>(() => buildSnapshot(chessRef.current, null, 'playing'));
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
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

  const legalTargets = useMemo(() => {
    if (!selectedSquare) return [];
    return chessRef.current.moves({ square: selectedSquare, verbose: true }).map((move) => move.to);
  }, [selectedSquare, snapshot]);

  function refresh(source: LastMoveSource = null, puzzleStatus: PuzzleStatus = 'playing') {
    setSnapshot(buildSnapshot(chessRef.current, source, puzzleStatus));
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
      onGameOverRef.current?.({ type: 'draw' });
    }
  }

  // A wrong guess must never mutate the real chess.js position -- the board
  // stays put and only puzzleStatus flips, so the very next attempt still
  // retries against the same expected move (standard puzzle-trainer UX,
  // matching Lichess's own "try again" behavior rather than treating a
  // wrong guess as game over).
  function handlePuzzleAttempt(from: Square, to: Square) {
    if (!puzzle) return;
    const chess = chessRef.current;
    const expected = parseUciMove(puzzle.moves[puzzleMoveIndexRef.current]);
    if (from !== expected.from || to !== expected.to) {
      playSound('illegal');
      refresh(null, 'failed');
      return;
    }
    try {
      chess.move({ from, to, promotion: expected.promotion ?? 'q' });
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

  function handleSquarePress(square: Square) {
    const chess = chessRef.current;
    if (chess.isGameOver()) return;
    // Once a puzzle is solved there's nothing left to do with further taps
    // -- but a 'failed' guess stays retriable (see handlePuzzleAttempt).
    if (mode === 'puzzle' && puzzle && snapshot.puzzleStatus === 'solved') return;
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
        setSelectedSquare(null);
        if (mode === 'puzzle' && puzzle) {
          handlePuzzleAttempt(from, square);
          return;
        }
        try {
          // promotion is always auto-queened -- no under-promotion picker yet.
          chess.move({ from, to: square, promotion: 'q' });
        } catch (error) {
          console.log('Unexpected illegal move rejected by chess.js', error);
          playSound('illegal');
        }
        recordMoveTiming();
        setDrawOfferFrom(null);
        refresh('human');
        reportGameOverIfDone();
        if (mode === 'online' && online) {
          // Applied locally already for instant feedback; this is the
          // server's authoritative copy. A rejection here would only mean a
          // prior desync -- not handled beyond logging, see move:rejected below.
          getSocket().emit('move:make', { matchId: online.matchId, from, to: square, promotion: 'q' });
        }
        return;
      }

      const piece = chess.get(square);
      // Tapping a different piece of the side to move reselects instead of
      // moving; tapping anything else (empty/illegal/opponent piece) deselects.
      setSelectedSquare(piece && piece.color === chess.turn() ? square : null);
      return;
    }

    const piece = chess.get(square);
    if (piece && piece.color === chess.turn()) {
      setSelectedSquare(square);
    }
  }

  // Resets to the puzzle's starting position (re-applying the opponent's
  // setup move) -- used by the "Give Up"/retry action on the puzzle screen.
  function resetPuzzle() {
    if (!puzzle) return;
    chessRef.current = createPuzzleChess(puzzle);
    puzzleMoveIndexRef.current = 1;
    refresh(null, 'playing');
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
    onGameOverRef.current?.({ type: 'timeout', winner: flaggedColor === 'w' ? 'b' : 'w' });
  }

  useEffect(() => {
    if (mode !== 'online' || !online) return;
    const socket = getSocket();
    const chess = chessRef.current;

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
        chess.move({ from: payload.from, to: payload.to, promotion: payload.promotion ?? 'q' });
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
      // A server "draw" is always a negotiated one (chess.js-detected draws
      // are derived client-side from the move, never broadcast).
      const result: ChessGameResult =
        payload.result.type === 'draw' ? { type: 'draw', agreed: true } : payload.result;
      onGameOverRef.current?.(result);
    }

    function handleDrawOffered(payload: DrawOfferedPayload) {
      setDrawOfferFrom(payload.color);
    }
    function handleDrawGone() {
      setDrawOfferFrom(null);
    }

    socket.on('move:applied', handleMoveApplied);
    socket.on('match:ended', handleMatchEnded);
    socket.on('draw:offered', handleDrawOffered);
    socket.on('draw:declined', handleDrawGone);
    socket.on('draw:cleared', handleDrawGone);
    return () => {
      socket.off('move:applied', handleMoveApplied);
      socket.off('match:ended', handleMatchEnded);
      socket.off('draw:offered', handleDrawOffered);
      socket.off('draw:declined', handleDrawGone);
      socket.off('draw:cleared', handleDrawGone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, online?.matchId]);

  useEffect(() => {
    if (mode !== 'bot') return;
    const chess = chessRef.current;
    if (chess.isGameOver() || chess.turn() !== botColor) return;

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
      if (cancelled || !move) return;
      try {
        chess.move(move);
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
        chess.move(parseUciMove(puzzle.moves[index]));
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

  // Not part of GameSnapshot (like legalTargets) -- purely derived from the
  // puzzle's next expected move, for the puzzle screen's Hint button.
  const hintSquare = useMemo(() => {
    if (mode !== 'puzzle' || !puzzle || snapshot.puzzleStatus !== 'playing') return null;
    const index = puzzleMoveIndexRef.current;
    if (index >= puzzle.moves.length) return null;
    return parseUciMove(puzzle.moves[index]).from;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, puzzle, snapshot]);

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
    lastMove: snapshot.lastMove,
    lastMoveSource: snapshot.lastMoveSource,
    lastMoveSound: snapshot.lastMoveSound,
    puzzleStatus: snapshot.puzzleStatus,
    hintSquare,
    selectedSquare,
    legalTargets,
    handleSquarePress,
    resetPuzzle,
    resign,
    offerDraw,
    respondToDraw,
    drawOfferFrom,
    reportTimeout,
    getReplayData,
  };
}
