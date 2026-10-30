import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, View } from 'react-native';

import { TierEmblem, TitleEmblem } from '@/components/progression/Emblem';
import { CountryFlag, PlayerAvatar, RockButton } from '@/components/ui';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import { useFriends } from '@/hooks/useFriends';
import { getPlayerProfile, type PublicProfile } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

const TIER_LABEL = { rookie: 'ROOKIE', challenger: 'CHALLENGER', master: 'MASTER', grandmaster: 'GRANDMASTER' } as const;

interface PlayerProfileSheetProps {
  /** The player to show; null = closed. */
  userId: string | null;
  onClose: () => void;
  /** Shown while the profile loads (and if it can't). */
  fallbackName?: string;
  /** In a live match the sheet is look-only: nothing may navigate away from the game (no Message). */
  inMatch?: boolean;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-1 items-center">
      <Text className="font-display-hero text-text-primary" style={{ fontSize: 17 }}>
        {value}
      </Text>
      <Text className="font-caption uppercase text-text-muted" style={{ fontSize: 9, letterSpacing: 0.8 }}>
        {label}
      </Text>
    </View>
  );
}

// Tap an opponent anywhere (match header, result screen, friends, rankings) and see who they are: rating
// and tier, record, how you have fared against them, whether they are online, and the one action that makes
// sense (Add friend / Message). Public fields only (server/src/db/publicProfile.ts); a blocked or unknown
// player is "not found". A Modal rather than a route, so it can open on top of a live match without
// navigating away from it (the clock keeps running underneath, exactly as in any other overlay).
export function PlayerProfileSheet({ userId, onClose, fallbackName, inMatch = false }: PlayerProfileSheetProps) {
  const router = useRouter();
  const friends = useFriends();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [addState, setAddState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setProfile(null);
    setState('loading');
    setAddState('idle');
    (async () => {
      const token = await getAuthToken();
      if (!token) {
        if (!cancelled) setState('error');
        return;
      }
      try {
        const { profile: loaded } = await getPlayerProfile(token, userId);
        if (cancelled) return;
        setProfile(loaded);
        setState('ready');
      } catch (error) {
        if (cancelled) return;
        setState(error instanceof Error && error.message === 'not-found' ? 'missing' : 'error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  async function handleAdd() {
    if (!profile) return;
    setAddState('sending');
    try {
      await friends.addFriend({ userId: profile.userId });
      setAddState('sent');
    } catch {
      setAddState('error');
    }
  }

  const name = profile?.displayName ?? fallbackName ?? 'Player';
  const record = profile && profile.gamesPlayed > 0 ? `${Math.round((profile.winRate ?? 0) * 100)}%` : '–';
  const h2h = profile?.headToHead;
  const requested = addState === 'sent' || profile?.relation === 'outgoing';

  return (
    <Modal visible={!!userId} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable onPress={onClose} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, backgroundColor: withOpacity(Colors.bgBase, 0.8) }}>
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 340 }}>
          <View style={{ borderRadius: 20, borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3), backgroundColor: Colors.bgPanel, padding: Spacing.lg, gap: Spacing.md }}>
            {state === 'loading' ? (
              <View className="items-center gap-sm" style={{ paddingVertical: 24 }}>
                <ActivityIndicator color={Colors.cyan} />
                <Text className="font-body-sm text-text-muted">{name}</Text>
              </View>
            ) : state !== 'ready' || !profile ? (
              <View className="items-center gap-sm" style={{ paddingVertical: 16 }}>
                <Text className="text-center font-heading-md text-text-primary" style={{ fontSize: 15 }}>
                  {state === 'missing' ? 'Profile not available' : "Couldn't load this profile"}
                </Text>
                <Text className="text-center font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                  {state === 'missing' ? 'This player can no longer be shown.' : 'Check your connection and try again.'}
                </Text>
              </View>
            ) : (
              <>
                <View className="flex-row items-center gap-md">
                  <View>
                    <PlayerAvatar avatarId={profile.avatarId ?? null} size="medium" />
                    <View
                      style={{ position: 'absolute', bottom: 0, right: 0, width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: Colors.bgPanel, backgroundColor: profile.online ? Colors.cyan : Colors.chromeDark }}
                    />
                  </View>
                  <View className="flex-1 gap-1">
                    <View className="flex-row items-center gap-1">
                      <CountryFlag code={profile.country} size={14} />
                      <Text className="flex-shrink font-display-hero uppercase text-text-primary" style={{ fontSize: 18 }} numberOfLines={1}>
                        {name}
                      </Text>
                    </View>
                    <View className="flex-row items-center gap-1">
                      <TitleEmblem titleId={profile.title?.id} size={18} />
                      <Text className="font-heading-md uppercase text-gold" style={{ fontSize: 11 }} numberOfLines={1}>
                        {profile.title?.name ?? `Level ${profile.level}`}
                      </Text>
                    </View>
                    <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                      {profile.online ? 'Online' : 'Offline'} · Level {profile.level}
                    </Text>
                  </View>
                </View>

                <View className="flex-row items-center gap-md rounded-lg" style={{ padding: 10, backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}>
                  <TierEmblem tier={profile.tier} size={44} />
                  <View className="flex-1">
                    <Text className="font-display-hero text-cyan" style={{ fontSize: 26 }}>
                      {profile.rating}
                    </Text>
                    <Text className="font-heading-md uppercase text-text-muted" style={{ fontSize: 10, letterSpacing: 1 }}>
                      {TIER_LABEL[profile.tier]}
                    </Text>
                  </View>
                </View>

                <View className="flex-row">
                  <Stat label="Games" value={String(profile.gamesPlayed)} />
                  <Stat label="Wins" value={String(profile.wins)} />
                  <Stat label="Losses" value={String(profile.losses)} />
                  <Stat label="Draws" value={String(profile.draws)} />
                  <Stat label="Win %" value={record} />
                </View>

                {h2h ? (
                  <Text className="text-center font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                    You&apos;ve played {h2h.games} {h2h.games === 1 ? 'game' : 'games'} against {name}: you {h2h.yourWins}, them {h2h.theirWins}
                    {h2h.draws > 0 ? `, ${h2h.draws} drawn` : ''}.
                  </Text>
                ) : profile.relation !== 'self' ? (
                  <Text className="text-center font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                    You haven&apos;t played {name} yet.
                  </Text>
                ) : null}

                {profile.relation === 'none' && !requested ? (
                  <RockButton
                    label={addState === 'sending' ? 'Sending…' : addState === 'error' ? 'Try again' : 'Add friend'}
                    variant="cyan"
                    disabled={addState === 'sending'}
                    onPress={() => void handleAdd()}
                  />
                ) : requested ? (
                  <Text className="text-center font-heading-md uppercase text-text-muted" style={{ fontSize: 11 }}>
                    Friend request sent
                  </Text>
                ) : profile.relation === 'incoming' ? (
                  <Text className="text-center font-heading-md uppercase text-gold" style={{ fontSize: 11 }}>
                    {name} sent you a friend request
                  </Text>
                ) : profile.relation === 'friends' && !inMatch ? (
                  <RockButton
                    label="Message"
                    variant="gold"
                    onPress={() => {
                      onClose();
                      router.push({ pathname: '/messages', params: { userId: profile.userId } });
                    }}
                  />
                ) : profile.relation === 'friends' ? (
                  <Text className="text-center font-heading-md uppercase text-cyan" style={{ fontSize: 11 }}>
                    Friends
                  </Text>
                ) : null}
              </>
            )}
            <RockButton label="Close" variant="secondary" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
