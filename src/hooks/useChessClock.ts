import { useCallback, useEffect, useRef } from 'react';

export interface ClockTimes {
  w: number;
  b: number;
}

interface UseChessClockOptions {
  turn: 'w' | 'b';
  isGameOver: boolean;
  /** Starting time per side, ms. Equal for both sides for a fresh match (5 minutes for
   * bot/local, server-provided for online) -- but NOT necessarily equal after a rejoin
   * mid-game, where each side has already burned a different amount of their clock, so
   * this takes a value per side rather than one shared number. */
  initialMs: ClockTimes;
  /** Credited to a side the instant they move. Always 0 today (no picker exposes a nonzero
   * value yet) -- kept as a real parameter end-to-end so turning it on later is a picker-only
   * change, not an engine change. */
  incrementMs?: number;
  /** Fires exactly once, the instant a side's clock reaches 0. */
  onExpire: (color: 'w' | 'b') => void;
}

interface UseChessClockApi {
  /** Remaining ms for a side, derived fresh from the anchor + true elapsed wall time.
   * The reference is stable for the life of the match -- deliberately NOT React state:
   * the display value changes every second, and routing that through setState re-renders
   * the whole match screen (and the board) once a second. A leaf component (TimerPill)
   * polls this on its own 1Hz interval instead, so only the clock text re-renders. */
  getRemaining: (color: 'w' | 'b') => number;
  /** Online only -- overwrites both sides' clocks with the server's authoritative values.
   * Never called for bot/local, which never has anything to reconcile against. */
  reconcile: (serverRemainingMs: ClockTimes) => void;
}

// Refs hold the truth; the live value is always *derived* fresh from an anchor
// (each side's remaining time as of the START of their current/last turn, only
// ever written at a turn-change boundary) plus true elapsed wall time -- never
// by mutating the anchor tick-by-tick, which would compound setInterval
// scheduling drift over a long game.
export function useChessClock({
  turn,
  isGameOver,
  initialMs,
  incrementMs = 0,
  onExpire,
}: UseChessClockOptions): UseChessClockApi {
  const remainingRef = useRef<ClockTimes>(initialMs);
  const turnStartedAtRef = useRef<number>(Date.now());
  const prevTurnRef = useRef<'w' | 'b' | null>(null);
  // Mirrors of the two props the derived getters need, so getRemaining can be
  // a stable ([]-dep) callback rather than re-created every render.
  const turnRef = useRef<'w' | 'b'>(turn);
  const gameOverRef = useRef<boolean>(isGameOver);

  // Single effect per turn change (or game-over toggle): does turn-change
  // bookkeeping (deduct elapsed from the mover, credit increment, reset the
  // anchor) THEN arms a precise single-shot expiry timeout for whichever side
  // is now active -- all from one consistent view of the refs.
  useEffect(() => {
    if (isGameOver) return;

    const now = Date.now();
    if (prevTurnRef.current === null) {
      // First mount (or a reset): start fresh, nothing to credit yet.
      turnStartedAtRef.current = now;
    } else if (prevTurnRef.current !== turn) {
      const mover = prevTurnRef.current;
      const elapsed = now - turnStartedAtRef.current;
      remainingRef.current = {
        ...remainingRef.current,
        [mover]: Math.max(0, remainingRef.current[mover] - elapsed) + incrementMs,
      };
      turnStartedAtRef.current = now;
    }
    prevTurnRef.current = turn;
    turnRef.current = turn;
    gameOverRef.current = false;

    // A single-shot timeout fires expiry at the exact instant the active side
    // hits 0 (a poll alone could lag up to a second behind the real deadline).
    let expired = false;
    const msLeft = Math.max(0, remainingRef.current[turn] - (Date.now() - turnStartedAtRef.current));
    const expiry = setTimeout(() => {
      if (expired) return;
      expired = true;
      onExpire(turn);
    }, msLeft);

    return () => {
      clearTimeout(expiry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turn, isGameOver]);

  // A game-over transition bakes the active side's final elapsed time into the
  // anchor (so the frozen display shows the real end-of-game value) and marks
  // the clock stopped. A reset (isGameOver -> false) is handled by the turn
  // effect above starting fresh.
  useEffect(() => {
    if (!isGameOver) return;
    if (prevTurnRef.current) {
      const mover = prevTurnRef.current;
      const elapsed = Date.now() - turnStartedAtRef.current;
      remainingRef.current = {
        ...remainingRef.current,
        [mover]: Math.max(0, remainingRef.current[mover] - elapsed),
      };
    }
    prevTurnRef.current = null;
    gameOverRef.current = true;
  }, [isGameOver]);

  const getRemaining = useCallback((color: 'w' | 'b'): number => {
    const anchor = remainingRef.current[color];
    if (gameOverRef.current || color !== turnRef.current) return anchor;
    return Math.max(0, anchor - (Date.now() - turnStartedAtRef.current));
  }, []);

  const reconcile = useCallback((serverRemainingMs: ClockTimes) => {
    remainingRef.current = { ...serverRemainingMs };
    turnStartedAtRef.current = Date.now();
  }, []);

  // Stable API object for the life of the hook (both members are []-dep
  // callbacks) -- so `clock` itself never changes identity and can't be a
  // re-render trigger for any consumer.
  const apiRef = useRef<UseChessClockApi>({ getRemaining, reconcile });
  return apiRef.current;
}
