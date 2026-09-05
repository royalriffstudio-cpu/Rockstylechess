import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  makeMutable,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  type EasingFunction,
  type SharedValue,
} from 'react-native-reanimated';

import { BoardSquares, Colors, withOpacity } from '@/constants/theme';
import type { MoveSoundKind, VerboseLastMove } from '@/lib/chessBoardSnapshot';
import { playSound } from '@/lib/soundEffects';

import { getPieceSprites, type PieceSpriteMap } from './pieceSprites';

// Standard starting position. Uppercase = white, lowercase = black, '' = empty.
// Default board when no `board` prop is given -- this is what keeps Front
// Row (Spectate) rendering exactly as before: it doesn't pass any of the new
// interactivity props, so it still just shows this static position.
const STARTING_BOARD: string[][] = [
  ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'],
  ['p', 'p', 'p', 'p', 'p', 'p', 'p', 'p'],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['', '', '', '', '', '', '', ''],
  ['P', 'P', 'P', 'P', 'P', 'P', 'P', 'P'],
  ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'],
];

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Minimal shape ChessBoard needs from a theme -- BoardTheme (constants/boardThemes.ts) satisfies this directly. */
export interface ChessBoardTheme {
  squares: { light: readonly string[]; dark: readonly string[] };
  glowColor: string;
}

const DEFAULT_BOARD_THEME: ChessBoardTheme = {
  squares: BoardSquares,
  glowColor: Colors.cyan,
};

const DEFAULT_PIECE_SPRITES: PieceSpriteMap = getPieceSprites('classic-pieces');

function squareAt(rowIndex: number, colIndex: number): string {
  return `${FILES[colIndex]}${8 - rowIndex}`;
}

// The 64 square ids, built once -- the 8x8 render map indexes this instead of
// rebuilding `"e4"` strings on every board render.
const SQUARE_IDS: string[][] = Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => squareAt(r, c)));

// Static frame-gradient inputs, hoisted so the board's render doesn't
// reallocate these array/object literals every time it re-renders.
const FRAME_COLORS = [Colors.chrome, Colors.chromeMid, Colors.chrome, Colors.chromeDark, Colors.chromeMid] as const;
const FRAME_LOCATIONS = [0, 0.22, 0.5, 0.82, 1] as const;
const FRAME_START = { x: 0.1, y: 0 } as const;
const FRAME_END = { x: 0.9, y: 1 } as const;
const BEVEL_COLORS = [withOpacity(Colors.chrome, 0.95), withOpacity(Colors.chrome, 0), withOpacity(Colors.bgBase, 0.35)] as const;
const BEVEL_LOCATIONS = [0, 0.35, 1] as const;

function squareToRowCol(square: string): [row: number, col: number] {
  const col = FILES.indexOf(square[0]);
  const row = 8 - Number(square[1]);
  return [row, col];
}

// Canonical (row 0 = rank 8, col 0 = file a) <-> on-screen "display" coords.
// When the local player controls Black the board renders rotated 180deg, so
// every canonical row/col maps to `7 - itself`. Self-inverse: display -> canonical
// is the same call. Canonical space stays the single source of truth for every
// square string, `board` index, and `LivePiece.square`; only the shared-value
// positions and the visual grid order are kept in display space.
function flipIndex(v: number, flipped: boolean): number {
  return flipped ? 7 - v : v;
}
function displayRowCol(square: string, flipped: boolean): [row: number, col: number] {
  const [r, c] = squareToRowCol(square);
  return [flipIndex(r, flipped), flipIndex(c, flipped)];
}

/**
 * A piece with a stable identity that persists across moves. This, not the
 * `board` grid, is what PieceLayer renders: each entry is hosted by exactly
 * one BoardPiece for its entire lifetime on the board (created once, never
 * unmounted/remounted just for changing squares) and repositioned via
 * animated transform. See the lastMove-driven reconciliation effect below,
 * which is the only thing that ever creates, moves, or removes an entry.
 */
interface LivePiece {
  id: number;
  /** chess.js letter, case = color, e.g. 'K'/'q'. */
  type: string;
  square: string;
}

/**
 * A captured piece animating out before being discarded -- structurally the
 * direct descendant of the old MoveGhost/`slides` queue this replaces: one
 * instance per capture, keyed by its own id, so two overlapping captures
 * (e.g. rapid online opponent moves) can never share or stomp each other's
 * animation state.
 */
interface DyingGhost {
  id: number;
  type: string;
  square: string;
}

/**
 * A LivePiece's animated pixel position (in row/col units, not pixels --
 * BoardPiece multiplies by the live square size itself). Created once per
 * id via `makeMutable` (not `useSharedValue`, since these are born/destroyed
 * dynamically as pieces are captured/promoted/reset, not tied to a single
 * component's mount lifetime) and mutated in place thereafter. Lives in a
 * ref Map at the ChessBoard level rather than inside BoardPiece itself so
 * both the drag gesture (owned by Square) and the reconciliation effect can
 * reach a specific piece's position without prop-drilling a different
 * object identity through BoardPiece on every unrelated render -- which
 * would defeat BoardPiece's memo below.
 */
interface PiecePosition {
  row: SharedValue<number>;
  col: SharedValue<number>;
  scale: SharedValue<number>;
}

// Per-MoveSoundKind travel feel -- replaces one flat duration for every move
// with something that reads differently for a quiet shuffle vs. a capture
// landing with force, while staying short enough (all well under half a
// second) that gameplay never feels sluggish regardless of which sound is
// playing. The "big" sound moments (check/checkmate) get their drama from
// the decoupled CheckPulse/CheckmateFlourish effects below, not from
// slowing down piece travel itself.
const ANIMATION_CONFIG: Record<MoveSoundKind, { duration: number; easing: EasingFunction }> = {
  move: { duration: 360, easing: Easing.out(Easing.cubic) },
  capture: { duration: 340, easing: Easing.out(Easing.cubic) },
  castle: { duration: 420, easing: Easing.out(Easing.cubic) },
  check: { duration: 380, easing: Easing.out(Easing.cubic) },
  checkmate: { duration: 400, easing: Easing.out(Easing.cubic) },
};
// A local tap-to-move (no drag) previously teleported instantly -- now it
// gets a quick, deliberately-shorter-than-ANIMATION_CONFIG settle so
// identity/position updates are never an instant snap, without slowing down
// a move the player already committed to by tapping.
const LOCAL_TAP_SETTLE = { duration: 180, easing: Easing.out(Easing.cubic) };
const DRAG_SETTLE_SPRING = { damping: 16, stiffness: 220, mass: 0.9 };
// Sits inside the ~570ms capture sound's initial transient.
const CAPTURE_OUT_DURATION_MS = 260;
const CHECK_PULSE_DURATION_MS = 2000;
const CHECKMATE_FLOURISH_DURATION_MS = 2000;

