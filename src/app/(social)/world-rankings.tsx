import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendRow } from '@/components/friends/FriendRow';
import { AppIcon, BottomNav, CurrencyPill, PlayerAvatar, RockButton, RockCard } from '@/components/ui';
import { getAvatarImage } from '@/constants/avatars';
import { Colors, withOpacity } from '@/constants/theme';
import { useFriends } from '@/hooks/useFriends';
import { getLeaderboard, getMyProfile, getMyRank, type LeaderboardEntry, type PlayerProfile } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

type FilterTab = 'global' | 'friends' | 'venue' | 'country';
const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'global', label: 'Global' },
  { key: 'friends', label: 'Friends' },
  { key: 'venue', label: 'Venue' },
  { key: 'country', label: 'Country' },
];

// Rank position -- not per-player data -- drives the podium's visual design,
// same purely-presentational role these had with the old mock data.
const PODIUM_ACCENT: Record<1 | 2 | 3, string> = { 1: Colors.gold, 2: Colors.boardLight, 3: Colors.emberLight };
const PODIUM_HEIGHT: Record<1 | 2 | 3, number> = { 1: 160, 2: 128, 3: 96 };

function formatRecord(entry: LeaderboardEntry): string {
  if (entry.wins + entry.losses + entry.draws === 0) return 'No games yet';
  return `${entry.wins}W ${entry.losses}L ${entry.draws}D`;
}

type LoadStatus = 'loading' | 'ready' | 'error';
type MineStatus = 'loading' | 'ready' | 'error' | 'guest';

