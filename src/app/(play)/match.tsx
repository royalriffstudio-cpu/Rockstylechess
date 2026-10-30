import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ImageSourcePropType,
  type LayoutChangeEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import {
  ChatPanel,
  ChatToast,
  ChessBoard,
  ConfirmModal,
  CountryFlag,
  PlayerAvatar,
  PromotionPicker,
  VenueBackdrop,
} from '@/components/ui';
import { StockfishEngine, type StockfishEngineHandle } from '@/components/StockfishEngine';
import { getPieceSprites, type PieceSpriteMap } from '@/components/ui/pieceSprites';
import { getBoardTheme } from '@/constants/boardThemes';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, Fonts, Spacing, withOpacity } from '@/constants/theme';
import { BOT_PORTRAITS, BOT_TIER_LABEL } from '@/constants/bots';
import { formatChips, getVenue, getVenueIntensity } from '@/constants/venues';
import { useChessClock, type ClockTimes } from '@/hooks/useChessClock';
import { useChessGame, type BotDifficulty, type ChessGameResult, type GameMode } from '@/hooks/useChessGame';
import { useMatchChat } from '@/hooks/useMatchChat';
import { useMatchReplay } from '@/hooks/useMatchReplay';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { finishBotMatch, startBotMatch, type BotFinishReason } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { capturedPoints, materialLead } from '@/lib/pieceValues';
import { getSocket } from '@/lib/socket';
import type { EngineMove, StockfishConfig } from '@/lib/botEngine';
import { setPendingLocalReplay, type LocalMatchReplay } from '@/lib/localMatchReplayStore';
import { MATCH_CHIP_REWARDS } from '@/lib/matchRewards';
import { DURATION_MS, isDuration, isVenueTier } from '@/lib/onlineMatch';
import { ensureProgressionListener, putReport, titleName } from '@/lib/progression';
import { ensureWagerListener } from '@/lib/wagerResult';


// Bot/local always default to this (matches setup.tsx's own default duration
// pick, no dedicated picker exists for these modes). Online's real starting
// time comes from the server (via matchmaking.tsx/game-room.tsx's route params,
// themselves from queue:matched) -- clockW/clockB/incrementMs are only ever
// present for mode === 'online'; bot/local always fall through to this.
const DEFAULT_CLOCK_MS = 5 * 60_000;

// Captured pieces render as the real piece sprites (same set as the board),
// ordered by value and stacked like chess.com so a long capture list stays on
// one compact line instead of wrapping and growing the player row. Repeats of
// the same piece (the pawns) stack tighter than a change of piece type, which
// keeps even a full 15-piece tray within the name column it sits in.
const CAPTURED_ORDER = ['q', 'r', 'b', 'n', 'p'];
const CAPTURED_PIECE_SIZE = 30;
// Horizontal advance from one piece to the next.
const CAPTURED_STEP_SAME = 10;
const CAPTURED_STEP_DIFFERENT = 16;

// The slot is always rendered at this height (see PlayerRow) so a row never
// grows when the first capture lands. The backing pill only appears once there
// is something in it. Hugs its pieces (alignSelf) but never outgrows the name
// column it sits in -- an overlong tray is clipped rather than running under
// the timer.
const CAPTURED_TRAY_STYLE = {
  alignSelf: 'flex-start',
  // The pill shrinks (clips its pieces) before the material-lead label next
  // to it does; RN's default flexShrink is 0, so it must be explicit.
  flexShrink: 1,
  maxWidth: '100%',
  height: CAPTURED_PIECE_SIZE,
  overflow: 'hidden',
} as const;

// Mid-grey backing so BOTH colours of captured piece read against the dark
// venue backdrop: without it the black pieces all but vanish.
const CAPTURED_TRAY_FILLED_STYLE = {
  ...CAPTURED_TRAY_STYLE,
  paddingHorizontal: 3,
  borderRadius: CAPTURED_PIECE_SIZE / 2,
  backgroundColor: withOpacity(Colors.chromeDark, 0.7),
} as const;

// Board fit. The board is square and sized from the screen WIDTH, so the one
// way it can go wrong is vertically: on a short screen it would overflow the
// strip between the two player rows. That strip (boardArea) is measured, and
// the board is capped to it minus what this screen keeps around the board.
// The always-reserved strip under the board for the peek-mode nav (peekNavSlot).
const PEEK_NAV_HEIGHT = 44;
// Breathing room kept above the board and below the peek strip.
const BOARD_VERTICAL_GAP = 6;
// Floor for the cap, so a transient/odd layout pass can't collapse the board.
const MIN_BOARD_SIZE = 200;
// How far the board bleeds into the column's px-md (12) side padding. Kept
// small on purpose: the outermost files stay ~15dp from the screen edge, clear
// of most of Android's edge-swipe "back" zone, which would otherwise swallow a
// piece dragged inward from the a/h files.
const BOARD_SIDE_BLEED = 4;

