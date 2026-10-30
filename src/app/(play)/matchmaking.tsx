import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { AppIcon, PlayerAvatar, RockButton } from '@/components/ui';
import { BoardAssetPrewarm } from '@/components/ui/BoardAssetPrewarm';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { goUp } from '@/lib/navigation';
import { getPlayerId } from '@/lib/playerId';
import { ensureAuthenticated, getSocket } from '@/lib/socket';
import { DURATION_LABELS, isDuration, isVenueTier, type QueueErrorPayload, type QueueMatchedPayload } from '@/lib/onlineMatch';

// How long a player searches on their picked clock before being offered the other time controls.
const WIDEN_AFTER_SECONDS = 25;

function formatElapsed(seconds: number) {
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = (seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function describeQueueError(
  error: QueueErrorPayload,
  venueTier: string,
): { title: string; message: string; action?: 'sign-in' | 'shop' } {
  const fmt = (n?: number) => (n ?? 0).toLocaleString('en-US');
  switch (error.reason) {
    case 'auth-required':
      return { title: 'Sign in to play for chips', message: 'Venues with a buy-in are played for chips. The Garage is always free.', action: 'sign-in' };
    case 'insufficient-chips':
      return { title: 'Not enough chips', message: `This venue costs ${fmt(error.required)} chips to enter${error.current !== undefined ? ` and you have ${fmt(error.current)}` : ''}.`, action: 'shop' };
    case 'rating-too-low':
      return { title: 'Venue locked', message: `You need a rating of ${fmt(error.required)} to enter (yours is ${fmt(error.current)}). Win matches at the lower venues to climb.` };
    case 'already-in-match':
      return { title: 'Match in progress', message: 'You already have a live match. Finish or leave it before joining another wagered game.' };
    case 'replaced':
      return { title: 'Joined on another device', message: 'This account started searching on another device, so this search was cancelled.' };
    case 'bad-tier':
      return { title: 'Unknown venue', message: `The venue "${venueTier}" is not available.` };
    default:
      return { title: 'Matchmaking unavailable', message: "We couldn't start the search. Your chips were not charged. Please try again in a moment." };
  }
}

export default function MatchmakingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const pulse = useSharedValue(0);
  const [elapsed, setElapsed] = useState(0);
  const { profile } = usePlayerProfile();
  // Set when the server refuses the join (queue:error) -- replaces the searching UI.
  const [queueError, setQueueError] = useState<QueueErrorPayload | null>(null);
  const { venueTier: venueTierParam, duration: durationParam, insured: insuredParam } = useLocalSearchParams<{ venueTier?: string; duration?: string; insured?: string }>();
  const venueTier = isVenueTier(venueTierParam) ? venueTierParam : 'garage';
  const duration = isDuration(durationParam) ? durationParam : '5m';
  // The player ticked the Safety Net on Match Setup (the server prices it and charges it at pairing).
  const insured = insuredParam === '1';
  // After a while with nobody on the picked clock the player may agree to also play other time controls
  // (server/src/matchmaking.ts widenQueued). Opt-in: the search stays on the picked clock until they tap.
  const [widened, setWidened] = useState(false);
  const widenedRef = useRef(false);

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
    // Once refused we must stop re-emitting queue:join on every reconnect.
    let errored = false;

    function handleQueueError(payload: QueueErrorPayload) {
      if (cancelled) return;
      errored = true;
      setQueueError(payload);
    }

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
          opponentCountry: payload.opponent.country ?? undefined,
          opponentUserId: payload.opponent.userId ?? undefined,
          opponentRating: payload.opponent.rating != null ? String(payload.opponent.rating) : undefined,
          opponentTitle: payload.opponent.title ?? undefined,
          clockW: String(payload.clocks.w),
          clockB: String(payload.clocks.b),
          incrementMs: String(payload.incrementMs),
          // The venue and stake the SERVER matched us in, not our own route param.
          venueTier: payload.venueTier ?? venueTier,
          buyIn: String(payload.buyIn ?? 0),
          prize: String(payload.prize ?? 0),
        },
      });
    }

    socket.on('queue:matched', handleMatched);
    socket.on('queue:error', handleQueueError);

    // Wait for the connection's auth token (if any) to attach before
    // emitting -- otherwise a signed-in player's join can race the async
    // SecureStore read in ensureAuthenticated() and go out on the
    // still-anonymous initial connection, silently downgrading them to a
    // guest for that match (no rating/history persisted).
    function joinQueue() {
      Promise.all([ensureAuthenticated(), getPlayerId()]).then(([, guestId]) => {
        if (cancelled || errored) return;
        socket.emit('queue:join', { guestId, displayName: 'AXL_CHESS', venueTier, duration, ...(insured ? { insured: true } : {}), ...(widenedRef.current ? { widen: true } : {}) });
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
      socket.off('queue:error', handleQueueError);
      socket.off('connect', joinQueue);
      socket.emit('queue:leave');
    };
  }, [router, venueTier, duration, insured]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.5,
    transform: [{ scale: 1 + pulse.value * 0.08 }],
  }));

  if (queueError) {
    const copy = describeQueueError(queueError, venueTier);
    return (
      <View className="flex-1 items-center justify-center gap-xl bg-bg-base px-xl" style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
        <AppIcon name="lock" size={40} color={Colors.crimson} />
        <View className="items-center gap-sm">
          <Text className="text-center font-display-hero text-text-primary" style={{ fontSize: 22, textTransform: 'uppercase' }}>
            {copy.title}
          </Text>
          <Text className="text-center font-body-base text-body-base text-text-muted" style={{ maxWidth: 300 }}>
            {copy.message}
          </Text>
        </View>
        <View className="w-full gap-md" style={{ maxWidth: 280 }}>
          {copy.action === 'sign-in' ? <RockButton label="Sign In" variant="primary" onPress={() => router.replace('/sign-in')} /> : null}
          {copy.action === 'shop' ? <RockButton label="Get Chips" variant="reward" onPress={() => router.replace('/shop')} /> : null}
          <RockButton label="Back" variant="secondary" onPress={() => goUp('/matchmaking')} />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center gap-xl bg-bg-base px-xl" style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
      <BoardAssetPrewarm pieceId={profile?.equippedPieceId} />

      <Text
        className="font-display-hero text-cyan"
        style={{ fontSize: 22, textTransform: 'uppercase', letterSpacing: 1, textShadowColor: withOpacity(Colors.cyan, 0.6), textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } }}
      >
        Finding Rival
      </Text>

      <View className="flex-row items-center gap-xl">
        <View className="items-center gap-sm">
          <PlayerAvatar avatarId={profile?.avatarId ?? null} size="large" />
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
        <Text className="font-body-base text-body-base text-text-muted">
          {widened ? `Searching all time controls (you picked ${duration})...` : `Searching for a ${duration} opponent...`}
        </Text>
        <View className="flex-row items-center gap-2 rounded-full px-lg py-sm" style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.8), borderTopWidth: 1, borderTopColor: withOpacity(Colors.chromeDark, 0.5) }}>
          <AppIcon name="schedule" size={16} color={Colors.textMuted} />
          <Text className="font-button-label text-button-label text-cyan">{formatElapsed(elapsed)}</Text>
        </View>
      </View>

      {!widened && elapsed >= WIDEN_AFTER_SECONDS ? (
        <View className="items-center gap-sm" style={{ maxWidth: 300 }}>
          <Text className="text-center font-body-sm text-text-muted" style={{ fontSize: 12 }}>
            No one else is searching {duration} ({DURATION_LABELS[duration]}) right now. You can also play whatever clock your opponent picked. You will see it before you move.
          </Text>
          <RockButton
            label="Also search other time controls"
            variant="cyan"
            onPress={() => {
              widenedRef.current = true;
              setWidened(true);
              getSocket().emit('queue:widen');
            }}
          />
        </View>
      ) : null}

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