export default function WorldRankingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const friends = useFriends();
  const [activeFilter, setActiveFilter] = useState<FilterTab>('global');
  const [refreshing, setRefreshing] = useState(false);
  const [addState, setAddState] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});

  async function handleAddFromRanking(userId: string) {
    setAddState((prev) => ({ ...prev, [userId]: 'sending' }));
    try {
      await friends.addFriend({ userId });
      setAddState((prev) => ({ ...prev, [userId]: 'sent' }));
    } catch {
      setAddState((prev) => ({ ...prev, [userId]: 'error' }));
    }
  }

  const [listStatus, setListStatus] = useState<LoadStatus>('loading');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);

  const [mineStatus, setMineStatus] = useState<MineStatus>('loading');
  const [myProfile, setMyProfile] = useState<PlayerProfile | null>(null);
  const [myRank, setMyRank] = useState<{ rank: number; totalPlayers: number } | null>(null);

  const loadList = useCallback(async () => {
    setListStatus('loading');
    try {
      const { leaderboard } = await getLeaderboard(20);
      setEntries(leaderboard);
      setListStatus('ready');
    } catch (error) {
      console.log('Failed to load leaderboard', error);
      setListStatus('error');
    }
  }, []);

  const loadMine = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) {
      setMineStatus('guest');
      return;
    }
    setMineStatus('loading');
    try {
      const [{ profile }, rank] = await Promise.all([getMyProfile(token), getMyRank(token)]);
      setMyProfile(profile);
      setMyRank(rank);
      setMineStatus('ready');
    } catch (error) {
      console.log('Failed to load own rank', error);
      setMineStatus('error');
    }
  }, []);

  useEffect(() => {
    loadList();
    loadMine();
  }, [loadList, loadMine]);

  async function handleRefresh() {
    setRefreshing(true);
    await Promise.all([loadList(), loadMine()]);
    setRefreshing(false);
  }

  const podium = entries.slice(0, 3);
  // Visual order is 2nd-1st-3rd (1st in the middle, tallest) -- entries
  // itself stays rank-ordered (1st, 2nd, 3rd) since the ranked list below
  // reuses the same array by index.
  const podiumVisualOrder = [podium[1], podium[0], podium[2]];
  const rankedList = entries.slice(3);
  const percentile = myRank ? Math.max(1, Math.ceil((myRank.rank / myRank.totalPlayers) * 100)) : null;

  return (
    <View className="flex-1 bg-bg-base">
      <View
        className="flex-row items-center justify-between px-lg pb-md"
        style={{ paddingTop: insets.top + 12, gap: 8 }}
      >
        <View className="flex-shrink flex-row items-center gap-sm">
          <PlayerAvatar source={getAvatarImage(myProfile?.avatarId)} size="small" />
          <Text
            className="font-display-hero uppercase text-cyan"
            style={{ fontSize: 16, textShadowColor: withOpacity(Colors.cyan, 0.3), textShadowRadius: 5, textShadowOffset: { width: 0, height: 0 } }}
          >
            World Rankings
          </Text>
        </View>
        <CurrencyPill type="gems" value={myProfile?.gems ?? 0} />
      </View>

      <View
        className="mx-lg mb-md flex-row gap-1 rounded-md p-1"
        style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.6), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.35) }}
      >
        {FILTER_TABS.map((tab) => {
          const active = activeFilter === tab.key;
          return (
            <Pressable
              key={tab.key}
              onPress={() => setActiveFilter(tab.key)}
              className="flex-1 items-center rounded-sm py-2.5"
              style={active ? { backgroundColor: withOpacity(Colors.cyan, 0.1) } : undefined}
            >
              <Text
                className="font-heading-md uppercase"
                style={{ fontSize: 11, letterSpacing: 1, color: active ? Colors.cyan : Colors.textMuted }}
              >
                {tab.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {activeFilter === 'friends' ? (
        friends.status === 'guest' ? (
          <View className="flex-1 items-center justify-center gap-md px-xl">
            <Text className="text-center font-body-base text-body-base text-text-muted">Sign in to see your friends&apos; rankings.</Text>
            <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
          </View>
        ) : friends.friends.length === 0 ? (
          <View className="flex-1 items-center justify-center gap-sm px-xl">
            <Text className="text-center font-body-sm text-text-muted" style={{ fontSize: 12 }}>
              No friends yet. Add some on the Friends screen to see how you stack up.
            </Text>
            <RockButton label="Go to Friends" variant="secondary" onPress={() => router.push('/friends')} />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 120 + insets.bottom, gap: 8 }}
            showsVerticalScrollIndicator={false}
          >
            {[...friends.friends]
              .sort((a, b) => b.rating - a.rating)
              .map((f, index) => (
                <FriendRow
                  key={f.userId}
                  displayName={f.displayName}
                  avatarId={f.avatarId}
                  rating={f.rating}
                  presence={friends.presenceOf(f.userId)}
                  right={
                    <Text className="font-heading-md text-cyan" style={{ fontSize: 15 }}>
                      #{index + 1}
                    </Text>
                  }
                />
              ))}
          </ScrollView>
        )
      ) : activeFilter !== 'global' ? (
        <View className="flex-1 items-center justify-center gap-sm">
          <Text className="font-heading-md uppercase text-text-muted" style={{ fontSize: 13, letterSpacing: 2 }}>
            Coming Soon
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 16, paddingTop: 0, paddingBottom: 120 + insets.bottom, gap: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={Colors.cyan} />}
        >
          {listStatus === 'loading' ? (
            <ActivityIndicator color={Colors.cyan} style={{ marginTop: 48 }} />
          ) : listStatus === 'error' ? (
            <View className="mt-xl items-center gap-md">
              <Text className="font-body-base text-body-base text-text-muted">Couldn&apos;t load the leaderboard.</Text>
              <RockButton label="Retry" variant="primary" onPress={loadList} />
            </View>
          ) : (
            <>
              {podium.length > 0 ? (
                <View className="flex-row items-end justify-center gap-md pt-sm">
                  {podiumVisualOrder.map((entry, index) => {
                    if (!entry) return null;
                    const rank = (index === 1 ? 1 : index === 0 ? 2 : 3) as 1 | 2 | 3;
                    const accent = PODIUM_ACCENT[rank];
                    return (
                      <View key={entry.userId} className="flex-1 items-center gap-sm" style={{ maxWidth: rank === 1 ? 116 : 100 }}>
                        {rank === 1 ? <AppIcon name="workspace_premium" size={28} color={Colors.gold} /> : null}

                        <View>
                          <PlayerAvatar source={getAvatarImage(entry.avatarId)} size={rank === 1 ? 'medium' : 'small'} />
                          <View
                            className="absolute -bottom-1 -right-1 items-center justify-center rounded-full"
                            style={{ width: rank === 1 ? 24 : 20, height: rank === 1 ? 24 : 20, backgroundColor: accent, borderWidth: 1.5, borderColor: Colors.bgBase }}
                          >
                            <Text className="font-heading-md" style={{ fontSize: rank === 1 ? 12 : 10, color: Colors.bgBase }}>
                              {rank}
                            </Text>
                          </View>
                        </View>

                        <Text className="text-center font-heading-md uppercase" style={{ fontSize: rank === 1 ? 13 : 11, color: accent }} numberOfLines={1}>
                          {entry.displayName ?? 'Anonymous'}
                        </Text>
                        <Text className="font-body-sm text-cyan" style={{ fontSize: 11 }}>
                          {entry.rating}
                        </Text>

                        <LinearGradient
                          colors={[withOpacity(accent, 0.22), Colors.bgPanel]}
                          style={{
                            width: '100%',
                            height: PODIUM_HEIGHT[rank],
                            borderTopLeftRadius: 8,
                            borderTopRightRadius: 8,
                            borderTopWidth: 1,
                            borderTopColor: rank === 1 ? withOpacity(Colors.gold, 0.4) : withOpacity(Colors.chromeDark, 0.5),
                            boxShadow: rank === 1 ? `0px 0px 14px ${withOpacity(Colors.gold, 0.2)}` : undefined,
                          }}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : null}

              {rankedList.length > 0 ? (
                <View className="gap-sm">
                  {rankedList.map((entry, index) => (
                    <View
                      key={entry.userId}
                      className="flex-row items-center justify-between rounded-lg p-md"
                      style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
                    >
                      <View className="flex-1 flex-row items-center gap-md">
                        <Text className="w-6 text-center font-display-hero text-text-muted" style={{ fontSize: 20 }}>
                          {index + 4}
                        </Text>
                        <PlayerAvatar source={getAvatarImage(entry.avatarId)} size="small" />
                        <View className="flex-1">
                          <Text className="font-heading-md text-text-primary" style={{ fontSize: 14 }} numberOfLines={1}>
                            {entry.displayName ?? 'Anonymous'}
                          </Text>
                          <Text className="font-body-sm text-text-muted" style={{ fontSize: 11, marginTop: 2 }}>
                            {formatRecord(entry)}
                          </Text>
                        </View>
                      </View>
                      <View className="flex-row items-center gap-sm">
                        <Text className="font-heading-md text-cyan" style={{ fontSize: 14 }}>
                          {entry.rating}
                        </Text>
                        {friends.status === 'ready' &&
                        entry.userId !== myProfile?.userId &&
                        !friends.isFriend(entry.userId) &&
                        !friends.hasOutgoingTo(entry.userId) &&
                        addState[entry.userId] !== 'sent' ? (
                          <Pressable
                            onPress={() => void handleAddFromRanking(entry.userId)}
                            disabled={addState[entry.userId] === 'sending'}
                            hitSlop={8}
                            className="h-8 w-8 items-center justify-center rounded-md"
                            style={{ backgroundColor: withOpacity(Colors.cyan, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.35) }}
                          >
                            <AppIcon
                              name={addState[entry.userId] === 'error' ? 'close' : 'person_add'}
                              size={15}
                              color={addState[entry.userId] === 'error' ? Colors.crimson : Colors.cyan}
                            />
                          </Pressable>
                        ) : addState[entry.userId] === 'sent' || friends.hasOutgoingTo(entry.userId) ? (
                          <AppIcon name="check" size={15} color={withOpacity(Colors.cyan, 0.7)} />
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : null}

              {entries.length === 0 ? (
                <Text className="mt-lg text-center font-body-base text-body-base text-text-muted">No ranked players yet.</Text>
              ) : null}

              {mineStatus === 'ready' && myProfile && myRank ? (
                <RockCard glowColor={Colors.chromeDark} innerGlow={Colors.emberLight}>
                  <View className="flex-row items-center gap-md">
                    <Text className="w-8 text-center font-display-hero" style={{ fontSize: 24, color: Colors.emberLight }}>
                      {myRank.rank}
                    </Text>
                    <PlayerAvatar source={getAvatarImage(myProfile.avatarId)} size="medium" />
                    <View className="flex-1">
                      <Text className="font-heading-md text-cyan" style={{ fontSize: 14 }} numberOfLines={1}>
                        {myProfile.displayName ?? 'You'}
                      </Text>
                      <View className="mt-0.5 flex-row items-center gap-1.5">
                        <Text className="font-heading-md" style={{ fontSize: 11, color: Colors.emberLight }}>
                          TOP {percentile}%
                        </Text>
                        <Text className="text-text-muted" style={{ fontSize: 10 }}>
                          •
                        </Text>
                        <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                          {myProfile.rating} ELO
                        </Text>
                      </View>
                    </View>
                    <View className="items-end">
                      <Text className="font-heading-md uppercase" style={{ fontSize: 9, color: Colors.emberLight }}>
                        Record
                      </Text>
                      <Text className="font-heading-md text-text-primary" style={{ fontSize: 14, marginTop: 2 }}>
                        {myProfile.wins}W {myProfile.losses}L
                      </Text>
                    </View>
                  </View>
                </RockCard>
              ) : null}
            </>
          )}
        </ScrollView>
      )}

      <BottomNav activeTab="ranks" />
    </View>
  );
}
