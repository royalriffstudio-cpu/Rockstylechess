import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ChatPanel, ChatToast, ChessBoard, ConfirmModal, PlayerAvatar, VenueBackdrop } from '@/components/ui';
import { StockfishEngine, type StockfishEngineHandle } from '@/components/StockfishEngine';
import { getPieceSprites } from '@/components/ui/pieceSprites';
import { getAvatarImage } from '@/constants/avatars';
import { getBoardTheme } from '@/constants/boardThemes';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import { getVenue, getVenueIntensity } from '@/constants/venues';
import { useChessClock, type ClockTimes } from '@/hooks/useChessClock';
import { useChessGame, type BotDifficulty, type ChessGameResult, type GameMode } from '@/hooks/useChessGame';
import { useMatchChat } from '@/hooks/useMatchChat';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { claimMatchReward, reportMatchForQuests } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { getSocket } from '@/lib/socket';
import type { EngineMove, StockfishConfig } from '@/lib/botEngine';
import { setPendingLocalReplay, type LocalMatchReplay } from '@/lib/localMatchReplayStore';
import { MATCH_CHIP_REWARDS } from '@/lib/matchRewards';
import { DURATION_MS, isDuration, isVenueTier } from '@/lib/onlineMatch';


// Bot/local always default to this (matches setup.tsx's own default duration
// pick, no dedicated picker exists for these modes). Online's real starting
// time comes from the server (via matchmaking.tsx/game-room.tsx's route params,
// themselves from queue:matched) -- clockW/clockB/incrementMs are only ever
// present for mode === 'online'; bot/local always fall through to this.
const DEFAULT_CLOCK_MS = 5 * 60_000;

// Pieces are always lowercase letters from chess.js's `captured` field --
// a tiny local glyph map just for rendering the captured-piece trays.
const CAPTURED_GLYPHS: Record<string, string> = {
  p: '♟', n: '♞', b: '♝', r: '♜', q: '♛',
};

const CAPTURED_TRAY_STYLE = {
  paddingVertical: 2,
  backgroundColor: withOpacity(Colors.chromeDark, 0.35),
  maxWidth: 120,
} as const;