export default function MatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    mode: modeParam,
    difficulty: difficultyParam,
    matchId,
    color: colorParam,
    fen: fenParam,
    opponentName,
    opponentAvatarId,
    opponentCountry,
    opponentUserId,
    botName,
    botId,
    botEmoji,
    clockW: clockWParam,
    clockB: clockBParam,
    incrementMs: incrementMsParam,
    duration: durationParam,
    venueTier: venueTierParam,
    buyIn: buyInParam,
    prize: prizeParam,
    opponentRating: opponentRatingParam,
    opponentTitle: opponentTitleParam,
  } = useLocalSearchParams<{
    mode?: string;
    difficulty?: string;
    matchId?: string;
    color?: string;
    fen?: string;
    opponentName?: string;
    opponentAvatarId?: string;
    opponentCountry?: string;
    opponentUserId?: string;
    botName?: string;
    // Which roster bot this is (the server validates it and issues the match -- see botSessions.ts).
    botId?: string;
    botEmoji?: string;
    clockW?: string;
    clockB?: string;
    incrementMs?: string;
    // bot/local only -- picked on the bots screen's Match Options. Online's
    // clock comes from the server (clockW/clockB) instead.
    duration?: string;
    // Set by bots.tsx (Match Options) or matchmaking.tsx once matched; falls
    // back to Garage when absent (local pass-and-play, private room, friend
    // challenge -- none of those flows carry a venue today).
    venueTier?: string;
    // Online only, from the server's queue:matched: the stake riding on this match
    // (0 / absent = unwagered).
    buyIn?: string;
    prize?: string;
    // Online only: the opponent's public standing from queue:matched.
    opponentRating?: string;
    opponentTitle?: string;
  }>();
  const mode: GameMode = modeParam === 'bot' ? 'bot' : modeParam === 'online' ? 'online' : 'local';
  const difficulty: BotDifficulty =
    difficultyParam === 'medium' ||
    difficultyParam === 'stockfish-basic' ||
    difficultyParam === 'stockfish-lite' ||
    difficultyParam === 'stockfish-strong'
      ? difficultyParam
      : 'easy';
  const isStockfishTier =
    difficulty === 'stockfish-basic' || difficulty === 'stockfish-lite' || difficulty === 'stockfish-strong';
  // Which color this device plays. Online: the server's coin-flip, delivered as
  // the `color` param. Bot: the "Play As" pick from the bots screen (also the
  // `color` param). Local pass-and-play: no param -> White. Fixed for the life
  // of this screen, which remounts per game: every entry to /match is a nav
  // from another screen and every exit is router.replace('/result-placeholder'),
  // so /match is never the current route when navigated to. If a rematch flow
  // is ever added that does router.replace('/match', ...), it would REUSE this
  // useChessGame instance -- wrap the body in a component keyed by a per-game id
  // (see puzzle-match.tsx) before doing that.
  const playerColor: 'w' | 'b' = colorParam === 'b' ? 'b' : 'w';
  const opponentColor: 'w' | 'b' = playerColor === 'w' ? 'b' : 'w';
  // Render the board from Black's side when this device has Black, so the
  // player's own pieces are at the bottom (online + bot).
  const flipBoard = playerColor === 'b';
  const online = useMemo(
    () =>
      mode === 'online' && matchId && fenParam
        ? { matchId, playerColor, initialFen: fenParam }
        : undefined,
    [mode, matchId, fenParam, playerColor],
  );
  const opponentDisplayName =
    mode === 'online' ? opponentName || 'OPPONENT' : mode === 'bot' ? botName || 'STORM_KING' : 'LOCAL PLAYER';
  // Online opponents get their picked avatar badge; bots keep their roster
  // emoji, and a same-device "local" opponent falls back to the rock hand.
  // Online opponents carry a persisted avatar id (drawn with its class frame);
  // bots / local play pass nothing and fall back to their emoji.
  const opponentAvatarKey = mode === 'online' ? (opponentAvatarId ?? null) : undefined;
  const opponentAvatarEmoji = mode === 'bot' ? botEmoji || '🤖' : mode === 'online' ? undefined : '🤘';
  const navigatedRef = useRef(false);
  const stockfishRef = useRef<StockfishEngineHandle>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [resignVisible, setResignVisible] = useState(false);
  // Peeking at a previous board state repurposes the MAIN board itself
  // (read-only, driven by useMatchReplay) rather than opening a separate
  // panel/sheet -- see peekActive below. historySnapshot is a frozen
  // point-in-time copy taken when peeking starts, deliberately NOT
  // re-derived while peeking is on: the real chess.js position, the
  // opponent/bot, and the match clock all keep running untouched underneath
  // regardless of what the board is showing.
  const [peekActive, setPeekActive] = useState(false);
  const [historySnapshot, setHistorySnapshot] = useState<{ pgn: string; moveElapsedMs: number[] } | null>(null);
  // chess.js only reports isGameOver for mate/stalemate/draw-by-rule; a resign,
  // timeout, forfeit or agreed draw leaves the position non-terminal, so the
  // clock would keep ticking on the result screen during handleGameOver's
  // ~900ms hold. This latches the moment ANY ending fires so the clock freezes.
  const [matchEnded, setMatchEnded] = useState(false);
  const { profile, refresh: refreshPlayerProfile } = usePlayerProfile();
  // Header rank lines are REAL: an online opponent shows their equipped title and
  // rating, a bot its strength label, you your own title and rating. (They used to
  // be the hardcoded "GRANDMASTER (2150)" / "PRO (2145)" for everyone.)
  const opponentRank =
    mode === 'online'
      ? [opponentTitleParam?.toUpperCase(), opponentRatingParam ? opponentRatingParam : null].filter(Boolean).join(' · ') || 'GUEST'
      : mode === 'bot'
        ? `BOT · ${BOT_TIER_LABEL[difficulty]}`
        : 'PLAYER 2';
  const myRank =
    mode === 'local'
      ? 'PLAYER 1'
      : profile
        ? [titleName(profile.equippedTitleId)?.toUpperCase(), mode === 'online' ? String(profile.rating) : null].filter(Boolean).join(' · ') || `LVL ${profile.level}`
        : 'GUEST';
  const boardTheme = getBoardTheme(profile?.equippedBoardId);
  const pieceSprites = getPieceSprites(profile?.equippedPieceId);
  // Atmosphere only -- never feeds boardTheme/pieceSprites above, which stay
  // driven purely by the player's equipped Forge cosmetic regardless of venue.
  const venueTier = isVenueTier(venueTierParam) ? venueTierParam : 'garage';
  const venue = getVenue(venueTier);
  const buyIn = Number(buyInParam) || 0;
  const prize = Number(prizeParam) || 0;
  const wagered = mode === 'online' && buyIn > 0;
  const venueIntensity = getVenueIntensity(venueTier);
  const menuButtonStyle = useMemo(
    () => ({
      backgroundColor: withOpacity(Colors.bgPanel, 0.6),
      borderWidth: 1,
      borderColor: withOpacity(venue.accentColor, venueIntensity.glowOpacity * 0.6),
    }),
    [venue.accentColor, venueIntensity.glowOpacity],
  );
  const actionBarStyle = useMemo(
    () => ({
      backgroundColor: withOpacity(Colors.bgPanel, 0.96),
      borderTopWidth: 1,
      borderTopColor: withOpacity(venue.accentColor, venueIntensity.glowOpacity * 0.6),
      boxShadow: `0px -2px ${venueIntensity.glowRadius}px ${withOpacity(venue.accentColor, venueIntensity.glowOpacity * 0.5)}`,
    }),
    [venue.accentColor, venueIntensity.glowOpacity, venueIntensity.glowRadius],
  );

  const requestEngineMove = useCallback((fen: string, config: StockfishConfig): Promise<EngineMove | null> => {
    if (!stockfishRef.current) return Promise.resolve(null);
    return stockfishRef.current.requestBestMove(fen, config);
  }, []);

  async function handleGameOver(result: ChessGameResult) {
    if (navigatedRef.current) return;
    navigatedRef.current = true;
    // Stop the clocks immediately, whatever the ending (see matchEnded).
    setMatchEnded(true);
    // Close the chat panel before the transition below so it doesn't just
    // vanish abruptly with the rest of the screen.
    setChatOpen(false);

    let outcome: 'win' | 'loss' | 'draw';
    let reason: string;
    if (result.type === 'checkmate') {
      outcome = result.winner === playerColor ? 'win' : 'loss';
      reason = 'checkmate';
    } else if (result.type === 'resignation') {
      outcome = result.winner === playerColor ? 'win' : 'loss';
      reason = 'resignation';
    } else if (result.type === 'forfeit') {
      outcome = result.winner === playerColor ? 'win' : 'loss';
      reason = 'forfeit';
    } else if (result.type === 'timeout') {
      outcome = result.winner === playerColor ? 'win' : 'loss';
      reason = 'timeout';
    } else if (result.type === 'stalemate') {
      outcome = 'draw';
      reason = 'stalemate';
    } else {
      outcome = 'draw';
      reason = result.agreed
        ? 'agreement'
        : result.reason === 'insufficientVsTimeout'
          ? 'insufficientTimeout'
          : result.reason ?? 'draw';
    }
    console.log('Game over', outcome, reason);

    // Online pays the flat online table (display value; the server credits it). Bot
    // matches pay what the SERVER verifies: it issued the match at the start and
    // replays the finished PGN before paying anything (db/botSessions.ts), so this
    // starts at 0 and becomes whatever the server says. Pass-and-play pays nothing.
    let chipsGranted = mode === 'online' ? MATCH_CHIP_REWARDS[outcome] : 0;
    let noReward: string | undefined;
    // Bot matches get their Show Report from the server's reply (online ones arrive
    // over the socket as `progression:update`, keyed by the match id).
    const reportKey = `bot-${Date.now()}`;
    if (mode === 'bot') {
      const token = await getAuthToken();
      const sessionId = botSessionRef.current;
      const pgn = game.getReplayData()?.pgn;
      if (token && sessionId && pgn) {
        // How the game ended, as the server needs it: a conclusive position settles itself
        // (the server reads checkmate/draws from the PGN); otherwise only a loss is believed.
        const endedBy: BotFinishReason =
          result.type === 'resignation' ? 'resign' : result.type === 'timeout' ? (result.winner === playerColor ? 'bot-timeout' : 'timeout') : 'game';
        try {
          const finished = await finishBotMatch(token, sessionId, pgn, endedBy);
          if (finished.noResult) noReward = finished.reason ?? 'unverified';
          if (finished.progression) putReport(reportKey, finished.progression);
          chipsGranted = finished.chipsGranted ?? 0;
        } catch (error) {
          console.log('Failed to finish bot match', error);
          noReward = 'offline';
        }
      } else if (!token) {
        noReward = 'guest';
      }
    }

    // Stashes a client-side replay for the immediate post-match Replay/
    // Analyze Game entry points on result-placeholder.tsx -- for bot/local
    // this is the only record that will ever exist (no server-side match
    // row at all); for online it's a deliberate *duplicate* of what
    // persistMatchResult.ts is also persisting server-side right now, used
    // only for this immediate moment since the server-assigned matches.id
    // isn't knowable client-side yet (see localMatchReplayStore.ts's header
    // comment). null for forfeit (never reachable from bot/local, and not
    // worth the reconnect-mid-game edge case for online either).
    const replayData = game.getReplayData();
    if (replayData && reason !== 'forfeit') {
      setPendingLocalReplay({
        ...replayData,
        mode: mode as 'bot' | 'local' | 'online',
        // Matches the opponent name shown live during the match (opponentDisplayName above).
        opponentLabel: mode === 'local' ? 'Local Match' : opponentDisplayName,
        outcome,
        // The replay store only knows the coarse ending kinds -- collapse the
        // specific draw reasons (repetition / 50-move / material / time+material)
        // back to 'draw' for it.
        resultType: (['checkmate', 'stalemate', 'resignation', 'timeout'].includes(reason)
          ? reason
          : 'draw') as LocalMatchReplay['resultType'],
        playedAt: new Date().toISOString(),
        playerColor,
      });
    }

    // Picks up the new balance -- server-credited for online, just-claimed
    // for bot/local, or a no-op for guests (still 'guest' status).
    refreshPlayerProfile();

    // Brief pause so the final position (e.g. the checkmating move) is
    // visible for a beat before the Result screen takes over.
    setTimeout(() => {
      router.replace({
        pathname: '/result-placeholder',
        params: {
          outcome,
          reason,
          chipsGranted: String(chipsGranted),
          matchMode: mode,
          ...(noReward ? { noReward } : {}),
          // Where the Show Report comes from: the online match id (socket push) or a bot report key.
          ...(mode === 'online' && matchId ? { reportKey: matchId } : mode === 'bot' ? { reportKey } : {}),
          venueTier,
          // A wagered match shows the server's settlement instead of the flat
          // reward (see wagerResult.ts / result-placeholder.tsx).
          ...(wagered && matchId ? { wagerMatchId: matchId, buyIn: String(buyIn), prize: String(prize) } : {}),
          // Piece values each side captured (display only, result screen).
          myPoints: String(capturedPoints(playerColor === 'w' ? game.capturedByWhite : game.capturedByBlack)),
          oppPoints: String(capturedPoints(playerColor === 'w' ? game.capturedByBlack : game.capturedByWhite)),
          // Lets the result screen offer "Add Friend" for a signed-in online
          // opponent you just played.
          ...(mode === 'online' && opponentUserId
            ? { opponentUserId, opponentName: opponentDisplayName }
            : {}),
        },
      });
    }, 900);
  }

  // useChessClock is created *after* game (it needs game.turn/isGameOver), but
  // useChessGame's onClockSync needs to reach it. Broken with a ref assigned
  // in an effect (not in render -- keeps this component optimizable): the
  // stable onClockSync closure below reads clockRef.current at CALL time (only
  // when a move:applied arrives), by which point the effect has run.
  const clockRef = useRef<{ reconcile: (c: ClockTimes) => void } | null>(null);
  const onClockSync = useCallback((clocks: ClockTimes) => clockRef.current?.reconcile(clocks), []);

  const game = useChessGame({
    mode,
    difficulty,
    requestEngineMove,
    // Bot mode only: the human picked a side, so the bot takes the other one.
    botColor: opponentColor,
    online,
    onGameOver: handleGameOver,
    onClockSync,
  });
  const chat = useMatchChat({ mode, online, isOpen: chatOpen });
  const replay = useMatchReplay(historySnapshot?.pgn ?? null, historySnapshot?.moveElapsedMs ?? null);
  // Opens on the LATEST ply, not move 0 -- this is a peek at "how did we get
  // here", not a from-the-start replay. Only fires on the false->true
  // transition (not every render while active) so it never fights the
  // player's own scrubbing. Relies on ordinary effect-ordering:
  // useMatchReplay's own internal reset-to-0 effect (keyed on `plies`
  // identity, declared inside the hook call above) always runs first within
  // the same commit, and this effect runs immediately after -- React batches
  // both setPlyIndex calls into one render, so there's no visible flash of
  // move 0.
  const wasPeekActiveRef = useRef(peekActive);
  // Bot matches are issued by the server first (so a win can be verified later).
  // Guests, or a failed call, simply play unrewarded.
  const botSessionRef = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== 'bot' || !botId) return;
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      try {
        const { sessionId } = await startBotMatch(token, botId, playerColor);
        if (!cancelled) botSessionRef.current = sessionId;
      } catch (error) {
        console.log('Failed to start bot match', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, botId, playerColor]);

  // Make sure the shared wager:settled listener is attached for the whole online
  // match, so the settlement is cached even if it lands after we navigate away.
  useEffect(() => {
    if (mode === 'online') {
      ensureWagerListener();
      ensureProgressionListener();
    }
  }, [mode]);

  useEffect(() => {
    if (peekActive && !wasPeekActiveRef.current) replay.goTo(replay.totalPlies);
    wasPeekActiveRef.current = peekActive;
  }, [peekActive, replay.totalPlies, replay.goTo]);
  const animateOpponentMove = game.lastMoveSource !== null && game.lastMoveSource !== 'human';
  // Destructured so the useCallbacks below can depend on the individual
  // methods (stable via React Compiler) rather than the whole `game` object,
  // which changes identity on every move.
  const { handleSquarePress, reportTimeout, resign, offerDraw, respondToDraw } = game;

  const parsedClockW = Number(clockWParam);
  const parsedClockB = Number(clockBParam);
  const parsedIncrement = Number(incrementMsParam);
  // bot/local: honour the time control picked on the bots screen; fall back to
  // 5 min for online (server-authoritative), private rooms, and direct nav.
  const pickedDuration = isDuration(durationParam) ? durationParam : null;
  // Net material lead (white minus black), measured on the live board -- not the
  // peek board, matching the captured trays -- so a promotion counts. Only the
  // leading side's row shows it (see PlayerRow `lead`).
  const materialDiff = useMemo(() => materialLead(game.board), [game.board]);
  const whiteLead = Math.max(0, materialDiff);
  const blackLead = Math.max(0, -materialDiff);

  const initialClockMs = useMemo(() => {
    if (mode === 'online' && Number.isFinite(parsedClockW) && Number.isFinite(parsedClockB)) {
      return { w: parsedClockW, b: parsedClockB };
    }
    const ms = pickedDuration ? DURATION_MS[pickedDuration] : DEFAULT_CLOCK_MS;
    return { w: ms, b: ms };
  }, [mode, parsedClockW, parsedClockB, pickedDuration]);
  const clockIncrementMs = mode === 'online' && Number.isFinite(parsedIncrement) ? parsedIncrement : 0;

  const onExpire = useCallback((color: 'w' | 'b') => reportTimeout(color), [reportTimeout]);
  // Freeze the clock on a real chess ending OR any other game end (resign,
  // timeout, forfeit, agreed draw) -- the latter don't set game.isGameOver.
  const clockFrozen = game.isGameOver || matchEnded;
  const clock = useChessClock({
    turn: game.turn,
    isGameOver: clockFrozen,
    initialMs: initialClockMs,
    incrementMs: clockIncrementMs,
    onExpire,
  });
  useEffect(() => {
    clockRef.current = clock;
  }, [clock]);

  // A match you've started can't be walked out of -- Android hardware back
  // opens the resign confirmation instead of leaving. The swipe-back gesture
  // is already disabled app-wide (_layout.tsx). The only exits are the result
  // screen (game over), Resign, or an agreed Draw.
  useEffect(() => {
    const onBack = () => {
      if (!game.isGameOver && !navigatedRef.current) setResignVisible(true);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [game.isGameOver]);

  // Safety net: if the match screen ever unmounts for a reason we didn't
  // block (a bug, a forced logout) while an online game is still live, resign
  // it server-side so the opponent isn't left hanging until the disconnect
  // timer. `matchId` is a stable string, so this cleanup only runs on a real
  // unmount.
  const liveGameOverRef = useRef(game.isGameOver);
  liveGameOverRef.current = game.isGameOver;
  const onlineMatchId = online?.matchId;
  useEffect(() => {
    return () => {
      if (mode === 'online' && onlineMatchId && !liveGameOverRef.current && !navigatedRef.current) {
        getSocket().emit('match:resign', { matchId: onlineMatchId });
      }
    };
  }, [mode, onlineMatchId]);

  const handleBoardSquarePress = useCallback(
    (square: string) => handleSquarePress(square as Parameters<typeof handleSquarePress>[0]),
    [handleSquarePress],
  );
  const openChat = useCallback(() => setChatOpen(true), []);
  const closeChat = useCallback(() => setChatOpen(false), []);
  const togglePeek = useCallback(() => {
    if (peekActive) {
      setPeekActive(false);
      return;
    }
    setHistorySnapshot(game.getReplayData());
    setPeekActive(true);
  }, [peekActive, game.getReplayData]);
  const openResign = useCallback(() => setResignVisible(true), []);
  const cancelResign = useCallback(() => setResignVisible(false), []);
  const confirmResign = useCallback(() => {
    setResignVisible(false);
    resign(playerColor);
  }, [resign, playerColor]);
  const acceptDraw = useCallback(() => respondToDraw(true), [respondToDraw]);
  const declineDraw = useCallback(() => respondToDraw(false), [respondToDraw]);

  const drawIncoming = game.drawOfferFrom !== null && game.drawOfferFrom !== playerColor && !game.isGameOver;
  const headerPad = useMemo(() => ({ paddingTop: insets.top + Spacing.sm }), [insets.top]);
  const actionBarPad = useMemo(
    () => ({ ...actionBarStyle, paddingBottom: insets.bottom + 10 }),
    [actionBarStyle, insets.bottom],
  );

  // Height of the strip between the two player rows, measured so the board can
  // be capped to it (see BOARD_* above). null until the first layout pass; the
  // strip is flex:1, so its height never depends on the board inside it and
  // sizing the board from it can't feed back into itself.
  const [boardAreaHeight, setBoardAreaHeight] = useState<number | null>(null);
  const handleBoardAreaLayout = useCallback(
    (event: LayoutChangeEvent) => {
      // The chat sheet's keyboard can squeeze the screen; don't let that shrink
      // the board behind it and snap it back on close.
      if (chatOpen) return;
      setBoardAreaHeight(Math.max(0, Math.round(event.nativeEvent.layout.height)));
    },
    [chatOpen],
  );
  const boardMaxSize =
    boardAreaHeight === null
      ? undefined
      : Math.max(MIN_BOARD_SIZE, boardAreaHeight - PEEK_NAV_HEIGHT - BOARD_VERTICAL_GAP * 2);

  return (
    <View style={styles.root}>
      <VenueBackdrop venueTier={venueTier} />
      <StockfishEngine ref={stockfishRef} enabled={isStockfishTier} />
      <Image
        source={ScreenArt.frontRowCrowd}
        contentFit="cover"
        cachePolicy="memory-disk"
        style={styles.crowdImage}
      />

      <View className="flex-row items-center justify-between px-lg pb-sm" style={headerPad}>
        <View className="flex-row items-center" style={{ gap: Spacing.sm }}>
          {/* The wordmark gives way to the pot pill in a wagered match: both
              together would not fit a 360px header next to the menu button. */}
          {wagered ? null : (
            <Text className="font-display-hero text-cyan" style={styles.wordmark}>
              RockStyle Chess
            </Text>
          )}
          <View
            className="flex-row items-center rounded-full px-sm"
            style={{
              gap: 4,
              paddingVertical: 3,
              borderWidth: 1,
              backgroundColor: withOpacity(venue.accentColor, venueIntensity.glowOpacity * 0.15),
              borderColor: withOpacity(venue.accentColor, venueIntensity.glowOpacity),
              boxShadow: `0px 0px ${venueIntensity.glowRadius}px ${withOpacity(venue.accentColor, venueIntensity.glowOpacity * 0.5)}`,
            }}
          >
            <MaterialCommunityIcons name={venue.icon} size={11} color={venue.accentColor} />
            <Text className="font-heading" style={{ fontSize: 9, color: venue.accentColor }}>
              {venue.name.toUpperCase()}
            </Text>
          </View>
          {wagered ? (
            <View
              className="flex-row items-center rounded-full px-sm"
              style={{
                gap: 4,
                paddingVertical: 3,
                borderWidth: 1,
                backgroundColor: withOpacity(Colors.gold, 0.12),
                borderColor: withOpacity(Colors.gold, 0.6),
              }}
            >
              <MaterialCommunityIcons name="poker-chip" size={11} color={Colors.gold} />
              <Text className="font-heading" style={{ fontSize: 9, color: Colors.gold }}>
                WIN {formatChips(prize)}
              </Text>
            </View>
          ) : null}
        </View>
        <Pressable
          onPress={openResign}
          className="h-10 w-10 items-center justify-center rounded-full"
          style={menuButtonStyle}
        >
          <MaterialCommunityIcons name="dots-vertical" size={20} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <View className="flex-1 px-md pb-sm">
        <PlayerRow
          name={opponentDisplayName}
          avatarId={opponentAvatarKey}
          avatarEmoji={opponentAvatarEmoji}
          avatarSource={mode === 'bot' && botId ? BOT_PORTRAITS[botId] : undefined}
          countryCode={mode === 'online' ? (opponentCountry ?? null) : null}
          rank={opponentRank}
          getRemaining={clock.getRemaining}
          color={opponentColor}
          accent={Colors.crimson}
          pulsing={game.turn === opponentColor && !clockFrozen}
          running={!clockFrozen}
          captured={opponentColor === 'w' ? game.capturedByWhite : game.capturedByBlack}
          lead={opponentColor === 'w' ? whiteLead : blackLead}
          pieceSprites={pieceSprites}
        />

        <View style={styles.boardArea} onLayout={handleBoardAreaLayout}>
          <View style={styles.boardStack}>
            <ChessBoard
              variant="large"
              maxSize={boardMaxSize}
              // Bled into the column's side padding; invisible until boardArea
              // has been measured, so it never flashes at an uncapped size.
              style={boardAreaHeight === null ? styles.boardBleedHidden : styles.boardBleed}
              board={peekActive ? replay.board : game.board}
              selectedSquare={peekActive ? null : game.selectedSquare}
              legalTargets={peekActive ? [] : game.legalTargets}
              checkSquare={peekActive ? replay.checkSquare : game.checkSquare}
              lastMove={peekActive ? replay.lastMove : game.lastMove}
              turn={peekActive ? replay.turn : game.turn}
              flipped={flipBoard}
              animateLastMove={peekActive ? false : animateOpponentMove}
              lastMoveSound={peekActive ? null : game.lastMoveSound}
              // Omitting onSquarePress keeps the board read-only while peeking
              // -- ChessBoard's own `interactive` gate (tap AND drag) is
              // `Boolean(onSquarePress)`.
              onSquarePress={peekActive ? undefined : handleBoardSquarePress}
              theme={boardTheme}
              pieceSprites={pieceSprites}
            />
            {/* Fixed height, always rendered (even when not peeking) so this
                reserved strip below the board never appears/disappears and
                shifts the board's own vertical position when peek mode
                toggles -- only its contents are conditional. */}
            <View style={styles.peekNavSlot}>
              {peekActive ? (
                <PeekNav
                  onPrev={replay.prev}
                  onNext={replay.next}
                  atStart={replay.plyIndex === 0}
                  atLatest={replay.plyIndex >= replay.totalPlies}
                  label={
                    replay.totalPlies === 0
                      ? 'No moves yet'
                      : replay.plyIndex === 0
                        ? 'Start'
                        : `Move ${replay.plyIndex} / ${replay.totalPlies}`
                  }
                />
              ) : null}
            </View>
          </View>
        </View>

        <PlayerRow
          name={profile?.displayName ?? 'AXL_CHESS'}
          avatarId={profile?.avatarId ?? null}
          countryCode={profile?.country ?? null}
          rank={myRank}
          getRemaining={clock.getRemaining}
          color={playerColor}
          accent={Colors.cyan}
          pulsing={game.turn === playerColor && !clockFrozen}
          running={!clockFrozen}
          captured={playerColor === 'w' ? game.capturedByWhite : game.capturedByBlack}
          lead={playerColor === 'w' ? whiteLead : blackLead}
          pieceSprites={pieceSprites}
        />
      </View>

      <View className="flex-row items-center gap-sm rounded-t-xl px-margin-mobile pt-md" style={actionBarPad}>
        <ActionPillButton
          icon="chat"
          label="Chat"
          onPress={openChat}
          disabled={mode !== 'online'}
          badgeCount={mode === 'online' ? chat.unreadCount : 0}
        />
        <ActionPillButton icon="flag" label="Resign" tone="danger" onPress={openResign} />
        <ActionPillButton
          icon={peekActive ? 'eye-off' : 'history'}
          label={peekActive ? 'Live' : 'Moves'}
          onPress={togglePeek}
          active={peekActive}
          disabled={!peekActive && (game.moveCount === 0 || game.lastMove === null)}
        />
        {mode !== 'bot' ? (
          <ActionPillButton
            icon="handshake"
            label={game.drawOfferFrom === playerColor ? 'Offered' : 'Draw'}
            onPress={offerDraw}
            disabled={game.isGameOver || game.drawOfferFrom === playerColor}
          />
        ) : null}
      </View>

      <ChatPanel
        visible={chatOpen}
        onClose={closeChat}
        messages={chat.messages}
        myColor={playerColor}
        onSend={chat.send}
        canSend={chat.canSend && !game.isGameOver}
      />

      {chat.toastMessage ? (
        <ChatToast key={chat.toastMessage.id} message={chat.toastMessage} onDismiss={chat.dismissToast} />
      ) : null}

      {resignVisible ? (
        <ConfirmModal
          visible
          variant="danger"
          icon="flag"
          title="Resign Match?"
          message="This counts as a loss and your rating will drop. This can't be undone."
          confirmLabel="Resign"
          onCancel={cancelResign}
          onConfirm={confirmResign}
        />
      ) : null}

      {game.pendingPromotion ? (
        <PromotionPicker
          color={game.turn}
          pieceSprites={pieceSprites}
          onPick={game.completePromotion}
          onCancel={game.cancelPromotion}
        />
      ) : null}

      {drawIncoming ? (
        <ConfirmModal
          visible
          variant="neutral"
          icon="handshake"
          title="Accept Draw?"
          message={`${opponentDisplayName} offers a draw. Accepting ends the match as a draw.`}
          confirmLabel="Accept"
          cancelLabel="Decline"
          onConfirm={acceptDraw}
          onCancel={declineDraw}
        />
      ) : null}
    </View>
  );
}

const PlayerRow = memo(function PlayerRow({
  name,
  avatarId,
  avatarEmoji,
  avatarSource,
  countryCode = null,
  rank,
  getRemaining,
  color,
  accent,
  pulsing = false,
  running,
  captured = [],
  lead = 0,
  pieceSprites,
}: {
  name: string;
  avatarId?: string | null;
  avatarEmoji?: string;
  /** A bundled portrait (a roster bot's painted face); wins over the emoji. */
  avatarSource?: ImageSourcePropType;
  countryCode?: string | null;
  rank: string;
  getRemaining: (color: 'w' | 'b') => number;
  color: 'w' | 'b';
  accent: string;
  pulsing?: boolean;
  running: boolean;
  captured?: string[];
  /** Net material lead in points; > 0 only on the side that is ahead. */
  lead?: number;
  pieceSprites: PieceSpriteMap;
}) {
  // `captured` holds the pieces this row's player has taken -- i.e. the
  // opposite color's.
  const capturedColor = color === 'w' ? 'b' : 'w';
  const sortedCaptured = [...captured].sort(
    (x, y) => CAPTURED_ORDER.indexOf(x) - CAPTURED_ORDER.indexOf(y),
  );
  return (
    // items-start: the name column below is taller than the avatar and the
    // timer (it carries the capture slot), so top-aligning keeps all three level
    // whether or not anything has been captured yet.
    <View className="flex-row items-start justify-between gap-sm px-sm py-xs">
      <View className="flex-shrink flex-row items-start gap-sm">
        <PlayerAvatar avatarId={avatarId} emoji={avatarEmoji} source={avatarSource} size="small" />
        <View className="flex-shrink">
          <View className="flex-row items-center gap-1">
            <CountryFlag code={countryCode} size={12} />
            <Text className="font-display-hero uppercase text-text-primary" style={styles.playerName} numberOfLines={1}>
              {name}
            </Text>
          </View>
          <View className="mt-0.5 flex-row items-center gap-1">
            <MaterialCommunityIcons name="star" size={11} color={Colors.gold} />
            <Text className="font-heading-md uppercase text-text-muted" style={styles.playerRank}>
              {rank}
            </Text>
          </View>
          {/* Under the name, where chess.com puts it, sharing the avatar's
              height instead of stacking under the timer (which made every row
              ~30px taller). Rendered even while empty: if the slot only
              appeared with the first capture the row would grow by its height
              right then, nudging the board (and, when the board is
              height-capped, resizing it) mid-game. */}
          <View style={styles.capturedRow}>
          <View
            className="flex-row items-center"
            style={captured.length > 0 ? CAPTURED_TRAY_FILLED_STYLE : CAPTURED_TRAY_STYLE}
          >
            {sortedCaptured.map((piece, index) => (
              <Image
                key={`${piece}-${index}`}
                source={pieceSprites[capturedColor + piece]}
                contentFit="contain"
                // Same reason as the board's own sprites: these are heavy SVGs,
                // and the default cache only keeps the bytes, not the decode.
                cachePolicy="memory-disk"
                style={{
                  width: CAPTURED_PIECE_SIZE,
                  height: CAPTURED_PIECE_SIZE,
                  marginLeft:
                    index === 0
                      ? 0
                      : (piece === sortedCaptured[index - 1] ? CAPTURED_STEP_SAME : CAPTURED_STEP_DIFFERENT) -
                        CAPTURED_PIECE_SIZE,
                }}
              />
            ))}
          </View>
          {/* Material lead, chess.com style. Lives inside the tray row (which is
              already a fixed CAPTURED_PIECE_SIZE tall), so it can never change
              the row's height -- and therefore the board's. flexShrink 0: if the
              tray is overlong the pieces clip, never this number. */}
          {lead > 0 ? <Text style={styles.materialLead}>+{lead}</Text> : null}
          </View>
        </View>
      </View>

      <TimerPill getRemaining={getRemaining} color={color} accent={accent} pulsing={pulsing} running={running} />
    </View>
  );
});

type ClockUrgency = 'normal' | 'low' | 'critical';

// Absolute thresholds, not proportional to base time -- the last 10-30
// seconds reads as "flag territory" regardless of whether the game started
// with 3 or 10 minutes on the clock, matching established chess-app convention.
function clockUrgency(ms: number): ClockUrgency {
  if (ms < 10_000) return 'critical';
  if (ms < 30_000) return 'low';
  return 'normal';
}

function formatClockMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

// Owns its own 1Hz tick so the clock counting down never re-renders the match
// screen (or the board) -- only this ~90px pill re-renders each second. Polls
// the stable clock.getRemaining() (see useChessClock.ts). Urgency color
// applies regardless of whose turn it is (a frozen-but-low clock is still
// worth flagging); the breathing pulse is reserved for critical AND actively
// ticking.
const TimerPill = memo(function TimerPill({
  getRemaining,
  color,
  accent,
  pulsing,
  running,
}: {
  getRemaining: (color: 'w' | 'b') => number;
  color: 'w' | 'b';
  accent: string;
  pulsing: boolean;
  running: boolean;
}) {
  const [ms, setMs] = useState(() => getRemaining(color));

  useEffect(() => {
    // Re-sync immediately on mount / turn flip / game-over / online reconcile,
    // then tick once a second while the game is live.
    setMs(getRemaining(color));
    if (!running) return;
    const id = setInterval(() => setMs(getRemaining(color)), 1000);
    return () => clearInterval(id);
  }, [getRemaining, color, running, pulsing]);

  const urgency = clockUrgency(ms);
  const isCriticalAndTicking = urgency === 'critical' && pulsing;
  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = isCriticalAndTicking
      ? withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true)
      : 0;
  }, [isCriticalAndTicking, pulse]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: isCriticalAndTicking ? 0.75 + pulse.value * 0.25 : 1,
    transform: [{ scale: isCriticalAndTicking ? 1 + pulse.value * 0.05 : 1 }],
  }));

  const urgencyColor =
    urgency === 'critical' ? Colors.crimson : urgency === 'low' ? Colors.gold : pulsing ? accent : Colors.chromeMid;

  return (
    <Animated.View
      className="items-center justify-center rounded-lg px-md"
      style={[
        {
          minWidth: 92,
          paddingVertical: 6,
          borderWidth: 1,
          backgroundColor: withOpacity(urgencyColor, pulsing ? 0.12 : 0.06),
          borderColor: withOpacity(urgencyColor, pulsing ? 0.9 : 0.35),
          boxShadow: pulsing ? `0px 0px 15px ${withOpacity(urgencyColor, 0.5)}` : undefined,
        },
        animatedStyle,
      ]}
    >
      <Text className="font-display-hero" style={{ fontSize: 22, color: urgencyColor }}>
        {formatClockMs(ms)}
      </Text>
    </Animated.View>
  );
});

