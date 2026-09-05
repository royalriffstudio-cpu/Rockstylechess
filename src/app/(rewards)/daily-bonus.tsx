import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, CurrencyIcon, CurrencyPill, ProgressBar, RockButton } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { claimDailyBonus, getDailyBonusStatus, type DailyBonusStatus } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { DAILY_BONUS_REWARDS, type DailyBonusReward } from '@/lib/dailyBonusRewards';

type DayState = 'claimed' | 'current' | 'upcoming';

function dayState(day: number, cycleDay: number): DayState {
  if (day < cycleDay) return 'claimed';
  if (day === cycleDay) return 'current';
  return 'upcoming';
}

// What the day actually pays out -- a mixed chips+gems day (Gift Box) shows
// a gift icon; otherwise the canonical chips / gems glyph (CurrencyIcon).
function rewardKind(reward: DailyBonusReward): 'mixed' | 'gems' | 'chips' {
  if (reward.chips > 0 && reward.gems > 0) return 'mixed';
  if (reward.gems > 0) return 'gems';
  return 'chips';
}

export default function DailyBonusScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status: profileStatus, gems, refresh } = usePlayerProfile();
  const [bonusStatus, setBonusStatus] = useState<DailyBonusStatus | null>(null);
  const [claiming, setClaiming] = useState(false);

  useEffect(() => {
    if (profileStatus !== 'ready') return;
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      try {
        const status = await getDailyBonusStatus(token);
        if (!cancelled) setBonusStatus(status);
      } catch (error) {
        console.log('Failed to load daily bonus status', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileStatus]);

  async function handleClaim() {
    if (!bonusStatus?.canClaimToday || claiming) return;
    setClaiming(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      const result = await claimDailyBonus(token);
      setBonusStatus({ currentStreak: result.streak, canClaimToday: false, nextClaimDay: result.day });
      refresh();
    } catch (error) {
      console.log('Failed to claim daily bonus', error);
    } finally {
      setClaiming(false);
    }
  }

  const cycleDay = bonusStatus?.nextClaimDay ?? 1;
  const canClaimToday = bonusStatus?.canClaimToday ?? false;
  const streak = bonusStatus?.currentStreak ?? 0;

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Daily Bonus" trailing={<CurrencyPill type="gems" value={gems} />} />

      {profileStatus === 'guest' ? (
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <Text className="text-center font-body-base text-body-base text-text-muted">Sign in to claim daily rewards.</Text>
          <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
        </View>
      ) : !bonusStatus ? (
        <ActivityIndicator color={Colors.cyan} style={{ marginTop: 48 }} />
      ) : (
        <ScrollView
          contentContainerClassName="mx-auto w-full max-w-md gap-xl px-margin-mobile py-xl"
          contentContainerStyle={{ paddingBottom: 24 + insets.bottom }}
        >
          <View className="items-center">
            <Text className="mb-sm text-center font-display-hero text-display-hero uppercase text-text-primary">Daily Streak</Text>
            <Text className="text-center font-body-sm text-body-sm text-text-muted">{streak} day{streak === 1 ? '' : 's'} and counting. Don&apos;t miss a day!</Text>
          </View>

          <View className="flex-row flex-wrap gap-gutter">
            {DAILY_BONUS_REWARDS.slice(0, 6).map((reward) => {
              const state = dayState(reward.day, cycleDay);
              const isCurrent = state === 'current';
              const isClaimed = state === 'claimed';
              const claimedToday = reward.day === cycleDay && !canClaimToday;
              return (
                <Pressable key={reward.day} disabled={!isCurrent || claimedToday} onPress={handleClaim} style={{ width: '47%' }}>
                  <View
                    className="items-center justify-center overflow-hidden rounded-xl p-md"
                    style={{
                      minHeight: 140,
                      backgroundColor: Colors.bgPanel,
                      opacity: isClaimed ? 0.6 : 1,
                      borderTopWidth: isCurrent ? 1 : 0,
                      borderColor: isCurrent ? withOpacity(Colors.ember, 0.6) : 'transparent',
                      boxShadow: isCurrent ? `0px 0px 20px ${withOpacity(Colors.ember, 0.4)}` : undefined,
                    }}
                  >
                    <Text className="mb-sm font-section-header text-section-header" style={{ color: isCurrent ? Colors.emberLight : isClaimed ? Colors.textMuted : Colors.chromeDark }}>
                      DAY {reward.day}
                    </Text>
                    <View className="relative mb-sm h-12 w-12 items-center justify-center">
                      {(() => {
                        const kind = rewardKind(reward);
                        const iconColor = isCurrent
                          ? Colors.emberLight
                          : isClaimed || claimedToday
                            ? Colors.chromeDark
                            : Colors.textMuted;
                        const iconSize = isCurrent ? 44 : 36;
                        return kind === 'mixed' ? (
                          <AppIcon name="redeem" size={iconSize} color={iconColor} />
                        ) : (
                          <CurrencyIcon type={kind} size={iconSize} color={iconColor} />
                        );
                      })()}
                      {isClaimed || claimedToday ? (
                        <View className="absolute -bottom-1 -right-1 h-6 w-6 items-center justify-center rounded-full bg-bg-base" style={{ borderWidth: 1, borderColor: Colors.cyan }}>
                          <AppIcon name="check" size={14} color={Colors.cyan} />
                        </View>
                      ) : null}
                    </View>
                    {isClaimed || claimedToday ? (
                      <Text className="font-button-label text-caption text-text-muted">CLAIMED</Text>
                    ) : isCurrent ? (
                      <View className="rounded-full bg-ember px-sm py-[2px]">
                        <Text className="font-button-label text-caption tracking-wider text-bg-base">CLAIM</Text>
                      </View>
                    ) : (
                      <View className="flex-row items-center gap-1">
                        <AppIcon name="lock" size={14} color={Colors.chromeDark} />
                        <Text className="font-button-label text-caption text-chrome-dark">LOCKED</Text>
                      </View>
                    )}
                  </View>
                </Pressable>
              );
            })}
          </View>

          <LinearGradient
            colors={['#3a2c0b', Colors.bgPanel, Colors.bgBase]}
            style={{ borderRadius: 20, overflow: 'hidden', borderTopWidth: 2, borderColor: withOpacity(Colors.gold, 0.7), boxShadow: `0px 10px 30px ${withOpacity(Colors.gold, 0.3)}` }}
          >
            <View className="items-center p-xl">
              <View className="mb-md flex-row items-center gap-xs">
                <AppIcon name="stars" size={18} color={Colors.gold} />
                <Text className="font-headline-lg tracking-widest text-gold" style={{ fontSize: 20 }}>
                  DAY 7 JACKPOT
                </Text>
                <AppIcon name="stars" size={18} color={Colors.gold} />
              </View>
              <View className="my-md w-full max-w-[240px]" style={{ aspectRatio: 4 / 3 }}>
                <Image source={ScreenArt.dailyBonusChest} style={{ width: '100%', height: '100%' }} contentFit="contain" cachePolicy="memory-disk" transition={300} />
              </View>
              <ProgressBar progress={Math.min(cycleDay, 7) / 7} label={cycleDay >= 7 ? 'Today!' : `${7 - cycleDay} days left`} />
              {cycleDay === 7 ? (
                <Pressable style={{ width: '100%', maxWidth: 260, marginTop: 16 }} disabled={!canClaimToday} onPress={handleClaim}>
                  <LinearGradient
                    colors={['#ffe58f', Colors.gold, '#c48e10']}
                    style={{ borderRadius: 9999, paddingVertical: 14, paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', opacity: canClaimToday ? 1 : 0.6 }}
                  >
                    <AppIcon name={canClaimToday ? 'redeem' : 'check'} size={20} color={Colors.bgBase} />
                    <Text className="ml-sm font-button-label text-heading-md text-bg-base">{canClaimToday ? 'Claim Jackpot' : 'Claimed'}</Text>
                  </LinearGradient>
                </Pressable>
              ) : (
                <Text className="mt-sm font-body-sm text-caption" style={{ color: withOpacity(Colors.gold, 0.6) }}>
                  Play {7 - cycleDay} more day{7 - cycleDay === 1 ? '' : 's'} to unlock
                </Text>
              )}
            </View>
          </LinearGradient>

          <Text className="text-center font-body-sm text-caption text-text-muted" style={{ opacity: 0.7, maxWidth: 320, alignSelf: 'center' }}>
            Maintain your streak to increase your luck for the Day 7 jackpot. Miss a day, and the cycle resets to Day 1!
          </Text>
        </ScrollView>
      )}
    </View>
  );
}