const CASTLE_ROOK_SQUARES: Record<'w' | 'b', Record<'k' | 'q', readonly [string, string]>> = {
  w: { k: ['h1', 'f1'], q: ['a1', 'd1'] },
  b: { k: ['h8', 'f8'], q: ['a8', 'd8'] },
};

function typeMatches(type: string, piece: string, color: 'w' | 'b'): boolean {
  return type === (color === 'w' ? piece.toUpperCase() : piece);
}

// En passant's captured pawn never sits on the move's `to` square -- it's on
// the same file as `to`, same rank as `from`.
function enPassantCapturedSquare(move: VerboseLastMove): string {
  return move.to[0] + move.from[1];
}

// Cheap O(64) guard: does the reconciled piece list actually match what the
// authoritative board grid says is on every square? Fast-path reconciliation
// (below) validates its own output against this before it's trusted -- on
// any mismatch the caller falls back to a full resync rather than render a
// board that's silently wrong.
function boardMatchesLivePieces(board: string[][], pieces: LivePiece[]): boolean {
  let expectedCount = 0;
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      if (board[row][col]) expectedCount++;
    }
  }
  if (pieces.length !== expectedCount) return false;
  for (const piece of pieces) {
    const [row, col] = squareToRowCol(piece.square);
    if (board[row]?.[col] !== piece.type) return false;
  }
  return true;
}

interface ReconcileOutcome {
  pieces: LivePiece[];
  dying: DyingGhost[];
}

// The common case: a single incremental move applied on top of an
// already-correct `prev` piece list. Resolves normal moves, captures
// (including en passant), castling (both king AND rook, in one pass), and
// promotion, entirely from chess.js's own verbose move fields -- no
// board-diffing ambiguity. Returns null if anything doesn't resolve cleanly
// (piece not found where expected, result doesn't match `board`), which
// tells the caller to fall back to resyncFromBoard instead.
function tryFastPath(
  prev: LivePiece[],
  move: VerboseLastMove,
  board: string[][],
  makeGhostId: () => number,
): ReconcileOutcome | null {
  const mover = prev.find((p) => p.square === move.from && typeMatches(p.type, move.piece, move.color));
  if (!mover) return null;

  const byId = new Map(prev.map((p) => [p.id, p] as const));
  const dying: DyingGhost[] = [];

  if (move.captured) {
    const capturedSquare = move.flags.includes('e') ? enPassantCapturedSquare(move) : move.to;
    const capturedPiece = prev.find((p) => p.square === capturedSquare && p.id !== mover.id);
    if (!capturedPiece) return null;
    byId.delete(capturedPiece.id);
    dying.push({ id: makeGhostId(), type: capturedPiece.type, square: capturedPiece.square });
  }

  const promotedType = move.promotion
    ? move.color === 'w'
      ? move.promotion.toUpperCase()
      : move.promotion
    : mover.type;
  byId.set(mover.id, { ...mover, square: move.to, type: promotedType });

  if (move.flags.includes('k') || move.flags.includes('q')) {
    const side = move.flags.includes('k') ? 'k' : 'q';
    const [rookFrom, rookTo] = CASTLE_ROOK_SQUARES[move.color][side];
    const rookType = move.color === 'w' ? 'R' : 'r';
    const rook = prev.find((p) => p.square === rookFrom && p.type === rookType);
    if (!rook) return null;
    byId.set(rook.id, { ...rook, square: rookTo });
  }

  const pieces = Array.from(byId.values());
  if (!boardMatchesLivePieces(board, pieces)) return null;
  return { pieces, dying };
}

// Fallback for anything the fast path can't (or shouldn't) resolve cleanly:
// initial mount, a game/puzzle reset, or a non-forward replay scrub. Matches
// each occupied board square to a same-type leftover piece from `prev`
// (exact square+type match first, then any same-type piece) so ids -- and
// therefore mounted Images -- are reused wherever possible even across a
// jump, rather than every piece getting a fresh id. Never produces
// DyingGhosts (no coherent single-move story to animate a capture out for);
// callers snap these into place instantly instead of animating.
function resyncFromBoard(prev: LivePiece[], board: string[][], makePieceId: () => number): LivePiece[] {
  const remaining = prev.slice();
  const next: LivePiece[] = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const type = board[row][col];
      if (!type) continue;
      const square = squareAt(row, col);
      let idx = remaining.findIndex((p) => p.square === square && p.type === type);
      if (idx === -1) idx = remaining.findIndex((p) => p.type === type);
      if (idx !== -1) {
        const [claimed] = remaining.splice(idx, 1);
        next.push({ ...claimed, square });
      } else {
        next.push({ id: makePieceId(), type, square });
      }
    }
  }
  return next;
}

