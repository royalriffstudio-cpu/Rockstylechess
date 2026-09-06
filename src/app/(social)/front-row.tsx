import { Chess, type Square } from 'chess.js';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { ChessBoard, PlayerAvatar, ScreenBackdrop } from '@/components/ui';
import { getAvatarImage } from '@/constants/avatars';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { getLiveMatches, type LiveMatchSummary } from '@/lib/api';
import {
  boardGridFromChess,
  checkSquareFromChess,
  classifyMoveSound,
  pickVerboseLastMove,
  type MoveSoundKind,
  type VerboseLastMove,
} from '@/lib/chessBoardSnapshot';
import { goUp } from '@/lib/navigation';
import { getSocket } from '@/lib/socket';
import {
  joinSpectate,
  leaveSpectate,
  type SpectateCountPayload,
  type SpectateErrorPayload,
  type SpectateJoinedPayload,
  type SpectateMatchEndedPayload,
  type SpectateMoveAppliedPayload,
} from '@/lib/spectateSocket';

const CHAT_TICKER =
  'User_99: Incredible sacrifice!  •  ChessWiz: Hikaru is in trouble now.  •  Grandmaster_Fan: Wait for the engine evaluation!  •  ';

const REACTIONS = ['🔥', '⚡', '👏', '🤯', '👑'];

interface FloatingReaction {
  id: number;
  emoji: string;
  left: number;
}

interface SpectateBoardState {
  board: string[][];
  turn: 'w' | 'b';
  lastMove: VerboseLastMove | null;
  checkSquare: Square | null;
  lastMoveSound: MoveSoundKind | null;
  clocks: Record<'w' | 'b', number>;
  players: SpectateJoinedPayload['players'];
}

type LoadState = 'loading' | 'empty' | 'ready';