const ActionPillButton = memo(function ActionPillButton({
  icon,
  label,
  onPress,
  tone = 'neutral',
  active = false,
  disabled = false,
  badgeCount = 0,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'danger';
  /** Toggled-on look (e.g. the Moves button while peek mode is active). */
  active?: boolean;
  disabled?: boolean;
  badgeCount?: number;
}) {
  const bg = tone === 'danger' ? Colors.crimson : active ? withOpacity(Colors.cyan, 0.2) : withOpacity(Colors.chromeDark, 0.25);
  const border =
    tone === 'danger' ? withOpacity(Colors.textPrimary, 0.2) : active ? Colors.cyan : withOpacity(Colors.chromeDark, 0.4);
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className="h-12 flex-1 flex-row items-center justify-center gap-1 rounded-lg"
      style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, opacity: disabled ? 0.4 : 1 }}
    >
      <MaterialCommunityIcons name={icon} size={16} color={active ? Colors.cyan : Colors.textPrimary} />
      <Text
        className="font-button-label uppercase text-text-primary"
        style={[styles.actionLabel, active && { color: Colors.cyan }]}
      >
        {label}
      </Text>
      {badgeCount > 0 ? (
        <View className="absolute items-center justify-center rounded-full px-1" style={styles.actionBadge}>
          <Text className="font-heading-md" style={styles.actionBadgeText}>
            {badgeCount > 9 ? '9+' : badgeCount}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
});

