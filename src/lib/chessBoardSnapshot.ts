import type { Chess, Color, Move, PieceSymbol, Square } from 'chess.js';

type BoardCells = ReturnType<Chess['board']>;

// Extracted from useChessGame.ts's buildSnapshot -- the pure, instance-based
// transform from a chess.js Chess to ChessBoard's board: string[][] prop
// shape (uppercase = white, lowercase = black, '' = empty). Shared by live
// play (buildSnapshot) and the replay hook (useMatchReplay), which builds a
// fresh Chess per ply from a stored FEN rather than mutating one instance.
// `cells` lets a caller that already called chess.board() pass it in rather
// than paying for a second full board allocation.
export function boardGridFromChess(chess: Chess, cells?: BoardCells): string[][] {
  return (cells ?? chess.board()).map((row) =>
    row.map((cell) => (cell ? (cell.color === 'w' ? cell.type.toUpperCase() : cell.type) : '')),
  );
}

// Same extraction for the in-check king square. buildSnapshot passes its
// already-in-hand `cells` so this doesn't call chess.board() a second time.
export function checkSquareFromChess(chess: Chess, cells?: BoardCells): Square | null {
  if (!chess.inCheck()) return null;
  const turn = chess.turn();
  for (const row of cells ?? chess.board()) {
    for (const cell of row) {
      if (cell && cell.type === 'k' && cell.color === turn) return cell.square;
    }
  }
  return null;
}

export type MoveSoundKind = 'move' | 'capture' | 'castle' | 'check' | 'checkmate';

// Richer than a plain {from, to} -- carries everything ChessBoard's piece-identity
// reconciliation needs to resolve a move unambiguously (which piece moved, whether it
// was a capture and if so where the captured piece actually sits -- en passant's victim
// isn't on `to` -- whether it was a castle, which side, and any promotion), pulled
// straight off chess.js's own verbose Move/history-entry shape rather than re-derived.
export interface VerboseLastMove {
  from: Square;
  to: Square;
  piece: PieceSymbol;
  color: Color;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  flags: string;
}

export function pickVerboseLastMove(m: Move | undefined): VerboseLastMove | null {
  if (!m) return null;
  return { from: m.from, to: m.to, piece: m.piece, color: m.color, captured: m.captured, promotion: m.promotion, flags: m.flags };
}

// Shared by buildSnapshot (live play) and useMatchReplay (replay) -- both
// already derive a verbose history entry for `lastMove`, this just classifies
// it into one sound cue. Priority: checkmate > check > castle > capture >
// plain move (promotion isn't a distinct cue in this pass). chess.isCheckmate()/
// inCheck() reflect the position immediately after chess.move() mutates the
// instance, same as checkSquareFromChess above -- no extra step needed.
export function classifyMoveSound(
  chess: Chess,
  lastHistoryMove: { captured?: string; flags: string } | undefined,
): MoveSoundKind | null {
  if (!lastHistoryMove) return null;
  if (chess.isCheckmate()) return 'checkmate';
  if (chess.inCheck()) return 'check';
  if (lastHistoryMove.flags.includes('k') || lastHistoryMove.flags.includes('q')) return 'castle';
  if (lastHistoryMove.captured) return 'capture';
  return 'move';
}