interface ChessBoardProps {
  style?: StyleProp<ViewStyle>;
  /** Defaults to the static starting position (Front Row's read-only usage). */
  board?: string[][];
  selectedSquare?: string | null;
  /** Algebraic squares the selected piece can legally move to. */
  legalTargets?: string[];
  /** Algebraic square of the king currently in check, if any. */
  checkSquare?: string | null;
  /** The most recently played move, highlighted like chess.com and used to drive piece-travel animation. */
  lastMove?: VerboseLastMove | null;
  /** Whose turn it is -- gates which pieces show the "pick up" drag affordance. */
  turn?: 'w' | 'b';
  /**
   * Play the full per-kind travel animation the next time `lastMove`
   * changes (see ANIMATION_CONFIG). Only pass this for moves the player
   * didn't just drag/tap themselves (e.g. the bot's moves) -- the player's
   * own moves get a shorter settle instead (their tap/drag already implies
   * intent instantly), UNLESS the move is a castle, whose rook never gets
   * direct gesture feedback even on the player's own move.
   */
  animateLastMove?: boolean;
  /**
   * Sound cue to play the next time `lastMove` changes -- unlike
   * `animateLastMove`, this fires for every new move regardless of source,
   * including the player's own gesture-driven moves (they still want to
   * hear their own move land).
   */
  lastMoveSound?: MoveSoundKind | null;
  /** Omit to keep the board read-only/static, e.g. Front Row's spectate view. */
  onSquarePress?: (square: string) => void;
  /** Square colors + glow accent. Defaults to the original fixed look. */
  theme?: ChessBoardTheme;
  /** Piece sprite set (12 images keyed 'wk'..'bp'). Defaults to the classic set. */
  pieceSprites?: PieceSpriteMap;
  /**
   * Render the board rotated 180deg -- pass `true` when the local player
   * controls the Black pieces so their own pieces sit at the bottom. Pieces
   * and coordinate labels stay upright (this is a coordinate transform, not a
   * `rotate`). FIXED for the component's lifetime: `/match` remounts per game
   * and a player's color never changes mid-game, so already-seeded piece
   * positions are not re-derived if this changes at runtime. Defaults to
   * `false` -- every non-match caller keeps the White-at-bottom view.
   */
  flipped?: boolean;
}