// Prev/next buttons + a ply-position pill, centered as one inline row in the
// reserved strip below the board (see peekNavSlot/MatchScreen) -- NOT an
// overlay on the board itself, so it never sits on top of the pieces.
// Reuses useMatchReplay's own transport (prev/next), the same hook the
// post-game replay screen (replay.tsx) drives its full-screen board with.
const PeekNav = memo(function PeekNav({
  onPrev,
  onNext,
  atStart,
  atLatest,
  label,
}: {
  onPrev: () => void;
  onNext: () => void;
  atStart: boolean;
  atLatest: boolean;
  label: string;
}) {
  return (
    <View style={styles.peekNavRow}>
      <Pressable
        onPress={atStart ? undefined : onPrev}
        disabled={atStart}
        style={[styles.peekNavButton, atStart && styles.peekNavButtonDisabled]}
      >
        <MaterialCommunityIcons name="chevron-left" size={20} color={Colors.cyan} />
      </Pressable>
      <View style={styles.peekLabelPill}>
        <Text style={styles.peekLabelText}>{label}</Text>
      </View>
      <Pressable
        onPress={atLatest ? undefined : onNext}
        disabled={atLatest}
        style={[styles.peekNavButton, atLatest && styles.peekNavButtonDisabled]}
      >
        <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.cyan} />
      </Pressable>
    </View>
  );
});