export default function FrontRowScreen() {
  const insets = useSafeAreaInsets();
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [matches, setMatches] = useState<LiveMatchSummary[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [boardState, setBoardState] = useState<SpectateBoardState | null>(null);
  const [spectatorCount, setSpectatorCount] = useState(0);
  const [endedResult, setEndedResult] = useState<SpectateMatchEndedPayload['result'] | null>(null);
  const [joinError, setJoinError] = useState(false);

  const chessRef = useRef<Chess | null>(null);
  const watchedMatchIdRef = useRef<string | null>(null);

  const loadMatches = useCallback(() => {
    setLoadState('loading');
    getLiveMatches()
      .then(({ liveMatches }) => {
        setMatches(liveMatches);
        setCurrentIndex(0);
        setLoadState(liveMatches.length > 0 ? 'ready' : 'empty');
      })
      .catch((error) => {
        console.log('front-row: failed to load live matches', error);
        setLoadState('empty');
      });
  }, []);

  useEffect(() => {
    loadMatches();
  }, [loadMatches]);

  // Joins the currently-selected match's spectate room whenever the browsed
  // index changes, leaving whichever one was previously watched.
  useEffect(() => {
    if (loadState !== 'ready') return;
    const matchId = matches[currentIndex]?.matchId;
    if (!matchId) return;

    const previousMatchId = watchedMatchIdRef.current;
    if (previousMatchId && previousMatchId !== matchId) leaveSpectate(previousMatchId);
    watchedMatchIdRef.current = matchId;
    chessRef.current = null;
    setBoardState(null);
    setEndedResult(null);
    setJoinError(false);
    setSpectatorCount(0);
    joinSpectate(matchId);
  }, [currentIndex, loadState, matches]);

  // Leave whatever's being watched when the screen unmounts.
  useEffect(() => {
    return () => {
      if (watchedMatchIdRef.current) leaveSpectate(watchedMatchIdRef.current);
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();

    function handleJoined(payload: SpectateJoinedPayload) {
      if (payload.matchId !== watchedMatchIdRef.current) return;
      const chess = new Chess(payload.fen);
      chessRef.current = chess;
      setBoardState({
        board: boardGridFromChess(chess),
        turn: payload.turn,
        lastMove: null,
        checkSquare: checkSquareFromChess(chess),
        lastMoveSound: null,
        clocks: payload.clocks,
        players: payload.players,
      });
    }

    function handleError(payload: SpectateErrorPayload) {
      if (payload.matchId && payload.matchId !== watchedMatchIdRef.current) return;
      setJoinError(true);
    }

    function handleCount(payload: SpectateCountPayload) {
      if (payload.matchId !== watchedMatchIdRef.current) return;
      setSpectatorCount(payload.count);
    }

    function handleMoveApplied(payload: SpectateMoveAppliedPayload) {
      if (payload.matchId !== watchedMatchIdRef.current || !chessRef.current) return;
      const chess = chessRef.current;
      let lastMove: VerboseLastMove | null = null;
      let lastMoveSound: MoveSoundKind | null = null;
      try {
        const moveEntry = chess.move({ from: payload.from, to: payload.to, promotion: payload.promotion });
        lastMove = pickVerboseLastMove(moveEntry);
        lastMoveSound = classifyMoveSound(chess, moveEntry);
      } catch {
        // Desync fallback -- trust the server's FEN directly, skip the animation.
        chess.load(payload.fen);
      }
      setBoardState((prev) =>
        prev && {
          ...prev,
          board: boardGridFromChess(chess),
          turn: chess.turn(),
          lastMove,
          checkSquare: checkSquareFromChess(chess),
          lastMoveSound,
          clocks: payload.clocks,
        },
      );
    }

    function handleMatchEnded(payload: SpectateMatchEndedPayload) {
      if (payload.matchId !== watchedMatchIdRef.current) return;
      setEndedResult(payload.result);
    }

    socket.on('spectate:joined', handleJoined);
    socket.on('spectate:error', handleError);
    socket.on('spectate:count', handleCount);
    socket.on('move:applied', handleMoveApplied);
    socket.on('match:ended', handleMatchEnded);

    return () => {
      socket.off('spectate:joined', handleJoined);
      socket.off('spectate:error', handleError);
      socket.off('spectate:count', handleCount);
      socket.off('move:applied', handleMoveApplied);
      socket.off('match:ended', handleMatchEnded);
    };
  }, []);

  function goPrev() {
    if (matches.length < 2) return;
    setCurrentIndex((i) => (i - 1 + matches.length) % matches.length);
  }
  function goNext() {
    if (matches.length < 2) return;
    setCurrentIndex((i) => (i + 1) % matches.length);
  }

  function handleReactionPress(emoji: string) {
    const id = Date.now() + Math.random();
    const left = 40 + Math.random() * 60;
    setFloatingReactions((prev) => [...prev, { id, emoji, left }]);
    console.log('Reaction sent', emoji);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2000);
  }

  const listedMatch = matches[currentIndex];
  const players = boardState?.players ?? listedMatch?.players ?? null;
  const overlayMessage = joinError ? 'This match just ended.' : endedResult ? describeResult(endedResult) : null;

  return (
    <View className="flex-1 bg-bg-base">
      <ScreenBackdrop source={ScreenArt.frontRowCrowd} opacity={0.3} topScrim={0.4} />
      <View className="flex-row items-center justify-between px-lg pb-sm" style={{ paddingTop: insets.top + 16 }}>
        <Pressable onPress={() => goUp('/front-row')} className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.8), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}>
          <ChevronLeft />
        </Pressable>
        <Text className="flex-1 text-center font-display-hero text-text-primary" style={{ fontSize: 16, textTransform: 'uppercase' }}>
          Front Row
        </Text>
        <LiveBadge />
      </View>

      {loadState === 'ready' ? (
        <View className="mb-sm flex-row items-center justify-between px-lg">
          <NavButton label="‹ Prev" onPress={goPrev} disabled={matches.length < 2} />
          <Text style={{ fontSize: 11, color: Colors.textMuted }}>{`Match ${currentIndex + 1} of ${matches.length}`}</Text>
          <NavButton label="Next ›" onPress={goNext} disabled={matches.length < 2} />
        </View>
      ) : null}

      <View className="mb-sm flex-row items-center justify-center gap-1">
        <Text style={{ fontSize: 11, color: Colors.textMuted }}>{`👁 ${spectatorCount} watching`}</Text>
      </View>

      {loadState === 'loading' ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator color={Colors.cyan} />
        </View>
      ) : loadState === 'empty' ? (
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <Text className="text-center font-heading-md" style={{ color: Colors.textMuted }}>
            No live matches right now
          </Text>
          <Pressable onPress={loadMatches} className="rounded-full px-lg py-sm" style={{ backgroundColor: withOpacity(Colors.cyan, 0.15), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.4) }}>
            <Text style={{ color: Colors.cyan, fontSize: 13 }}>Refresh</Text>
          </Pressable>
        </View>
      ) : (
        <>
          <View className="flex-row gap-sm px-lg">
            <View className="flex-1 flex-row items-center gap-sm rounded-lg p-sm" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chrome, 0.2) }}>
              <PlayerAvatar source={getAvatarImage(players?.w.avatarId)} size="small" />
              <View>
                <Text className="font-heading-md" style={{ fontSize: 12, color: Colors.chrome }} numberOfLines={1}>
                  {players?.w.displayName ?? 'WHITE'}
                </Text>
                <Text className="font-display-hero" style={{ fontSize: 16, color: Colors.chrome, marginTop: 2 }}>
                  {formatClockMs(boardState?.clocks.w ?? 0)}
                </Text>
              </View>
            </View>
            <View className="flex-1 flex-row-reverse items-center gap-sm rounded-lg p-sm" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.emberLight, 0.3) }}>
              <PlayerAvatar source={getAvatarImage(players?.b.avatarId)} size="small" />
              <View style={{ alignItems: 'flex-end' }}>
                <Text className="font-heading-md" style={{ fontSize: 12, color: Colors.emberLight }} numberOfLines={1}>
                  {players?.b.displayName ?? 'BLACK'}
                </Text>
                <Text className="font-display-hero" style={{ fontSize: 16, color: Colors.emberLight, marginTop: 2 }}>
                  {formatClockMs(boardState?.clocks.b ?? 0)}
                </Text>
              </View>
            </View>
          </View>

          <View className="flex-1 items-center justify-center">
            {boardState ? (
              <ChessBoard
                board={boardState.board}
                turn={boardState.turn}
                lastMove={boardState.lastMove}
                checkSquare={boardState.checkSquare}
                lastMoveSound={boardState.lastMoveSound}
              />
            ) : (
              <ActivityIndicator color={Colors.cyan} />
            )}

            {overlayMessage ? (
              <View className="items-center gap-md rounded-lg p-lg" style={{ position: 'absolute', backgroundColor: withOpacity(Colors.bgBase, 0.92), borderWidth: 1, borderColor: withOpacity(Colors.crimson, 0.4) }}>
                <Text className="font-heading-md text-center" style={{ color: Colors.textPrimary }}>
                  {overlayMessage}
                </Text>
                <Pressable onPress={goNext} className="rounded-full px-lg py-sm" style={{ backgroundColor: withOpacity(Colors.cyan, 0.15), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.4) }}>
                  <Text style={{ color: Colors.cyan, fontSize: 13 }}>Next Match ›</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        </>
      )}

      <View className="flex-row justify-center gap-md px-lg" style={{ paddingBottom: 16 + insets.bottom }}>
        {REACTIONS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => handleReactionPress(emoji)}
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.85), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3), boxShadow: `0px 0px 12px ${withOpacity(Colors.cyan, 0.2)}` }}
          >
            <Text style={{ fontSize: 22 }}>{emoji}</Text>
          </Pressable>
        ))}
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
        {floatingReactions.map((reaction) => (
          <FloatingEmoji key={reaction.id} emoji={reaction.emoji} left={reaction.left} />
        ))}
      </View>

      <ChatTicker />
    </View>
  );
}