export const ChessBoard = memo(function ChessBoard({
  style,
  board = STARTING_BOARD,
  selectedSquare = null,
  legalTargets = [],
  checkSquare = null,
  lastMove = null,
  turn,
  animateLastMove = false,
  lastMoveSound = null,
  onSquarePress,
  theme = DEFAULT_BOARD_THEME,
  pieceSprites = DEFAULT_PIECE_SPRITES,
  flipped = false,
}: ChessBoardProps) {
  const [gridSize, setGridSize] = useState(0);
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  // -1 = no piece currently being dragged. A shared value (not React state)
  // so BoardPiece's drag/non-drag render branch switches on the UI thread
  // with no cross-thread latency -- see handleGrab/bakeDraggedPosition below.
  const draggingIdSV = useSharedValue(-1);

  // Exact 8x8. Squares are laid out at an integer pixel size rather than with
  // flex:1, because eight flex children of a fractional width get rounded
  // independently -- squares end up a pixel wider or narrower than their
  // neighbours and the file boundaries stop lining up down the board. Flooring
  // to a whole number and sizing the grid to 8x that keeps every square
  // identical and perfectly square; the few leftover pixels go to the frame.
  const squareSize = Math.floor(gridSize / 8);
  const boardSize = squareSize * 8;
  const interactive = Boolean(onSquarePress);

  // Kept in sync with squareSize so every piece's position worklet reads a
  // live value instead of one frozen at animation-start -- absorbs a board
  // resize mid-flight (extra layout passes settling, especially prone to
  // happening more than once on Android) instead of producing a snap.
  const squareSizeShared = useSharedValue(squareSize);
  useEffect(() => {
    squareSizeShared.value = squareSize;
  }, [squareSize, squareSizeShared]);

  const nextPieceIdRef = useRef(0);
  const nextGhostIdRef = useRef(0);

  // The persistent piece list PieceLayer renders. Reconciled incrementally
  // (never rebuilt wholesale from `board`) by the lastMove-driven effect
  // below -- see LivePiece's own comment for why this, not `board`, is what
  // actually fixes pieces reloading on every move.
  const [livePieces, setLivePieces] = useState<LivePiece[]>(() =>
    resyncFromBoard([], board, () => nextPieceIdRef.current++),
  );
  const [dyingGhosts, setDyingGhosts] = useState<DyingGhost[]>([]);
  const livePiecesRef = useRef(livePieces);
  livePiecesRef.current = livePieces;

  // Per-id animated position, created once per LivePiece id and mutated in
  // place thereafter -- see PiecePosition's own comment for why this lives
  // here rather than inside BoardPiece. Populated during render (not only in
  // an effect) so the very first paint already has a valid entry for every
  // piece in `livePieces` -- including the lazy useState initializer above,
  // which runs before any effect has had a chance to run -- rather than
  // pieces popping in a frame late on mount.
  const positionsRef = useRef<Map<number, PiecePosition>>(new Map());
  for (const piece of livePieces) {
    if (!positionsRef.current.has(piece.id)) {
      const [row, col] = displayRowCol(piece.square, flipped);
      positionsRef.current.set(piece.id, { row: makeMutable(row), col: makeMutable(col), scale: makeMutable(1) });
    }
  }

  const prevLastMoveRef = useRef<VerboseLastMove | null>(null);
  const [checkEffectId, setCheckEffectId] = useState(0);
  const [checkmateEffectId, setCheckmateEffectId] = useState(0);

  // Freezes whatever's currently being dragged at its exact released pixel
  // position (converted into the same row/col units `position` is tracked
  // in) and clears drag state, WITHOUT deciding where it settles next --
  // that's the caller's job. Used both for a no-op drop (same square) and,
  // inside the reconciliation effect below, ahead of finding out whether the
  // pending move actually landed somewhere new or got rejected. Doing the
  // freeze here (JS thread, synchronous with the state updates that follow
  // in the same callback) rather than resetting drag state directly in the
  // gesture worklet is what avoids a one-frame flash back to the origin
  // square -- the same class of Android-timing issue the old ghost-swap
  // drag system had to account for.
  const bakeDraggedPosition = useCallback((): number => {
    const draggedId = draggingIdSV.value;
    if (draggedId !== -1) {
      const pos = positionsRef.current.get(draggedId);
      if (pos && squareSize > 0) {
        pos.col.value += dragX.value / squareSize;
        pos.row.value += dragY.value / squareSize;
      }
      dragX.value = 0;
      dragY.value = 0;
      draggingIdSV.value = -1;
    }
    return draggedId;
  }, [draggingIdSV, dragX, dragY, squareSize]);

  const settleDraggedPieceHome = useCallback(
    (id: number) => {
      if (id === -1) return;
      const pos = positionsRef.current.get(id);
      const piece = livePiecesRef.current.find((p) => p.id === id);
      if (!pos || !piece) return;
      const [r, c] = displayRowCol(piece.square, flipped);
      pos.row.value = withSpring(r, DRAG_SETTLE_SPRING);
      pos.col.value = withSpring(c, DRAG_SETTLE_SPRING);
    },
    [flipped],
  );

  const handleGhostDone = useCallback((id: number) => {
    setDyingGhosts((prev) => prev.filter((g) => g.id !== id));
  }, []);

  // The single place sound, the check/checkmate secondary effects, and
  // piece-identity reconciliation all fire from -- keeps sound-start and
  // animation-start synchronized in time, same as before this rework.
  // useLayoutEffect (not useEffect): commits synchronously with the same
  // render that changed board/lastMove, before paint.
  useLayoutEffect(() => {
    const draggedId = bakeDraggedPosition();

    const prevMove = prevLastMoveRef.current;
    prevLastMoveRef.current = lastMove;
    const isNewMove =
      lastMove !== null && (!prevMove || prevMove.from !== lastMove.from || prevMove.to !== lastMove.to);

    if (isNewMove && lastMoveSound) playSound(lastMoveSound);
    if (isNewMove && lastMoveSound === 'check' && checkSquare) setCheckEffectId((id) => id + 1);
    if (isNewMove && lastMoveSound === 'checkmate') setCheckmateEffectId((id) => id + 1);

    const fastOutcome =
      isNewMove && lastMove
        ? tryFastPath(livePiecesRef.current, lastMove, board, () => nextGhostIdRef.current++)
        : null;

    let outcome: ReconcileOutcome;
    let animated: boolean;

    if (fastOutcome) {
      outcome = fastOutcome;
      animated = true;
    } else if (boardMatchesLivePieces(board, livePiecesRef.current)) {
      // Nothing about the position actually changed (e.g. a rejected/
      // illegal attempt, which still triggers a refresh()) -- nothing to
      // reconcile. If a drag was just frozen above with nowhere new to go,
      // settle it back home; that's the only loose end.
      settleDraggedPieceHome(draggedId);
      return;
    } else {
      outcome = { pieces: resyncFromBoard(livePiecesRef.current, board, () => nextPieceIdRef.current++), dying: [] };
      animated = false;
    }

    const isCastleMove = Boolean(lastMove && (lastMove.flags.includes('k') || lastMove.flags.includes('q')));

    for (const piece of outcome.pieces) {
      const prevPiece = livePiecesRef.current.find((p) => p.id === piece.id);
      if (!positionsRef.current.has(piece.id)) {
        const [r, c] = displayRowCol(piece.square, flipped);
        positionsRef.current.set(piece.id, { row: makeMutable(r), col: makeMutable(c), scale: makeMutable(1) });
        continue; // brand new piece, already placed at its current square
      }
      if (prevPiece && prevPiece.square === piece.square && prevPiece.type === piece.type) continue; // unchanged

      const pos = positionsRef.current.get(piece.id)!;
      const [r, c] = displayRowCol(piece.square, flipped);

      if (!animated) {
        pos.row.value = r;
        pos.col.value = c;
        continue;
      }

      if (piece.id === draggedId) {
        pos.row.value = withSpring(r, DRAG_SETTLE_SPRING);
        pos.col.value = withSpring(c, DRAG_SETTLE_SPRING);
        continue;
      }

      const config = isCastleMove
        ? ANIMATION_CONFIG.castle
        : animateLastMove
          ? ANIMATION_CONFIG[lastMoveSound ?? 'move']
          : LOCAL_TAP_SETTLE;
      pos.row.value = withTiming(r, config);
      pos.col.value = withTiming(c, config);

      const promoted = Boolean(prevPiece && prevPiece.type !== piece.type);
      pos.scale.value = promoted
        ? withSequence(withTiming(1.3, { duration: 150 }), withTiming(1, { duration: 150 }))
        : withSequence(
            withTiming(0.94, { duration: config.duration * 0.4 }),
            withSpring(1, { damping: 10, stiffness: 200 }),
          );
    }

    if (outcome.dying.length) {
      setDyingGhosts((prev) => [...prev, ...outcome.dying]);
    }
    setLivePieces(outcome.pieces);
    // squareSize is read (for the drag-bake division) but deliberately not a
    // dependency -- a resize mid-drag is rare and re-running this whole
    // reconciliation on every resize would be wasted work; it already reads
    // the live value via closure each time the effect actually runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, lastMove, animateLastMove, lastMoveSound, checkSquare, flipped]);

  const handleGridLayout = useCallback((event: LayoutChangeEvent) => {
    setGridSize(Math.min(event.nativeEvent.layout.width, event.nativeEvent.layout.height));
  }, []);

  // Stable identities so the 64 memo(Square)s -- and the 3 Gesture objects each
  // builds -- don't rebuild on every ChessBoard render (they change only when
  // `onSquarePress` itself does, i.e. on a square selection).
  const handleTapSquare = useCallback(
    (square: string) => {
      onSquarePress?.(square);
    },
    [onSquarePress],
  );

  const handleGrab = useCallback(
    (square: string) => {
      dragX.value = 0;
      dragY.value = 0;
      const livePiece = livePiecesRef.current.find((p) => p.square === square);
      if (livePiece) draggingIdSV.value = livePiece.id;
      onSquarePress?.(square);
    },
    [onSquarePress, dragX, dragY, draggingIdSV],
  );

  const handleDrop = useCallback(
    (fromSquare: string, deltaRow: number, deltaCol: number) => {
      // deltaRow/deltaCol come from the pan gesture in screen space; the dragged
      // piece is tracked in display space, so screen-right is always +col and
      // screen-down always +row regardless of `flipped`. Do the arithmetic in
      // display space (clamp on-board there) then map back to a canonical square.
      const [fromRow, fromCol] = squareToRowCol(fromSquare);
      const targetDispRow = Math.min(7, Math.max(0, flipIndex(fromRow, flipped) + deltaRow));
      const targetDispCol = Math.min(7, Math.max(0, flipIndex(fromCol, flipped) + deltaCol));
      const targetSquare = squareAt(flipIndex(targetDispRow, flipped), flipIndex(targetDispCol, flipped));
      if (targetSquare !== fromSquare) {
        // A real attempt (legal or not) -- the reconciliation effect above
        // resolves where this piece's drag ends up, once refresh() lands.
        onSquarePress?.(targetSquare);
        return;
      }
      // Dropped back where it started -- no state change is coming, so there's
      // nothing to wait on; resolve the drag right here.
      settleDraggedPieceHome(bakeDraggedPosition());
    },
    [onSquarePress, settleDraggedPieceHome, bakeDraggedPosition, flipped],
  );

  return (
    <View style={[styles.boardWrap, style]}>
      <View style={styles.frameSlot}>
        <GlowRing color={theme.glowColor} />

        <LinearGradient
          // Brushed-metal frame: the extra mid stops give it a bright top-left
          // edge and a rolled-off bottom-right, so it reads as a machined bezel
          // rather than a flat two-tone band.
          colors={FRAME_COLORS}
          locations={FRAME_LOCATIONS}
          start={FRAME_START}
          end={FRAME_END}
          style={styles.boardFrame}
        >
          {/* Bevel: a bright inner highlight down the top edge and a dark
              recess at the bottom, so the playfield looks inset into the frame. */}
          <LinearGradient
            pointerEvents="none"
            colors={BEVEL_COLORS}
            locations={BEVEL_LOCATIONS}
            style={styles.frameBevel}
          />

          <Rivet style={{ top: 6, left: 6 }} />
          <Rivet style={{ top: 6, right: 6 }} />
          <Rivet style={{ bottom: 6, left: 6 }} />
          <Rivet style={{ bottom: 6, right: 6 }} />

          <View style={styles.gridWrapper} onLayout={handleGridLayout}>
            {/* Sized to the exact 8x8 so the sheen and the drag ghost share the
                grid's coordinate space -- the leftover pixels from flooring sit
                outside this box, against the frame. */}
            <View style={boardSize > 0 ? { width: boardSize, height: boardSize } : undefined}>
            {/* `board` is iterated in canonical order (rank 8 first, file a
                first) so `square`/`isLight`/labels stay canonical; when flipped,
                the visual order is reversed with flexDirection so pieces and
                labels stay upright (a `rotate` would flip them). */}
            <View style={[styles.boardGrid, flipped && styles.boardGridFlipped]}>
              {board.map((rowPieces, rowIndex) => (
                <View key={rowIndex} style={[styles.boardRow, flipped && styles.boardRowFlipped]}>
                  {rowPieces.map((piece, colIndex) => {
                    const square = SQUARE_IDS[rowIndex][colIndex];
                    const isLight = (rowIndex + colIndex) % 2 === 0;
                    const isWhitePiece = piece !== '' && piece === piece.toUpperCase();
                    const canDrag =
                      interactive && piece !== '' && (!turn || isWhitePiece === (turn === 'w'));

                    return (
                      <Square
                        key={colIndex}
                        square={square}
                        squareColor={
                          // Screen-fixed: the per-rank tones were sampled with a
                          // top-of-screen light (matching the frame bevel/glow),
                          // so they must not rotate under the pieces.
                          (isLight ? theme.squares.light : theme.squares.dark)[flipIndex(rowIndex, flipped)]
                        }
                        isLight={isLight}
                        isSelected={square === selectedSquare}
                        isLegalTarget={legalTargets.includes(square)}
                        isCapture={legalTargets.includes(square) && piece !== ''}
                        isCheck={square === checkSquare}
                        isLastMove={lastMove !== null && (square === lastMove.from || square === lastMove.to)}
                        showRankLabel={colIndex === (flipped ? 7 : 0)}
                        rankLabel={8 - rowIndex}
                        showFileLabel={rowIndex === (flipped ? 0 : 7)}
                        fileLabel={FILES[colIndex]}
                        squareSize={squareSize}
                        interactive={interactive}
                        canDrag={canDrag}
                        dragX={dragX}
                        dragY={dragY}
                        onTapSquare={handleTapSquare}
                        onGrab={handleGrab}
                        onDrop={handleDrop}
                      />
                    );
                  })}
                </View>
              ))}
            </View>

            {/* No sheen overlay here any more. The per-rank square colors above
                are sampled from the reference and already carry its lighting, so
                a second gradient on top double-counted it -- darkening the lower
                board past the render and washing out the upper. */}

            {squareSize > 0 ? (
              <>
                {dyingGhosts.map((ghost) => (
                  <DyingPieceGhost
                    key={`ghost-${ghost.id}`}
                    id={ghost.id}
                    type={ghost.type}
                    square={ghost.square}
                    flipped={flipped}
                    squareSize={squareSize}
                    squareSizeShared={squareSizeShared}
                    pieceSprites={pieceSprites}
                    onDone={handleGhostDone}
                  />
                ))}

                <PieceLayer
                  pieces={livePieces}
                  positions={positionsRef.current}
                  squareSize={squareSize}
                  squareSizeShared={squareSizeShared}
                  pieceSprites={pieceSprites}
                  draggingIdSV={draggingIdSV}
                  dragX={dragX}
                  dragY={dragY}
                />

                {checkSquare && checkEffectId > 0 ? (
                  <CheckPulse
                    key={`check-${checkEffectId}`}
                    checkSquare={checkSquare}
                    flipped={flipped}
                    squareSize={squareSize}
                    squareSizeShared={squareSizeShared}
                  />
                ) : null}

                {checkmateEffectId > 0 ? <CheckmateFlourish key={`mate-${checkmateEffectId}`} boardSize={boardSize} /> : null}
              </>
            ) : null}
            </View>
          </View>
        </LinearGradient>
      </View>
    </View>
  );
});

// Cross-platform outer glow. React Native's colored `boxShadow` is unreliable
// on Android, so the cyan halo in the reference is built as three concentric
// rounded layers behind the frame with falling opacity -- a real layered glow
// that renders identically on both platforms.
function GlowRing({ color }: { color: string }) {
  return (
    <>
      <View
        style={[
          styles.glowLayer,
          styles.glowOuterShape,
          { borderColor: withOpacity(color, 0.08), backgroundColor: withOpacity(color, 0.05) },
        ]}
      />
      <View
        style={[
          styles.glowLayer,
          styles.glowMidShape,
          { borderColor: withOpacity(color, 0.18), backgroundColor: withOpacity(color, 0.09) },
        ]}
      />
      <View
        style={[
          styles.glowLayer,
          styles.glowInnerShape,
          { borderColor: withOpacity(color, 0.4), backgroundColor: withOpacity(color, 0.16) },
        ]}
      />
    </>
  );
}

interface SquareProps {
  square: string;
  /** Measured per-rank tone for this square; see BoardSquares in the theme. */
  squareColor: string;
  isLight: boolean;
  isSelected: boolean;
  isLegalTarget: boolean;
  isCapture: boolean;
  isCheck: boolean;
  isLastMove: boolean;
  showRankLabel: boolean;
  rankLabel: number;
  showFileLabel: boolean;
  fileLabel: string;
  squareSize: number;
  interactive: boolean;
  canDrag: boolean;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
  onTapSquare: (square: string) => void;
  onGrab: (square: string) => void;
  onDrop: (square: string, deltaRow: number, deltaCol: number) => void;
}

// Purely a visual/gesture surface -- tint, labels, legal-move dots, gesture
// hit-target. Renders no piece of its own any more (see PieceLayer/
// BoardPiece below): gesture ownership deliberately stays here, keyed by
// stable grid position, rather than moving onto a piece that's animating
// away from its square mid-drag.
const Square = memo(function Square({
  square,
  squareColor,
  isLight,
  isSelected,
  isLegalTarget,
  isCapture,
  isCheck,
  isLastMove,
  showRankLabel,
  rankLabel,
  showFileLabel,
  fileLabel,
  squareSize,
  interactive,
  canDrag,
  dragX,
  dragY,
  onTapSquare,
  onGrab,
  onDrop,
}: SquareProps) {
  const labelColor = isLight ? withOpacity(Colors.boardEdge, 0.75) : withOpacity(Colors.chrome, 0.65);

  // Rebuilt only when one of these actually changes (canDrag flips as a piece
  // moves on/off the square, squareSize on a board resize) -- not on every
  // ChessBoard render, which used to churn ~192 Gesture objects a second while
  // the clock ticked.
  const composedGesture = useMemo(() => {
    const tap = Gesture.Tap()
      .enabled(interactive)
      .onEnd((_event, success) => {
        if (success) runOnJS(onTapSquare)(square);
      });

    const pan = Gesture.Pan()
      .enabled(canDrag)
      .minDistance(4)
      .onStart(() => {
        runOnJS(onGrab)(square);
      })
      .onUpdate((event) => {
        dragX.value = event.translationX;
        dragY.value = event.translationY;
      })
      .onEnd((event) => {
        const deltaCol = Math.round(event.translationX / squareSize);
        const deltaRow = Math.round(event.translationY / squareSize);
        // Deliberately doesn't reset dragX/dragY/draggingIdSV here -- see
        // bakeDraggedPosition's comment for why that handoff happens on the JS
        // thread instead, synchronous with whatever state update follows.
        runOnJS(onDrop)(square, deltaRow, deltaCol);
      });

    return Gesture.Race(pan, tap);
  }, [interactive, canDrag, squareSize, square, dragX, dragY, onTapSquare, onGrab, onDrop]);

  return (
    <GestureDetector gesture={composedGesture}>
      <View
        style={[
          styles.square,
          { width: squareSize, height: squareSize, backgroundColor: squareColor },
        ]}
      >
        {isLastMove ? <View style={[StyleSheet.absoluteFill, styles.lastMoveTint]} /> : null}
        {isSelected ? <View style={[StyleSheet.absoluteFill, styles.selectedTint]} /> : null}
        {isCheck ? <View style={[StyleSheet.absoluteFill, styles.checkTint]} /> : null}

        {showRankLabel ? (
          <Text style={[styles.rankLabel, { color: labelColor }]}>{rankLabel}</Text>
        ) : null}
        {showFileLabel ? (
          <Text style={[styles.fileLabel, { color: labelColor }]}>{fileLabel}</Text>
        ) : null}

        {isCapture ? <View style={styles.captureRing} /> : null}
        {isLegalTarget && !isCapture ? <View style={styles.moveDot} /> : null}
      </View>
    </GestureDetector>
  );
});

// Thin `.map` wrapper -- not memoized itself (its own re-run is O(32) cheap
// prop-identity checks); the expensive work `memo(BoardPiece)` below
// prevents is what actually matters for render cost.
function PieceLayer({
  pieces,
  positions,
  squareSize,
  squareSizeShared,
  pieceSprites,
  draggingIdSV,
  dragX,
  dragY,
}: {
  pieces: LivePiece[];
  positions: Map<number, PiecePosition>;
  squareSize: number;
  squareSizeShared: SharedValue<number>;
  pieceSprites: PieceSpriteMap;
  draggingIdSV: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
}) {
  return (
    <>
      {pieces.map((piece) => {
        const position = positions.get(piece.id);
        if (!position) return null;
        return (
          <BoardPiece
            key={piece.id}
            id={piece.id}
            type={piece.type}
            position={position}
            squareSize={squareSize}
            squareSizeShared={squareSizeShared}
            pieceSprites={pieceSprites}
            draggingIdSV={draggingIdSV}
            dragX={dragX}
            dragY={dragY}
          />
        );
      })}
    </>
  );
}

// The one persistent home for every piece on the board -- created once per
// LivePiece id and never remounted for the rest of that piece's lifetime on
// the board. This is what actually fixes "piece reloads on every move": this
// component's Image is the SAME mounted instance before, during, and after a
// move, merely repositioned via `position`'s shared values rather than
// swapped for a fresh one. Also doubles as the drag surface (no separate
// DragGhost) -- while `draggingIdSV` names this piece's id, its transform
// follows the raw gesture instead of `position`.
//
// memo is load-bearing here, not cosmetic: reconciliation (see the
// lastMove-driven effect above) always preserves object identity for
// untouched LivePiece entries, so on a typical move only the 1-4 pieces that
// actually changed get new prop references -- the other ~28 mounted
// BoardPiece instances skip re-rendering entirely rather than being
// re-diffed on every move.
const BoardPiece = memo(function BoardPiece({
  id,
  type,
  position,
  squareSize,
  squareSizeShared,
  pieceSprites,
  draggingIdSV,
  dragX,
  dragY,
}: {
  id: number;
  type: string;
  position: PiecePosition;
  squareSize: number;
  squareSizeShared: SharedValue<number>;
  pieceSprites: PieceSpriteMap;
  draggingIdSV: SharedValue<number>;
  dragX: SharedValue<number>;
  dragY: SharedValue<number>;
}) {
  const animatedStyle = useAnimatedStyle(() => {
    const s = squareSizeShared.value;
    if (draggingIdSV.value === id) {
      // Lifts the piece well above the fingertip while dragging (like
      // chess.com) so the hand holding it doesn't cover the piece or the
      // destination square.
      return {
        width: s,
        height: s,
        zIndex: 50,
        transform: [
          { translateX: position.col.value * s + dragX.value },
          { translateY: position.row.value * s + dragY.value - s },
          { scale: 2.1 },
        ],
      };
    }
    return {
      width: s,
      height: s,
      zIndex: 10,
      transform: [
        { translateX: position.col.value * s },
        { translateY: position.row.value * s },
        { scale: position.scale.value },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.boardPieceBase, { left: 0, top: 0 }, animatedStyle]}>
      <PieceGlyph piece={type} squareSize={squareSize} pieceSprites={pieceSprites} />
    </Animated.View>
  );
});

// A captured piece animating out (fade + scale-down + a small knockback)
// instead of vanishing the instant it's removed from `board`.
const DyingPieceGhost = memo(function DyingPieceGhost({
  id,
  type,
  square,
  flipped,
  squareSize,
  squareSizeShared,
  pieceSprites,
  onDone,
}: {
  id: number;
  type: string;
  square: string;
  flipped: boolean;
  squareSize: number;
  squareSizeShared: SharedValue<number>;
  pieceSprites: PieceSpriteMap;
  onDone: (id: number) => void;
}) {
  const progress = useSharedValue(0);
  const [row, col] = displayRowCol(square, flipped);

  useEffect(() => {
    progress.value = withTiming(1, { duration: CAPTURE_OUT_DURATION_MS, easing: Easing.in(Easing.cubic) }, (finished) => {
      if (finished) runOnJS(onDone)(id);
    });
    // Mount-only: this instance exists for exactly one capture's lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const s = squareSizeShared.value;
    return {
      width: s,
      height: s,
      zIndex: 5,
      opacity: 1 - progress.value,
      transform: [
        { translateX: col * s },
        { translateY: row * s + progress.value * s * 0.18 },
        { scale: 1 - progress.value * 0.4 },
      ],
    };
  });

  return (
    <Animated.View pointerEvents="none" style={[styles.boardPieceBase, { left: 0, top: 0 }, animatedStyle]}>
      <PieceGlyph piece={type} squareSize={squareSize} pieceSprites={pieceSprites} />
    </Animated.View>
  );
});

// A one-shot pulse over the checked king's square, layered on top of
// Square's persistent isCheck tint -- triggered only for a genuinely new
// check event (remounted via the `key` at the call site), not merely
// "check is still active". Brackets the check sound cue's ~2.3s length.
function CheckPulse({
  checkSquare,
  flipped,
  squareSize,
  squareSizeShared,
}: {
  checkSquare: string;
  flipped: boolean;
  squareSize: number;
  squareSizeShared: SharedValue<number>;
}) {
  const progress = useSharedValue(0);
  const [row, col] = displayRowCol(checkSquare, flipped);

  useEffect(() => {
    const halfCycle = CHECK_PULSE_DURATION_MS / 4;
    progress.value = withSequence(
      withRepeat(withTiming(1, { duration: halfCycle, easing: Easing.inOut(Easing.sin) }), 4, true),
      withTiming(0, { duration: 200 }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => {
    const s = squareSizeShared.value;
    return {
      width: s,
      height: s,
      opacity: 0.25 + progress.value * 0.45,
      transform: [{ translateX: col * s }, { translateY: row * s }, { scale: 1 + progress.value * 0.12 }],
    };
  });

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.checkGlow, { left: 0, top: 0, width: squareSize, height: squareSize }, animatedStyle]}
    />
  );
}

// A bigger, decoupled flourish for the game-ending move -- deliberately
// short (~2s) relative to the checkmate sound's own ~8.8s decay; the sound
// keeps playing as ambience after this settles rather than the animation
// trying to fill its whole length.
function CheckmateFlourish({ boardSize }: { boardSize: number }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withTiming(1, { duration: CHECKMATE_FLOURISH_DURATION_MS, easing: Easing.out(Easing.cubic) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: 1 - progress.value,
    transform: [{ scale: 0.3 + progress.value * 1.4 }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.flourishRing, { width: boardSize, height: boardSize }, animatedStyle]}
    />
  );
}

// Every piece is drawn by ChessPiece as vectors, plus one contact shadow so it
// sits ON its square instead of floating. The shadow lives here rather than in
// the art because it belongs to the board's lighting, not to the piece, and
// keeping it in one place is what makes it identical across all twelve.
/** Board letter -> sprite key. 'K' -> 'wk', 'q' -> 'bq'. */
function spriteKey(piece: string): string {
  return (piece === piece.toUpperCase() ? 'w' : 'b') + piece.toLowerCase();
}

function PieceGlyph({
  piece,
  squareSize,
  pieceSprites,
}: {
  piece: string;
  squareSize: number;
  pieceSprites: PieceSpriteMap;
}) {
  const sprite = pieceSprites[spriteKey(piece)];
  if (!sprite) return null;

  return (
    <View style={{ width: squareSize, height: squareSize }}>
      {/* Two stacked ellipses rather than one: a wide faint pool with a tighter,
          darker core inside it. That falloff is what reads as a piece standing
          ABOVE the board -- a single flat ellipse just looks like a decal
          printed on the square. Built from plain views so it renders the same on
          both platforms, where a blurred colored shadow would not. */}
      <View
        style={[
          styles.shadowPool,
          {
            width: squareSize * 0.66,
            height: squareSize * 0.19,
            left: squareSize * 0.15,
            top: squareSize * 0.755,
          },
        ]}
      />
      <View
        style={[
          styles.shadowCore,
          {
            width: squareSize * 0.44,
            height: squareSize * 0.11,
            left: squareSize * 0.25,
            top: squareSize * 0.795,
          },
        ]}
      />

      <Image
        source={sprite}
        contentFit="contain"
        // expo-image's default cachePolicy ('disk') only caches the source
        // bytes, not the decoded bitmap -- these are unusually complex
        // vtraced SVGs (hundreds of paths, up to ~1.5MB), so without this
        // every fresh decode would be visible as a blank flash, especially
        // on Android. 'memory-disk' caches the decoded bitmap keyed by
        // source. Now that pieces are persistent (see BoardPiece above) this
        // mostly matters for the very first mount of each of the 12 sprites
        // and for a promotion's source swap, not for ordinary moves any
        // more -- but costs nothing to keep.
        cachePolicy="memory-disk"
        // Cut per whole square, so the sprite fills it edge to edge and keeps
        // the render's own framing and scale. Lifted a few percent off its own
        // baseline so it clears the shadow beneath it and reads as raised.
        style={[StyleSheet.absoluteFill, { transform: [{ translateY: -squareSize * 0.035 }] }]}
      />
    </View>
  );
}

// Machined screw head rather than a flat dot: a lit top-left face falling to a
// shaded bottom-right, ringed by a dark seat so it sits *in* the bezel.
function Rivet({ style }: { style: object }) {
  return (
    <View style={[styles.rivet, style]}>
      <LinearGradient
        colors={[Colors.chrome, Colors.chromeMid, Colors.chromeDark]}
        locations={[0, 0.55, 1]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.85, y: 1 }}
        style={styles.rivetFace}
      />
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  boardWrap: {
    alignItems: 'center',
  },
  // Sized wrapper so the glow layers have a box to inset themselves against;
  // the frame itself stays the element that defines the board's dimensions.
  frameSlot: {
    width: '98%',
    maxWidth: 400,
    aspectRatio: 1,
  },
  boardFrame: {
    flex: 1,
    borderRadius: 16,
    padding: 10,
    borderWidth: 1,
    borderColor: withOpacity(Colors.chrome, 0.7),
    boxShadow: `0px 12px 34px ${withOpacity(Colors.bgBase, 0.9)}`,
  },
  frameBevel: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 16,
    opacity: 0.5,
  },
  glowLayer: {
    position: 'absolute',
    borderWidth: 1.5,
  },
  glowOuterShape: {
    top: -12,
    left: -12,
    right: -12,
    bottom: -12,
    borderRadius: 28,
  },
  glowMidShape: {
    top: -7,
    left: -7,
    right: -7,
    bottom: -7,
    borderRadius: 23,
  },
  glowInnerShape: {
    top: -3,
    left: -3,
    right: -3,
    bottom: -3,
    borderRadius: 19,
  },
  rivet: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 4.5,
    padding: 1,
    backgroundColor: withOpacity(Colors.bgBase, 0.55),
    boxShadow: `0px 1px 2px ${withOpacity(Colors.bgBase, 0.6)}`,
    zIndex: 1,
  },
  rivetFace: {
    flex: 1,
    borderRadius: 3.5,
  },
  gridWrapper: {
    flex: 1,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boardGrid: {
    borderRadius: 4,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: Colors.boardEdge,
    // Recessed playfield: a dark rim tight against the squares reads as the
    // bezel casting onto the board, which is what stops the grid looking pasted
    // flat onto the frame.
    boxShadow: `inset 0px 2px 6px ${withOpacity(Colors.bgBase, 0.6)}, 0px 1px 0px ${withOpacity(Colors.chrome, 0.45)}`,
  },
  boardRow: {
    flexDirection: 'row',
  },
  // Board rotated 180deg for the Black player: canonical iteration order is
  // unchanged (so square ids / labels stay canonical), only the visual stacking
  // is reversed -- which keeps pieces and coordinate labels upright.
  boardGridFlipped: {
    flexDirection: 'column-reverse',
  },
  boardRowFlipped: {
    flexDirection: 'row-reverse',
  },
  square: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  lastMoveTint: {
    backgroundColor: withOpacity(Colors.gold, 0.35),
  },
  selectedTint: {
    backgroundColor: withOpacity(Colors.cyan, 0.4),
  },
  checkTint: {
    backgroundColor: withOpacity(Colors.crimson, 0.55),
  },
  rankLabel: {
    position: 'absolute',
    top: 2,
    left: 3,
    fontSize: 9,
    fontWeight: '700',
  },
  fileLabel: {
    position: 'absolute',
    bottom: 1,
    right: 3,
    fontSize: 9,
    fontWeight: '700',
  },
  // Ringed rather than a plain dot so it stays readable on the near-white
  // light squares as well as the slate dark ones.
  moveDot: {
    position: 'absolute',
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: withOpacity(Colors.cyan, 0.8),
    borderWidth: 1,
    borderColor: withOpacity(Colors.boardEdge, 0.55),
    boxShadow: `0px 0px 7px ${withOpacity(Colors.cyan, 0.7)}`,
  },
  captureRing: {
    position: 'absolute',
    width: '88%',
    height: '88%',
    borderRadius: 999,
    borderWidth: 3,
    borderColor: withOpacity(Colors.cyan, 0.75),
  },
  shadowPool: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: withOpacity(Colors.bgBase, 0.16),
    boxShadow: `-2px 3px 10px ${withOpacity(Colors.bgBase, 0.3)}`,
  },
  shadowCore: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: withOpacity(Colors.bgBase, 0.34),
    boxShadow: `-1px 1px 4px ${withOpacity(Colors.bgBase, 0.45)}`,
  },
  // Shared absolute-over-the-grid base for every persistent/transient piece
  // layer (BoardPiece, DyingPieceGhost) -- width/height/transform/zIndex are
  // always supplied by each one's own animatedStyle.
  boardPieceBase: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkGlow: {
    position: 'absolute',
    borderRadius: 6,
    backgroundColor: withOpacity(Colors.crimson, 0.5),
  },
  flourishRing: {
    position: 'absolute',
    top: 0,
    left: 0,
    borderRadius: 999,
    borderWidth: 6,
    borderColor: withOpacity(Colors.gold, 0.85),
  },
});
// #endregion
