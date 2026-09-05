import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { AppIcon, EmberParticles, PlayerAvatar, RockButton } from '@/components/ui';
import { BoardAssetPrewarm } from '@/components/ui/BoardAssetPrewarm';
import { getAvatarImage } from '@/constants/avatars';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { goUp } from '@/lib/navigation';
import { getPlayerId } from '@/lib/playerId';
import { ensureAuthenticated, getSocket } from '@/lib/socket';
import { isDuration, isVenueTier, type QueueMatchedPayload } from '@/lib/onlineMatch';

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

export default function MatchmakingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pulse = useSharedValue(0);
  const [elapsed, setElapsed] = useState(0);
  const { profile } = usePlayerProfile();
  const { venueTier: venueTierParam, duration: durationParam } = useLocalSearchParams<{ venueTier?: string; duration?: string }>();
  const venueTier = isVenueTier(venueTierParam) ? venueTierParam : 'garage';
  const duration = isDuration(durationParam) ? durationParam : '5m';

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);

  useEffect(() => {
    const tick = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();

    function handleMatched(payload: QueueMatchedPayload) {
      if (cancelled) return;
      router.replace({
        pathname: '/match',
        params: {
          mode: 'online',
          matchId: payload.matchId,
          color: payload.color,
          fen: payload.fen,
          opponentName: payload.opponent.displayName,
          opponentAvatarId: payload.opponent.avatarId ?? undefined,
          opponentUserId: payload.opponent.userId ?? undefined,
          clockW: String(payload.clocks.w),
          clockB: String(payload.clocks.b),
          incrementMs: String(payload.incrementMs),
          venueTier,
        },
      });
    }

    socket.on('queue:matched', handleMatched);

    // Wait for the connection's auth token (if any) to attach before
    // emitting -- otherwise a signed-in player's join can race the async
    // SecureStore read in ensureAuthenticated() and go out on the
    // still-anonymous initial connection, silently downgrading them to a
    // guest for that match (no rating/history persisted).
    function joinQueue() {
      Promise.all([ensureAuthenticated(), getPlayerId()]).then(([, guestId]) => {
        if (cancelled) return;
        socket.emit('queue:join', { guestId, displayName: 'AXL_CHESS', venueTier, duration });
      });
    }

    // Re-join on every 'connect' -- Socket.IO fires this for the initial
    // connection AND for every automatic reconnect after a network blip.
    // The server only knows about a waiting player via their current
    // socket.id, so without re-emitting here, a reconnect while still
    // queued (not yet matched) would leave the player stuck forever: the
    // server's queue entry is now stale, and the client never asks again.
    // (server/src/matchmaking.ts's joinQueue treats a repeat join from the
    // same guestId as a refresh, not a duplicate, so this is safe to call
    // more than once.)
    socket.on('connect', joinQueue);
    if (socket.connected) joinQueue();

    return () => {
      cancelled = true;
      socket.off('queue:matched', handleMatched);
      socket.off('connect', joinQueue);
      socket.emit('queue:leave');
    };
  }, [router, venueTier, duration]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.5,
    transform: [{ scale: 1 + pulse.value * 0.08 }],
  }));

  return (
    <View className="flex-1 items-center justify-center gap-xl bg-bg-base px-xl" style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
      <BoardAssetPrewarm pieceId={profile?.equippedPieceId} />
      <EmberParticles count={8} />

      <Text
        className="font-display-hero text-cyan"
        style={{ fontSize: 22, textTransform: 'uppercase', letterSpacing: 1, textShadowColor: withOpacity(Colors.cyan, 0.6), textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } }}
      >
        Finding Rival
      </Text>

      <View className="flex-row items-center gap-xl">
        <View className="items-center gap-sm">
          <PlayerAvatar source={getAvatarImage(profile?.avatarId)} size="large" />
          <Text className="font-heading-md text-caption uppercase text-text-primary">{profile?.displayName ?? 'AXL_CHESS'}</Text>
        </View>

        <Text className="font-display-hero" style={{ fontSize: 24, color: Colors.emberLight, fontStyle: 'italic' }}>
          VS
        </Text>

        <Animated.View style={[{ alignItems: 'center', gap: 8 }, pulseStyle]}>
          <PlayerAvatar emoji="❓" size="large" />
          <Text className="font-heading-md text-caption uppercase text-text-muted">Waiting...</Text>
        </Animated.View>
      </View>

      <View className="items-center gap-sm">
        <Text className="font-body-base text-body-base text-text-muted">Searching for opponent...</Text>
        <View className="flex-row items-center gap-2 rounded-full px-lg py-sm" style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.8), borderTopWidth: 1, borderTopColor: withOpacity(Colors.chromeDark, 0.5) }}>
          <AppIcon name="schedule" size={16} color={Colors.textMuted} />
          <Text className="font-button-label text-button-label text-cyan">{formatElapsed(elapsed)}</Text>
        </View>
      </View>

      <RockButton
        label="Cancel"
        variant="danger"
        onPress={() => {
          getSocket().emit('queue:leave');
          goUp('/matchmaking');
        }}
      />
    </View>
  );
}
