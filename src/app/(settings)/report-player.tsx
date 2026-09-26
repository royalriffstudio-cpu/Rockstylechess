import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { FriendRow } from '@/components/friends/FriendRow';
import { ReportPlayerModal } from '@/components/social/ReportPlayerModal';
import { SectionLabel } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { useFriends } from '@/hooks/useFriends';
import { getMyMatches } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

interface ReportTarget {
  userId: string;
  displayName: string | null;
  avatarId: string | null;
  country: string | null;
  matchId?: string;
  subtitle: string;
}

export default function ReportPlayerScreen() {
  const insets = useSafeAreaInsets();
  const friends = useFriends();
  const [query, setQuery] = useState('');
  const [recentOpponents, setRecentOpponents] = useState<ReportTarget[]>([]);
  const [loadingOpponents, setLoadingOpponents] = useState(true);
  const [target, setTarget] = useState<ReportTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const token = await getAuthToken();
      if (!token) {
        setLoadingOpponents(false);
        return;
      }
      try {
        const { matches } = await getMyMatches(token, 50);
        if (cancelled) return;
        // Most-recent match per distinct online opponent -- matches are
        // already newest-first from the server.
        const seen = new Set<string>();
        const opponents: ReportTarget[] = [];
        for (const m of matches) {
          if (m.mode !== 'online' || !m.opponentUserId || seen.has(m.opponentUserId)) continue;
          seen.add(m.opponentUserId);
          opponents.push({
            userId: m.opponentUserId,
            displayName: m.opponentDisplayName,
            avatarId: null,
            country: m.opponentCountry,
            matchId: m.matchId,
            subtitle: 'Recent opponent',
          });
        }
        setRecentOpponents(opponents);
      } catch (error) {
        console.log('Failed to load match history for reporting', error);
      } finally {
        if (!cancelled) setLoadingOpponents(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const friendTargets = useMemo<ReportTarget[]>(
    () =>
      friends.friends.map((f) => ({
        userId: f.userId,
        displayName: f.displayName,
        avatarId: f.avatarId,
        country: f.country,
        subtitle: 'Friend',
      })),
    [friends.friends],
  );

  // Recent opponents who are already friends show once, under Friends.
  const friendIds = useMemo(() => new Set(friendTargets.map((f) => f.userId)), [friendTargets]);
  const opponentTargets = useMemo(
    () => recentOpponents.filter((o) => !friendIds.has(o.userId)),
    [recentOpponents, friendIds],
  );

  function matchesQuery(t: ReportTarget): boolean {
    if (!query.trim()) return true;
    return (t.displayName ?? '').toLowerCase().includes(query.trim().toLowerCase());
  }

  const filteredFriends = friendTargets.filter(matchesQuery);
  const filteredOpponents = opponentTargets.filter(matchesQuery);
  const isEmpty = !loadingOpponents && filteredFriends.length === 0 && filteredOpponents.length === 0;

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Report a Player" />
      <View className="px-lg pt-md">
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name..."
          placeholderTextColor={Colors.textMuted}
          className="rounded-lg px-md font-body-base text-text-primary"
          style={{ height: 44, backgroundColor: withOpacity(Colors.bgPanel, 0.8), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
        />
      </View>

      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-3xl gap-md px-lg py-lg"
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {loadingOpponents ? <ActivityIndicator color={Colors.cyan} style={{ marginTop: 24 }} /> : null}

        {filteredFriends.length > 0 ? (
          <View className="gap-sm">
            <SectionLabel label="Friends" />
            {filteredFriends.map((t) => (
              <FriendRow
                key={t.userId}
                displayName={t.displayName}
                avatarId={t.avatarId}
                country={t.country}
                rating={0}
                subtitle={t.subtitle}
                onPress={() => setTarget(t)}
              />
            ))}
          </View>
        ) : null}

        {filteredOpponents.length > 0 ? (
          <View className="gap-sm">
            <SectionLabel label="Recent Opponents" />
            {filteredOpponents.map((t) => (
              <FriendRow
                key={t.userId}
                displayName={t.displayName}
                avatarId={t.avatarId}
                country={t.country}
                rating={0}
                subtitle={t.subtitle}
                onPress={() => setTarget(t)}
              />
            ))}
          </View>
        ) : null}

        {isEmpty ? (
          <Text className="mt-xl text-center font-body-sm text-text-muted">
            {query.trim() ? 'No one matches that search.' : "You don't have any friends or recent online opponents yet."}
          </Text>
        ) : null}
      </ScrollView>

      {target ? (
        <ReportPlayerModal
          visible
          onClose={() => setTarget(null)}
          reportedUserId={target.userId}
          reportedDisplayName={target.displayName ?? 'this player'}
          matchId={target.matchId}
        />
      ) : null}
    </View>
  );
}
