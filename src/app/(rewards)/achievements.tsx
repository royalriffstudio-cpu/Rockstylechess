import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { AppIcon, CurrencyIcon, CurrencyPill, RockButton, SectionLabel } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { claimAchievement, getAchievementsStatus, type AchievementStatus } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

// The server sends the catalog data (title/description/icon/target/reward),
// not UI-only presentation -- same reasoning quests.tsx's ACCENT_BY_QUEST_ID
// has. Every id in achievementCatalog.ts is `<category>-<slug>`, so the
// prefix alone is enough to group + accent rows without a schema column.
const CATEGORY_META: Record<string, { label: string; accent: string }> = {
  win: { label: 'Career Wins', accent: Colors.emberLight },
  streak: { label: 'Win Streak', accent: Colors.ember },
  rating: { label: 'Rating', accent: Colors.gold },
  puzzle: { label: 'Puzzle Mastery', accent: Colors.cyan },
  special: { label: 'Special', accent: Colors.crimson },
  color: { label: 'Color Mastery', accent: Colors.chrome },
  bot: { label: 'Bot Sparring', accent: Colors.chromeMid },
  social: { label: 'Social', accent: Colors.cyan },
  collector: { label: 'Collector', accent: Colors.gold },
  engagement: { label: 'Engagement', accent: Colors.emberLight },
  loyalty: { label: 'Loyalty', accent: Colors.ember },
};
const CATEGORY_ORDER = ['win', 'streak', 'rating', 'puzzle', 'special', 'color', 'bot', 'social', 'collector', 'engagement', 'loyalty'];

function categoryOf(achievementId: string): string {
  return achievementId.split('-')[0];
}

export default function AchievementsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status: profileStatus, gems, refresh } = usePlayerProfile();
  const [achievements, setAchievements] = useState<AchievementStatus[] | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  useEffect(() => {
    if (profileStatus !== 'ready') return;
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      try {
        const { achievements: fetched } = await getAchievementsStatus(token);
        if (!cancelled) setAchievements(fetched);
      } catch (error) {
        console.log('Failed to load achievements', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileStatus]);

  async function handleClaim(achievementId: string) {
    if (claimingId) return;
    setClaimingId(achievementId);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await claimAchievement(token, achievementId);
      setAchievements((prev) => prev?.map((a) => (a.id === achievementId ? { ...a, claimed: true } : a)) ?? prev);
      refresh();
    } catch (error) {
      console.log('Failed to claim achievement', error);
    } finally {
      setClaimingId(null);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Achievements" trailing={<CurrencyPill type="gems" value={gems} />} />

      {profileStatus === 'guest' ? (
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <Text className="text-center font-body-base text-body-base text-text-muted">Sign in to track your achievements.</Text>
          <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
        </View>
      ) : !achievements ? (
        <ActivityIndicator color={Colors.cyan} style={{ marginTop: 48 }} />
      ) : (
        <ScrollView contentContainerClassName="gap-lg px-margin-mobile" contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}>
          {CATEGORY_ORDER.map((category) => {
            const rows = achievements.filter((a) => categoryOf(a.id) === category);
            if (rows.length === 0) return null;
            const meta = CATEGORY_META[category];
            return (
              <View key={category} className="gap-sm">
                <SectionLabel label={meta.label} />
                <View className="gap-sm">
                  {rows.map((achievement) => (
                    <AchievementRow
                      key={achievement.id}
                      achievement={achievement}
                      accent={meta.accent}
                      claiming={claimingId === achievement.id}
                      onClaim={() => handleClaim(achievement.id)}
                    />
                  ))}
                </View>
              </View>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

function AchievementRow({
  achievement,
  accent,
  claiming,
  onClaim,
}: {
  achievement: AchievementStatus;
  accent: string;
  claiming: boolean;
  onClaim: () => void;
}) {
  const isComplete = achievement.progress >= achievement.target;
  const canClaim = isComplete && !achievement.claimed;
  const pct = Math.min(100, Math.round((achievement.progress / achievement.target) * 100));

  if (achievement.claimed) {
    return (
      <View
        className="flex-row items-center gap-md rounded-lg p-sm"
        style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.2), opacity: 0.7 }}
      >
        <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(accent, 0.12), borderWidth: 1, borderColor: withOpacity(accent, 0.3) }}>
          <MaterialCommunityIcons name={achievement.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={22} color={accent} />
        </View>
        <View className="flex-1 gap-1">
          <Text className="font-heading-md text-heading-md text-cyan" style={{ textDecorationLine: 'line-through' }}>
            {achievement.title}
          </Text>
          <Text className="font-body-sm text-body-sm text-chrome-dark" style={{ textDecorationLine: 'line-through' }}>
            {achievement.description}
          </Text>
        </View>
        <View className="h-9 w-9 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.15), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
          <AppIcon name="check" size={18} color={Colors.cyan} />
        </View>
      </View>
    );
  }

  return (
    <View
      className="gap-2 rounded-lg p-sm"
      style={{
        backgroundColor: Colors.bgPanel,
        borderWidth: 1,
        borderColor: withOpacity(canClaim ? Colors.cyan : accent, 0.4),
        boxShadow: canClaim ? `0px 0px 15px ${withOpacity(Colors.cyan, 0.15)}` : undefined,
      }}
    >
      <View className="flex-row items-center gap-md">
        <View className="h-11 w-11 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(accent, 0.4) }}>
          <MaterialCommunityIcons name={achievement.icon as keyof typeof MaterialCommunityIcons.glyphMap} size={22} color={accent} />
        </View>
        <View className="w-2/3 flex-1 gap-1">
          <Text className="font-heading-md text-heading-md" style={{ color: canClaim ? Colors.cyan : Colors.textPrimary }}>
            {achievement.title}
          </Text>
          <Text className="font-body-sm text-body-sm text-text-muted">{achievement.description}</Text>
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
          <View className="items-end gap-0.5">
            <View className="flex-row items-center gap-1">
              <CurrencyIcon type={achievement.rewardType === 'gems' ? 'gems' : 'chips'} size={12} />
              <Text className="font-heading-md" style={{ fontSize: 14, color: Colors.emberLight }}>
                {achievement.rewardType === 'xp' ? `${achievement.rewardAmount.toLocaleString('en-US')} XP` : achievement.rewardAmount.toLocaleString('en-US')}
              </Text>
            </View>
            <Text className="font-body-sm text-caption uppercase text-text-muted">Reward</Text>
          </View>
        )}
      </View>

      <View className="mt-2 flex-row items-center gap-3">
        <View className="h-3 flex-1 overflow-hidden rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
          <LinearGradient colors={canClaim ? [Colors.cyan, '#9CF0FF'] : [Colors.gold, '#FFD570']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ width: `${pct}%`, height: '100%' }} />
        </View>
        <Text className="font-section-header text-caption" style={{ color: canClaim ? Colors.cyan : Colors.textMuted }}>
          {achievement.progress.toLocaleString('en-US')} / {achievement.target.toLocaleString('en-US')}
        </Text>
      </View>
    </View>
  );
}
