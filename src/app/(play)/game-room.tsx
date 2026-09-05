import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { AppIcon, CurrencyPill, EmberParticles, GlowBox, PlayerAvatar, RockButton, ScreenBackdrop } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getPlayerId } from '@/lib/playerId';
import { ensureAuthenticated, getSocket } from '@/lib/socket';
import type { QueueMatchedPayload, RoomCreatedPayload, RoomErrorPayload } from '@/lib/onlineMatch';

type Tab = 'create' | 'join';
type CreateState = 'idle' | 'creating' | 'waiting';

// Create a room, get a shareable code back, and wait for a friend to join
// it -- or enter a code someone else shared to join theirs. Both paths
// bottom out in the exact same queue:matched event venue-tier matchmaking
// already uses (see server/src/gameRoom.ts), so once paired this hands off
// to /match identically either way.
export default function GameRoomScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gems } = usePlayerProfile();
  const [tab, setTab] = useState<Tab>('create');

  const [createState, setCreateState] = useState<CreateState>('idle');
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [joinError, setJoinError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const pulse = useSharedValue(0);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(1, { duration: 900, easing: Easing.inOut(Easing.ease) }), -1, true);
  }, [pulse]);

  useEffect(() => {
    const socket = getSocket();

    function handleMatched(payload: QueueMatchedPayload) {
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
        },
      });
    }

    function handleRoomCreated(payload: RoomCreatedPayload) {
      setCode(payload.code);
      setCreateState('waiting');
    }

    function handleRoomError(payload: RoomErrorPayload) {
      setJoining(false);
      setJoinError(payload.reason === 'own-room' ? "You can't join your own room." : 'Room not found or expired.');
    }

    socket.on('queue:matched', handleMatched);
    socket.on('room:created', handleRoomCreated);
    socket.on('room:error', handleRoomError);

    return () => {
      socket.off('queue:matched', handleMatched);
      socket.off('room:created', handleRoomCreated);
      socket.off('room:error', handleRoomError);
      // Harmless no-op if this session never created a room -- the server
      // just finds nothing to cancel.
      socket.emit('room:cancel');
    };
  }, [router]);

  async function handleCreate() {
    setCreateState('creating');
    // Same race-condition guard matchmaking.tsx's own queue:join relies on
    // -- wait for the connection's auth token to attach before emitting,
    // otherwise a signed-in player's room can silently form as a guest.
    const [, guestId] = await Promise.all([ensureAuthenticated(), getPlayerId()]);
    getSocket().emit('room:create', { guestId, displayName: 'AXL_CHESS' });
  }

  function handleCancelWaiting() {
    getSocket().emit('room:cancel');
    setCreateState('idle');
    setCode(null);
    setCopied(false);
  }

  async function handleCopyCode() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handlePasteCode() {
    const text = await Clipboard.getStringAsync();
    if (text) setJoinCode(text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6));
  }

  async function handleJoin() {
    if (joinCode.trim().length === 0) return;
    setJoining(true);
    setJoinError(null);
    const [, guestId] = await Promise.all([ensureAuthenticated(), getPlayerId()]);
    getSocket().emit('room:join', { guestId, displayName: 'AXL_CHESS', code: joinCode.trim() });
  }

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: 0.5 + pulse.value * 0.5,
  }));

  return (
    <View className="flex-1 bg-bg-base">
      <ScreenBackdrop source={ScreenArt.gameRoom} opacity={0.28} />
      <EmberParticles count={8} />
      <SubPageHeader title="Game Room" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-lg items-center gap-xl px-margin-mobile pt-xl"
        contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View
          className="w-full max-w-sm flex-row rounded-xl p-1"
          style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
        >
          {(['create', 'join'] as const).map((t) => {
            const active = tab === t;
            return (
              <Pressable
                key={t}
                onPress={() => setTab(t)}
                className="flex-1 items-center rounded-lg py-sm"
                style={active ? { backgroundColor: withOpacity(Colors.cyan, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.2) } : undefined}
              >
                <Text
                  className="font-heading-md text-section-header uppercase tracking-widest"
                  style={{ color: active ? Colors.cyan : Colors.textMuted }}
                >
                  {t === 'create' ? 'Create' : 'Join'}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'create' ? (
          createState === 'waiting' && code ? (
            <View className="w-full items-center gap-lg">
              <View className="w-full items-center gap-sm">
                <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ letterSpacing: 2 }}>
                  Private Room Code
                </Text>
                <GlowBox color="cyan" intensity="sm" style={{ width: '100%', maxWidth: 360 }}>
                  <View
                    className="w-full flex-row items-center justify-between rounded-xl p-lg"
                    style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) }}
                  >
                    <View>
                      <Text className="mb-xs font-section-header uppercase text-text-muted" style={{ fontSize: 10, letterSpacing: 2 }}>
                        Active Code
                      </Text>
                      <Text className="font-headline-lg text-cyan" style={{ fontSize: 28, letterSpacing: 6 }}>
                        {code}
                      </Text>
                    </View>
                    <Pressable
                      onPress={handleCopyCode}
                      className="items-center justify-center rounded-lg p-md"
                      style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3) }}
                    >
                      <AppIcon name={copied ? 'check' : 'content_copy'} size={20} color={Colors.cyan} />
                    </Pressable>
                  </View>
                </GlowBox>
                <Text className="text-center font-body-sm text-body-sm" style={{ color: copied ? Colors.cyan : Colors.textMuted }}>
                  {copied ? 'Copied to clipboard' : 'Share this code with a friend to start.'}
                </Text>
              </View>

              <Animated.View className="items-center gap-sm" style={pulseStyle}>
                <PlayerAvatar emoji="❓" size="medium" />
                <Text className="font-body-sm text-body-sm text-text-muted">Waiting for opponent…</Text>
              </Animated.View>
            </View>
          ) : (
            <View className="w-full items-center gap-md">
              <View
                className="h-16 w-16 items-center justify-center rounded-full"
                style={{ backgroundColor: withOpacity(Colors.cyan, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3) }}
              >
                <AppIcon name="meeting_room" size={30} color={Colors.cyan} />
              </View>
              <Text className="text-center font-body-base text-body-base text-text-muted" style={{ maxWidth: 300 }}>
                Create a room and invite a friend with a 6-character code.
              </Text>
            </View>
          )
        ) : (
          <View className="w-full items-center gap-sm">
            <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ letterSpacing: 2 }}>
              Enter Private Room Code
            </Text>
            <GlowBox color="cyan" intensity="sm" style={{ width: '100%', maxWidth: 360 }}>
              <View
                className="w-full rounded-xl p-lg"
                style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) }}
              >
                <TextInput
                  value={joinCode}
                  onChangeText={(text) => setJoinCode(text.toUpperCase().slice(0, 6))}
                  placeholder="_ _ _ _ _ _"
                  placeholderTextColor={withOpacity(Colors.cyan, 0.25)}
                  autoCapitalize="characters"
                  maxLength={6}
                  className="text-center font-headline-lg uppercase text-cyan"
                  style={{ fontSize: 26, letterSpacing: 8 }}
                />
              </View>
            </GlowBox>
            <Pressable onPress={handlePasteCode} className="mt-xs flex-row items-center gap-xs">
              <AppIcon name="content_paste" size={16} color={withOpacity(Colors.cyan, 0.7)} />
              <Text className="font-button-label text-caption uppercase tracking-widest" style={{ color: withOpacity(Colors.cyan, 0.7) }}>
                Paste from Clipboard
              </Text>
            </Pressable>
            {joinError ? <Text className="mt-xs text-center font-body-sm text-body-sm text-crimson">{joinError}</Text> : null}
          </View>
        )}
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 w-full items-center p-margin-mobile"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        {tab === 'create' ? (
          createState === 'waiting' ? (
            <RockButton label="Cancel Room" variant="danger" onPress={handleCancelWaiting} style={{ width: '100%', maxWidth: 380 }} />
          ) : (
            <RockButton
              label={createState === 'creating' ? 'Creating…' : 'Create Room'}
              variant="primary"
              icon={<AppIcon name="add_circle" size={18} color={Colors.textPrimary} />}
              disabled={createState === 'creating'}
              onPress={handleCreate}
              style={{ width: '100%', maxWidth: 380 }}
            />
          )
        ) : (
          <RockButton
            label={joining ? 'Joining…' : 'Join Room'}
            variant="cyan"
            icon={<AppIcon name="arrow_forward" size={18} color={Colors.bgBase} />}
            disabled={joining || joinCode.length === 0}
            onPress={handleJoin}
            style={{ width: '100%', maxWidth: 380 }}
          />
        )}
      </View>
    </View>
  );
}
