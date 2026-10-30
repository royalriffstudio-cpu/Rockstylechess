import { Chess } from 'chess.js';

// Facts about a finished game, read from its PGN with chess.js -- the only thing
// the server trusts about a game it did not host (bot matches are played on the
// device). Nothing here reimplements a chess rule: chess.js replays the moves
// (rejecting any illegal one) and answers checkmate / draw questions itself.

export interface GameFacts {
  plies: number;
  moveCount: number; // full moves
  over: boolean;
  result: 'white' | 'black' | 'draw' | null; // null = not finished
  checkmate: boolean;
  myCaptures: number;
  queenLost: boolean;
  mateByPiece: string | null; // piece that delivered MY checkmate
  opponentCaptures: number;
}

export function analyzeGame(pgn: string, myColor: 'w' | 'b'): GameFacts | null {
  if (typeof pgn !== 'string' || pgn.length === 0 || pgn.length > 20_000) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null; // an illegal move or malformed PGN
  }
  const history = chess.history({ verbose: true });
  const last = history[history.length - 1];
  const checkmate = chess.isCheckmate();
  let result: GameFacts['result'] = null;
  if (checkmate && last) result = last.color === 'w' ? 'white' : 'black';
  else if (chess.isDraw() || chess.isStalemate()) result = 'draw';

  return {
    plies: history.length,
    moveCount: Math.ceil(history.length / 2),
    over: chess.isGameOver(),
    result,
    checkmate,
    myCaptures: history.filter((m) => m.color === myColor && m.captured).length,
    opponentCaptures: history.filter((m) => m.color !== myColor && m.captured).length,
    queenLost: history.some((m) => m.color !== myColor && m.captured === 'q'),
    mateByPiece: checkmate && last && last.color === myColor ? last.piece : null,
  };
}