function describeResult(result: SpectateMatchEndedPayload['result']): string {
  if (result.type === 'draw') return 'Drawn by agreement';
  const winnerName = result.winner === 'w' ? 'White' : 'Black';
  const kind = result.type === 'resignation' ? 'resignation' : result.type === 'timeout' ? 'timeout' : 'forfeit';
  return `${winnerName} wins by ${kind}`;
}

function formatClockMs(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function NavButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} className="rounded-full px-md py-1" style={{ opacity: disabled ? 0.35 : 1, backgroundColor: withOpacity(Colors.bgPanel, 0.8), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}>
      <Text style={{ fontSize: 12, color: Colors.textPrimary }}>{label}</Text>
    </Pressable>
  );
}

function ChevronLeft() {
  return <Text style={{ fontSize: 24, color: Colors.textPrimary, marginLeft: -2 }}>‹</Text>;
}

function LiveBadge() {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(withSequence(withTiming(0.5, { duration: 750, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 750 })), -1, false);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View className="flex-row items-center gap-1 rounded-full px-md" style={[{ paddingVertical: 6, backgroundColor: Colors.crimson }, animatedStyle]}>
      <View className="h-1.5 w-1.5 rounded-full bg-text-primary" />
      <Text className="font-section-header text-caption text-text-primary" style={{ textTransform: 'uppercase' }}>
        Live
      </Text>
    </Animated.View>
  );
}

function FloatingEmoji({ emoji, left }: { emoji: string; left: number }) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    translateY.value = withTiming(-200, { duration: 2000, easing: Easing.out(Easing.quad) });
    scale.value = withTiming(1.5, { duration: 2000 });
    opacity.value = withTiming(0, { duration: 2000 });
  }, [translateY, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.Text style={[{ position: 'absolute', bottom: 110, left, fontSize: 28 }, animatedStyle]}>{emoji}</Animated.Text>;
}

function ChatTicker() {
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (textWidth === 0) return;
    translateX.value = 0;
    translateX.value = withRepeat(withTiming(-textWidth, { duration: 16000, easing: Easing.linear }), -1, false);
  }, [textWidth, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View className="justify-center" style={{ height: 40, overflow: 'hidden', backgroundColor: withOpacity(Colors.bgBase, 0.85), borderTopWidth: 1, borderTopColor: withOpacity(Colors.chromeDark, 0.3) }}>
      <Animated.Text onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)} style={[{ fontSize: 12, color: Colors.textMuted, width: 2000 }, animatedStyle]} numberOfLines={1}>
        {CHAT_TICKER + CHAT_TICKER}
      </Animated.Text>
    </View>
  );
}