// Navigation params: bots.tsx passes mode=bot + difficulty (which of the
// four bot engines to use) + color (the "Play As" pick); matchmaking.tsx
// passes mode=online + matchId/color/fen/opponentName once the server has
// paired a real opponent; the PvP/"Iron Duel" flow otherwise defaults to
// local pass-and-play. `color=b` also flips the board (see flipBoard below).
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
    opponentUserId,
    botName,
    botEmoji,
    clockW: clockWParam,
    clockB: clockBParam,
    incrementMs: incrementMsParam,
    duration: durationParam,
    venueTier: venueTierParam,
  } = useLocalSearchParams<{
    mode?: string;
    difficulty?: string;
    matchId?: string;
    color?: string;
    fen?: string;
    opponentName?: string;
    opponentAvatarId?: string;
    opponentUserId?: string;
    botName?: string;
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
  // of this screen (it remounts per game).
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
  const opponentAvatarSource = mode === 'online' ? getAvatarImage(opponentAvatarId) : undefined;
  const opponentAvatarEmoji = mode === 'bot' ? botEmoji || '🤖' : mode === 'online' ? undefined : '🤘';
  const navigatedRef = useRef(false);
  const stockfishRef = useRef<StockfishEngineHandle>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [resignVisible, setResignVisible] = useState(false);
  const { profile, refresh: refreshPlayerProfile } = usePlayerProfile();
  const boardTheme = getBoardTheme(profile?.equippedBoardId);
  const pieceSprites = getPieceSprites(profile?.equippedPieceId);
  // Atmosphere only -- never feeds boardTheme/pieceSprites above, which stay
  // driven purely by the player's equipped Forge cosmetic regardless of venue.
  const venueTier = isVenueTier(venueTierParam) ? venueTierParam : 'garage';
  const venue = getVenue(venueTier);
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
      reason = result.agreed ? 'agreement' : 'draw';
    }
    console.log('Game over', outcome, reason);

    const chipsGranted = MATCH_CHIP_REWARDS[outcome];
    if (mode !== 'online') {
      // Bot/local matches never reach the server otherwise (pure
      // client-side chess.js) -- this is the only point a reward gets
      // persisted for those modes. Online matches are already credited
      // authoritatively server-side, inside persistMatchResult.ts, at the
      // same moment this fires -- calling the claim endpoint here too
      // would double-credit.
      const token = await getAuthToken();
      if (token) {
        try {
          await claimMatchReward(token, outcome);
        } catch (error) {
          console.log('Failed to claim match reward', error);
        }
        try {
          const capturedCount =
            playerColor === 'w' ? game.capturedByWhite.length : game.capturedByBlack.length;
          await reportMatchForQuests(token, {
            won: outcome === 'win',
            checkmate: outcome === 'win' && reason === 'checkmate',
            capturedCount,
          });
        } catch (error) {
          console.log('Failed to report match for quests', error);
        }
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
        resultType: reason as LocalMatchReplay['resultType'],
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
          venueTier,
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
  const initialClockMs = useMemo(() => {
    if (mode === 'online' && Number.isFinite(parsedClockW) && Number.isFinite(parsedClockB)) {
      return { w: parsedClockW, b: parsedClockB };
    }
    const ms = pickedDuration ? DURATION_MS[pickedDuration] : DEFAULT_CLOCK_MS;
    return { w: ms, b: ms };
  }, [mode, parsedClockW, parsedClockB, pickedDuration]);
  const clockIncrementMs = mode === 'online' && Number.isFinite(parsedIncrement) ? parsedIncrement : 0;

  const onExpire = useCallback((color: 'w' | 'b') => reportTimeout(color), [reportTimeout]);
  const clock = useChessClock({
    turn: game.turn,
    isGameOver: game.isGameOver,
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
          <Text className="font-display-hero text-cyan" style={styles.wordmark}>
            RockStyle Chess
          </Text>
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
        </View>
        <Pressable
          onPress={openResign}
          className="h-10 w-10 items-center justify-center rounded-full"
          style={menuButtonStyle}
        >
          <MaterialCommunityIcons name="dots-vertical" size={20} color={Colors.textPrimary} />
        </Pressable>
      </View>

      <View className="flex-1 justify-between px-md pb-sm">
        <PlayerRow
          name={opponentDisplayName}
          avatarSource={opponentAvatarSource}
          avatarEmoji={opponentAvatarEmoji}
          rank="GRANDMASTER (2150)"
          getRemaining={clock.getRemaining}
          color={opponentColor}
          accent={Colors.crimson}
          pulsing={game.turn === opponentColor}
          running={!game.isGameOver}
          captured={opponentColor === 'w' ? game.capturedByWhite : game.capturedByBlack}
        />

        <ChessBoard
          board={game.board}
          selectedSquare={game.selectedSquare}
          legalTargets={game.legalTargets}
          checkSquare={game.checkSquare}
          lastMove={game.lastMove}
          turn={game.turn}
          flipped={flipBoard}
          animateLastMove={animateOpponentMove}
          lastMoveSound={game.lastMoveSound}
          onSquarePress={handleBoardSquarePress}
          theme={boardTheme}
          pieceSprites={pieceSprites}
        />

        <PlayerRow
          name={profile?.displayName ?? 'AXL_CHESS'}
          avatarSource={getAvatarImage(profile?.avatarId)}
          rank="PRO (2145)"
          getRemaining={clock.getRemaining}
          color={playerColor}
          accent={Colors.cyan}
          pulsing={game.turn === playerColor}
          running={!game.isGameOver}
          captured={playerColor === 'w' ? game.capturedByWhite : game.capturedByBlack}
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
  avatarSource,
  avatarEmoji,
  rank,
  getRemaining,
  color,
  accent,
  pulsing = false,
  running,
  captured = [],
}: {
  name: string;
  avatarSource?: ImageSourcePropType;
  avatarEmoji?: string;
  rank: string;
  getRemaining: (color: 'w' | 'b') => number;
  color: 'w' | 'b';
  accent: string;
  pulsing?: boolean;
  running: boolean;
  captured?: string[];
}) {
  return (
    <View className="flex-row items-center justify-between gap-sm px-sm py-xs">
      <View className="flex-shrink flex-row items-center gap-sm">
        <PlayerAvatar source={avatarSource} emoji={avatarEmoji} size="small" />
        <View className="flex-shrink">
          <Text className="font-display-hero uppercase text-text-primary" style={styles.playerName} numberOfLines={1}>
            {name}
          </Text>
          <View className="mt-0.5 flex-row items-center gap-1">
            <MaterialCommunityIcons name="star" size={11} color={Colors.gold} />
            <Text className="font-heading-md uppercase text-text-muted" style={styles.playerRank}>
              {rank}
            </Text>
          </View>
        </View>
      </View>

      <View className="items-end gap-1">
        <TimerPill getRemaining={getRemaining} color={color} accent={accent} pulsing={pulsing} running={running} />
        {captured.length > 0 ? (
          <View className="flex-row flex-wrap rounded-full px-sm" style={CAPTURED_TRAY_STYLE}>
            {captured.map((piece, index) => (
              <Text key={`${piece}-${index}`} style={{ fontSize: 13, color: accent, opacity: 0.9 }}>
                {CAPTURED_GLYPHS[piece] ?? ''}
              </Text>
            ))}
          </View>
        ) : null}
      </View>
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
  disabled = false,
  badgeCount = 0,
}: {
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: 'neutral' | 'danger';
  disabled?: boolean;
  badgeCount?: number;
}) {
  const bg = tone === 'danger' ? Colors.crimson : withOpacity(Colors.chromeDark, 0.25);
  const border = tone === 'danger' ? withOpacity(Colors.textPrimary, 0.2) : withOpacity(Colors.chromeDark, 0.4);
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      className="h-12 flex-1 flex-row items-center justify-center gap-1 rounded-lg"
      style={{ backgroundColor: bg, borderWidth: 1, borderColor: border, opacity: disabled ? 0.4 : 1 }}
    >
      <MaterialCommunityIcons name={icon} size={16} color={Colors.textPrimary} />
      <Text className="font-button-label uppercase text-text-primary" style={styles.actionLabel}>
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
  actionLabel: { fontSize: 13 },
  actionBadge: { top: -4, right: -4, minWidth: 16, height: 16, backgroundColor: Colors.emberLight },
  actionBadgeText: { fontSize: 9, color: Colors.bgBase },
});
// #endregion
