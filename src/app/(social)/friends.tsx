import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendRow, RowAction } from '@/components/friends/FriendRow';
import { SubPageHeader } from '@/components/layout';
import { AppIcon, ConfirmModal, CurrencyPill, PlayerAvatar, RockButton, RockCard, SectionLabel } from '@/components/ui';
import { getAvatarImage } from '@/constants/avatars';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import { useChallenges } from '@/hooks/useChallenges';
import { useFriends } from '@/hooks/useFriends';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import type { Friend, FriendCodeLookup } from '@/lib/api';
import type { Duration } from '@/lib/onlineMatch';

const DURATIONS: { id: Duration; label: string }[] = [
  { id: '3m', label: '3 min' },
  { id: '5m', label: '5 min' },
  { id: '10m', label: '10 min' },
];

type LookupState =
  | { status: 'idle' }
  | { status: 'searching' }
  | { status: 'found'; user: FriendCodeLookup }
  | { status: 'error'; message: string };

export default function FriendsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gems, profile } = usePlayerProfile();
  const friends = useFriends();
  const { sendChallenge } = useChallenges();

  const [codeInput, setCodeInput] = useState('');
  const [lookup, setLookup] = useState<LookupState>({ status: 'idle' });
  const [sending, setSending] = useState(false);
  const [challengeTarget, setChallengeTarget] = useState<Friend | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Friend | null>(null);
  const [copied, setCopied] = useState(false);

  const friendlyError = (raw: string): string => {
    switch (raw) {
      case 'user-not-found':
        return 'No player has that friend code.';
      case 'cannot-friend-self':
        return "That's your own friend code.";
      case 'already-friends':
        return "You're already friends.";
      case 'already-pending':
        return 'A request is already pending.';
      case 'blocked':
        return "You can't add this player.";
      default:
        return 'Something went wrong. Try again.';
    }
  };

  async function handleLookup() {
    const code = codeInput.trim();
    if (!code) return;
    setLookup({ status: 'searching' });
    try {
      const user = await friends.lookup(code);
      setLookup(user ? { status: 'found', user } : { status: 'error', message: 'No player has that friend code.' });
    } catch {
      setLookup({ status: 'error', message: 'Something went wrong. Try again.' });
    }
  }

  async function handleSendRequest() {
    if (lookup.status !== 'found') return;
    setSending(true);
    try {
      const { accepted } = await friends.addFriend({ userId: lookup.user.userId });
      setLookup({
        status: 'error',
        message: accepted ? "You're now friends!" : 'Request sent.',
      });
      setCodeInput('');
    } catch (error) {
      setLookup({ status: 'error', message: friendlyError((error as Error).message) });
    } finally {
      setSending(false);
    }
  }

  async function handleCopyCode() {
    if (!profile?.friendCode) return;
    await Clipboard.setStringAsync(profile.friendCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (friends.status === 'guest') {
    return (
      <View className="flex-1 bg-bg-base">
        <SubPageHeader title="Friends" />
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <AppIcon name="group" size={40} color={Colors.textMuted} />
          <Text className="text-center font-body-base text-body-base text-text-muted">
            Sign in to add friends, challenge them, and message between games.
          </Text>
          <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Friends" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView
        contentContainerClassName="gap-lg px-lg py-xl"
        contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <RockButton
          label="Private Game Room"
          variant="cyan"
          icon={<AppIcon name="meeting_room" size={18} color={Colors.bgBase} />}
          onPress={() => router.push('/game-room')}
        />

        {profile?.friendCode ? (
          <RockCard variant="surface" contentPadding={14}>
            <Text className="font-section-header uppercase" style={{ fontSize: 10, letterSpacing: 2, color: Colors.textMuted }}>
              Your Friend Code
            </Text>
            <View className="mt-xs flex-row items-center justify-between">
              <Text className="font-headline-lg text-cyan" style={{ fontSize: 24, letterSpacing: 4 }}>
                {profile.friendCode}
              </Text>
              <Pressable
                onPress={handleCopyCode}
                hitSlop={8}
                className="flex-row items-center gap-1 rounded-md px-2.5 py-1.5"
                style={{ backgroundColor: withOpacity(Colors.cyan, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.35) }}
              >
                <AppIcon name={copied ? 'check' : 'content_copy'} size={14} color={Colors.cyan} />
                <Text className="font-section-header uppercase" style={{ fontSize: 10, color: Colors.cyan }}>
                  {copied ? 'Copied' : 'Copy'}
                </Text>
              </Pressable>
            </View>
            <Text className="mt-xs font-body-sm" style={{ fontSize: 11, color: Colors.textMuted }}>
              Share it so friends can add you.
            </Text>
          </RockCard>
        ) : null}

        <View className="gap-sm">
          <SectionLabel label="Add a Friend" />
          <View className="flex-row gap-sm">
            <View
              className="flex-1 flex-row items-center gap-sm rounded-md px-md"
              style={{ height: 46, backgroundColor: withOpacity(Colors.bgPanel, 0.85), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
            >
              <AppIcon name="person_add" size={16} color={Colors.textMuted} />
              <TextInput
                value={codeInput}
                onChangeText={(t) => {
                  setCodeInput(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12));
                  setLookup({ status: 'idle' });
                }}
                placeholder="Enter friend code"
                placeholderTextColor={Colors.textMuted}
                autoCapitalize="characters"
                autoCorrect={false}
                onSubmitEditing={handleLookup}
                className="flex-1 font-body-base uppercase text-text-primary"
                style={{ fontSize: 14, letterSpacing: 1 }}
              />
            </View>
            <Pressable
              onPress={handleLookup}
              disabled={!codeInput.trim() || lookup.status === 'searching'}
              className="items-center justify-center rounded-md"
              style={{ width: 46, height: 46, backgroundColor: Colors.cyan, opacity: !codeInput.trim() ? 0.5 : 1 }}
            >
              {lookup.status === 'searching' ? (
                <ActivityIndicator color={Colors.bgBase} size="small" />
              ) : (
                <AppIcon name="search" size={20} color={Colors.bgBase} />
              )}
            </Pressable>
          </View>

          {lookup.status === 'found' ? (
            <RockCard variant="surface" contentPadding={12}>
              <View className="flex-row items-center gap-md">
                <PlayerAvatar source={getAvatarImage(lookup.user.avatarId)} size="small" />
                <View className="flex-1">
                  <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 14 }} numberOfLines={1}>
                    {lookup.user.displayName ?? 'Anonymous'}
                  </Text>
                  <Text className="mt-0.5 font-body-sm" style={{ fontSize: 11, color: Colors.textMuted }}>
                    {lookup.user.rating} ELO
                  </Text>
                </View>
                <RockButton
                  label={sending ? 'Sending…' : 'Add'}
                  variant="cyan"
                  disabled={sending}
                  onPress={handleSendRequest}
                  style={{ paddingHorizontal: 18 }}
                />
              </View>
            </RockCard>
          ) : lookup.status === 'error' ? (
            <Text className="font-body-sm" style={{ fontSize: 12, color: Colors.textMuted }}>
              {lookup.message}
            </Text>
          ) : null}
        </View>

        {friends.incoming.length > 0 ? (
          <View className="gap-sm">
            <SectionLabel label={`Friend Requests (${friends.incoming.length})`} />
            {friends.incoming.map((r) => (
              <FriendRow
                key={r.userId}
                displayName={r.displayName}
                avatarId={r.avatarId}
                rating={r.rating}
                subtitle={`Wants to be friends · ${r.rating} ELO`}
                right={
                  <View className="flex-row gap-1">
                    <RowAction
                      label="Accept"
                      icon={<AppIcon name="check" size={12} color={Colors.cyan} />}
                      onPress={() => void friends.acceptRequest(r.userId)}
                    />
                    <RowAction label="Ignore" color={Colors.chromeMid} onPress={() => void friends.declineRequest(r.userId)} />
                  </View>
                }
              />
            ))}
          </View>
        ) : null}

        {friends.outgoing.length > 0 ? (
          <View className="gap-sm">
            <SectionLabel label="Sent Requests" />
            {friends.outgoing.map((r) => (
              <FriendRow
                key={r.userId}
                displayName={r.displayName}
                avatarId={r.avatarId}
                rating={r.rating}
                subtitle="Request sent"
                right={<RowAction label="Cancel" color={Colors.chromeMid} onPress={() => void friends.declineRequest(r.userId)} />}
              />
            ))}
          </View>
        ) : null}

        <View className="gap-sm">
          <SectionLabel label={`Friends (${friends.friends.length})`} />
          {friends.status === 'loading' && friends.friends.length === 0 ? (
            <ActivityIndicator color={Colors.cyan} style={{ marginTop: 24 }} />
          ) : friends.friends.length === 0 ? (
            <Text className="font-body-sm" style={{ fontSize: 12, color: Colors.textMuted }}>
              No friends yet. Share your code, or add someone by theirs.
            </Text>
          ) : (
            friends.friends.map((f) => {
              const presence = friends.presenceOf(f.userId);
              return (
                <FriendRow
                  key={f.userId}
                  displayName={f.displayName}
                  avatarId={f.avatarId}
                  rating={f.rating}
                  presence={presence}
                  right={
                    <View className="flex-row items-center gap-1">
                      <RowAction
                        label="Play"
                        icon={<AppIcon name="swords" size={12} color={Colors.cyan} />}
                        disabled={presence !== 'online'}
                        onPress={() => setChallengeTarget(f)}
                      />
                      <RowAction
                        label="Chat"
                        icon={<AppIcon name="chat" size={12} color={Colors.gold} />}
                        color={Colors.gold}
                        onPress={() => router.push({ pathname: '/messages', params: { userId: f.userId } })}
                      />
                      <Pressable
                        onPress={() => setRemoveTarget(f)}
                        hitSlop={8}
                        className="h-8 w-7 items-center justify-center rounded-md"
                        style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.9), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
                      >
                        <AppIcon name="more_vert" size={16} color={Colors.textMuted} />
                      </Pressable>
                    </View>
                  }
                />
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal
        visible={challengeTarget !== null}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setChallengeTarget(null)}
      >
        <Pressable
          onPress={() => setChallengeTarget(null)}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, backgroundColor: withOpacity(Colors.bgBase, 0.8) }}
        >
          <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 320 }}>
            <View
              style={{
                borderRadius: 20,
                borderWidth: 1,
                borderColor: withOpacity(Colors.cyan, 0.3),
                backgroundColor: Colors.bgPanel,
                padding: Spacing.lg,
                gap: Spacing.sm,
              }}
            >
              <Text style={{ textAlign: 'center', fontSize: 16, fontWeight: '600', color: Colors.textPrimary }}>
                Challenge {challengeTarget?.displayName ?? ''}
              </Text>
              <Text style={{ marginBottom: Spacing.xs, textAlign: 'center', fontSize: 13, color: Colors.textMuted }}>
                Pick a time control
              </Text>
              {DURATIONS.map((d) => (
                <RockButton
                  key={d.id}
                  label={d.label}
                  variant="cyan"
                  onPress={() => {
                    if (challengeTarget) {
                      void sendChallenge(challengeTarget.userId, challengeTarget.displayName ?? 'Friend', d.id);
                    }
                    setChallengeTarget(null);
                  }}
                  style={{ width: '100%' }}
                />
              ))}
              <RockButton label="Cancel" variant="secondary" onPress={() => setChallengeTarget(null)} style={{ width: '100%' }} />
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <ConfirmModal
        visible={removeTarget !== null}
        variant="danger"
        title="Remove Friend"
        message={`Remove ${removeTarget?.displayName ?? 'this player'} from your friends?`}
        confirmLabel="Remove"
        onConfirm={() => {
          if (removeTarget) void friends.unfriend(removeTarget.userId);
          setRemoveTarget(null);
        }}
        onCancel={() => setRemoveTarget(null)}
      />
    </View>
  );
}
