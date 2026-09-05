import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, CurrencyPill, RockButton } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { claimQuest, getQuestsStatus, type QuestStatus } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

// Server doesn't send UI colors (theme stays a client concern) -- keyed by
// the quest's stable id, which matches server/src/questCatalog.ts's seed ids.
const ACCENT_BY_QUEST_ID: Record<string, string> = {
  'win-games': Colors.emberLight,
  'capture-pieces': Colors.cyan,
  'solve-puzzles': Colors.cyan,
  'checkmate-opponent': Colors.gold,
};

type QuestTab = 'daily' | 'weekly';

export default function QuestsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status: profileStatus, gems, refresh } = usePlayerProfile();
  const [activeTab, setActiveTab] = useState<QuestTab>('daily');
  const [quests, setQuests] = useState<QuestStatus[] | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    if (profileStatus !== 'ready') return;
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      try {
        const { quests: fetched } = await getQuestsStatus(token);
        if (!cancelled) setQuests(fetched);
      } catch (error) {
        console.log('Failed to load quests', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileStatus]);

  async function handleClaim(questId: string) {
    if (claimingId) return;
    setClaimingId(questId);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await claimQuest(token, questId);
      setQuests((prev) => prev?.map((q) => (q.id === questId ? { ...q, claimed: true } : q)) ?? prev);
      refresh();
    } catch (error) {
      console.log('Failed to claim quest', error);
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Battle Quests" trailing={<CurrencyPill type="gems" value={gems} />} />

      <View className="px-margin-mobile pb-sm pt-lg">
        <View className="flex-row rounded-full p-1" style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.7), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
          <Pressable onPress={() => setActiveTab('daily')} className="flex-1 items-center rounded-full py-2" style={activeTab === 'daily' ? { backgroundColor: withOpacity(Colors.cyan, 0.15) } : undefined}>
            <Text className="font-section-header text-section-header uppercase" style={{ color: activeTab === 'daily' ? Colors.cyan : Colors.textMuted }}>
              Daily
            </Text>
          </Pressable>
          <Pressable onPress={() => setActiveTab('weekly')} className="flex-1 items-center rounded-full py-2" style={activeTab === 'weekly' ? { backgroundColor: withOpacity(Colors.cyan, 0.15) } : undefined}>
            <Text className="font-section-header text-section-header uppercase" style={{ color: activeTab === 'weekly' ? Colors.cyan : Colors.textMuted }}>
              Weekly
            </Text>
          </Pressable>
        </View>
      </View>

      {activeTab === 'daily' ? (
        profileStatus === 'guest' ? (
          <View className="flex-1 items-center justify-center gap-md px-xl">
            <Text className="text-center font-body-base text-body-base text-text-muted">Sign in to track your battle quests.</Text>
            <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
          </View>
        ) : !quests ? (
          <ActivityIndicator color={Colors.cyan} style={{ marginTop: 32 }} />
        ) : (
          <ScrollView contentContainerClassName="gap-md px-margin-mobile" contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}>
            {quests.map((quest) => (
              <QuestRow key={quest.id} quest={quest} accent={ACCENT_BY_QUEST_ID[quest.id] ?? Colors.cyan} claiming={claimingId === quest.id} onClaim={() => handleClaim(quest.id)} />
            ))}
          </ScrollView>
        )
      ) : (
        <View className="flex-1 items-center justify-center px-xl" style={{ paddingBottom: 96 + insets.bottom }}>
          <View className="mb-6 h-32 w-32 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.2) }}>
            <AppIcon name="lock" size={64} color={Colors.textMuted} />
          </View>
          <Text className="text-center font-headline-lg text-headline-lg uppercase tracking-wide text-text-primary">Weekly Challenges</Text>
          <Text className="mt-2 text-center font-body-base text-body-base text-text-muted" style={{ maxWidth: 280 }}>
            Unlock higher tiers of rewards by reaching Level 10. The rock gods demand a stronger performance.
          </Text>
        </View>
      )}
    </View>
  );
}

function QuestRow({ quest, accent, claiming, onClaim }: { quest: QuestStatus; accent: string; claiming: boolean; onClaim: () => void }) {
  const isComplete = quest.progress >= quest.target;
  const canClaim = isComplete && !quest.claimed;
  const pct = Math.min(100, Math.round((quest.progress / quest.target) * 100));

  if (quest.claimed) {
    return (
      <View className="flex-row items-center justify-between gap-2 rounded-lg p-sm" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.2), opacity: 0.7 }}>
        <View className="w-3/4 gap-1">
          <Text className="font-heading-md text-heading-md text-cyan" style={{ textDecorationLine: 'line-through' }}>
            {quest.title}
          </Text>
          <Text className="font-body-sm text-body-sm text-chrome-dark" style={{ textDecorationLine: 'line-through' }}>
            {quest.description}
          </Text>
        </View>
        <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.15), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
          <AppIcon name="check" size={22} color={Colors.cyan} />
        </View>
      </View>
    );
  }

  return (
    <View className="gap-2 rounded-lg p-sm" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(canClaim ? Colors.cyan : accent, 0.4), boxShadow: canClaim ? `0px 0px 15px ${withOpacity(Colors.cyan, 0.15)}` : undefined }}>
      <View className="flex-row items-center gap-md">
        <View className="h-12 w-12 items-center justify-center rounded-lg" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(accent, 0.4) }}>
          <AppIcon name={quest.icon as any} size={26} color={accent} />
        </View>
        <View className="w-2/3 flex-1 gap-1">
          <Text className="font-heading-md text-heading-md" style={{ color: canClaim ? Colors.cyan : Colors.textPrimary }}>
            {quest.title}
          </Text>
          <Text className="font-body-sm text-body-sm text-text-muted">{quest.description}</Text>
        </View>
        {canClaim ? (
          <Pressable onPress={onClaim} disabled={claiming}>
            <LinearGradient colors={[Colors.cyan, '#00B4CC', '#008A9E']} style={{ borderRadius: 10, paddingHorizontal: 16, paddingVertical: 8, opacity: claiming ? 0.6 : 1, boxShadow: `0px 4px 15px ${withOpacity(Colors.cyan, 0.4)}` }}>
              <Text className="font-button-label text-button-label tracking-wider" style={{ color: Colors.bgBase }}>
                {claiming ? '...' : 'CLAIM'}
              </Text>
            </LinearGradient>
          </Pressable>
        ) : (
          <View className="items-end">
            <Text className="font-heading-md" style={{ fontSize: 14, color: Colors.emberLight }}>
              {quest.rewardChips.toLocaleString('en-US')} Chips
            </Text>
            <Text className="font-body-sm text-caption uppercase text-text-muted">Reward</Text>
          </View>
        )}
      </View>

      <View className="mt-2 flex-row items-center gap-3">
        <View className="h-3 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
          <LinearGradient colors={canClaim ? [Colors.cyan, '#9CF0FF'] : [Colors.gold, '#FFD570']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pct}%`, height: '100%' }} />
        </View>
        <Text className="font-section-header text-caption" style={{ color: canClaim ? Colors.cyan : Colors.textMuted }}>
          {quest.progress} / {quest.target}
        </Text>
      </View>
    </View>
  );
}