// #region Styles
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  crowdImage: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: '22%',
    opacity: 0.35,
  },
  wordmark: { fontSize: 16, fontStyle: 'italic', letterSpacing: 0.5 },
  playerName: { fontSize: 14 },
  playerRank: { fontSize: 10 },
  // Tray pill + lead label side by side. minWidth 0 lets the pill (not the
  // label) be the thing that shrinks inside the name column.
  capturedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%', height: CAPTURED_PIECE_SIZE },
  materialLead: { flexShrink: 0, fontFamily: Fonts.heading, fontSize: 12, color: Colors.gold },
  actionLabel: { fontSize: 13 },
  actionBadge: { top: -4, right: -4, minWidth: 16, height: 16, backgroundColor: Colors.emberLight },
  actionBadgeText: { fontSize: 9, color: Colors.bgBase },
  // Deliberately no alignItems/justifyContent here -- ChessBoard's own root
  // style resolves a percentage width + aspectRatio against this wrapper;
  // giving the wrapper a non-stretch alignItems collapses that resolution
  // to a near-zero intrinsic size on web (verified: alignItems: 'center'
  // shrank an 8x8 board to ~24px). Default (unset) alignItems is 'stretch',
  // which both ChessBoard and peekNavSlot below need to size correctly.
  boardStack: {
    position: 'relative',
  },
  // Takes whatever height the two player rows leave and centres the board
  // (+ its peek strip) in it. Measured by onLayout to cap the board's height.
  // justifyContent only -- no alignItems, for the reason given above.
  boardArea: {
    flex: 1,
    justifyContent: 'center',
  },
  // Applied to ChessBoard's wrapper: negative side margins let the board bleed
  // into the column's px-md padding (see BOARD_SIDE_BLEED).
  boardBleed: {
    marginHorizontal: -BOARD_SIDE_BLEED,
  },
  boardBleedHidden: {
    marginHorizontal: -BOARD_SIDE_BLEED,
    opacity: 0,
  },
  // Fixed height, always present (see the comment at its call site) -- a
  // plain in-flow row below the board, never an overlay on top of it.
  peekNavSlot: {
    height: PEEK_NAV_HEIGHT,
    justifyContent: 'center',
    alignItems: 'center',
  },
  peekNavRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  peekNavButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.cyan, 0.12),
    borderWidth: 1,
    borderColor: withOpacity(Colors.cyan, 0.5),
  },
  peekNavButtonDisabled: { opacity: 0.3 },
  peekLabelPill: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    borderWidth: 1,
    borderColor: withOpacity(Colors.cyan, 0.35),
  },
  peekLabelText: {
    fontFamily: Fonts.heading,
    fontSize: 10,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.cyan,
  },
});
// #endregion
