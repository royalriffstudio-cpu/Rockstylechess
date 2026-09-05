import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { LinearGradient } from 'expo-linear-gradient'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SubPageHeader } from '@/components/layout'
import { CurrencyPill, ProgressBar, RockCard } from '@/components/ui'
import { Colors, withOpacity } from '@/constants/theme'
import { usePlayerProfile } from '@/hooks/usePlayerProfile'

interface Badge {
  id: string
  icon: keyof typeof MaterialCommunityIcons.glyphMap
  title: string
  reward: string
  unlocked: boolean
  variant?: 'chrome' | 'gold'
}

const BADGES: Badge[] = [
  { id: 'blitz-king', icon: 'speedometer', title: 'Blitz King', reward: '+50 XP', unlocked: true, variant: 'chrome' },
  { id: 'first-blood', icon: 'medal', title: 'First Blood', reward: '100 Gems', unlocked: true, variant: 'gold' },
  { id: 'checkmate', icon: 'flag-checkered', title: 'Checkmate', reward: '+25 XP', unlocked: true, variant: 'chrome' },
  { id: 'grandmaster', icon: 'lock', title: 'Grandmaster', reward: '500 Gems', unlocked: false },
  { id: 'iron-wall', icon: 'lock', title: 'Iron Wall', reward: '+150 XP', unlocked: false },
  { id: 'tactician', icon: 'lock', title: 'Tactician', reward: '200 Gems', unlocked: false },
  { id: 'sharp-eye', icon: 'lock', title: 'Sharp Eye', reward: '+50 XP', unlocked: false },
  { id: 'vengeance', icon: 'lock', title: 'Vengeance', reward: '300 Gems', unlocked: false },
  { id: 'crowd-favorite', icon: 'lock', title: 'Crowd Favorite', reward: '+500 XP', unlocked: false },
]

export default function AchievementsScreen() {
  const insets = useSafeAreaInsets()
  const { gems } = usePlayerProfile()

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Hall of Fame" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView contentContainerClassName="gap-xl px-lg py-xl" contentContainerStyle={{ paddingBottom: 60 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <RockCard glowColor={Colors.gold}>
          <View className="flex-row flex-wrap items-center gap-lg">
            <View
              className="h-32 w-32 shrink-0 items-center justify-center rounded-full"
              style={{ backgroundColor: Colors.bgBase, borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.3) }}
            >
              <LinearGradient
                colors={[Colors.gold, Colors.ember, Colors.crimson]}
                style={{ position: 'absolute', inset: 0, borderRadius: 64, padding: 2 }}
              >
                <View className="flex-1 items-center justify-center overflow-hidden rounded-full" style={{ backgroundColor: Colors.bgPanel }}>
                  <MaterialCommunityIcons name="trophy" size={56} color={Colors.gold} />
                </View>
              </LinearGradient>
            </View>

            <View className="flex-1 gap-md" style={{ minWidth: 220 }}>
              <View>
                <View
                  className="mb-xs self-start rounded-full px-sm py-xs"
                  style={{ backgroundColor: withOpacity(Colors.ember, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.ember, 0.3) }}
                >
                  <Text className="font-button-label uppercase tracking-widest text-ember" style={{ fontSize: 11 }}>
                    Epic Quest
                  </Text>
                </View>
                <Text className="font-heading-md text-heading-md uppercase tracking-wide text-text-primary">Legend of the Arena</Text>
                <Text className="mt-xs font-body-sm text-body-sm text-text-muted">
                  Win 10 consecutive matches on the main stage to unlock the ultimate performer title and 1,000 Diamonds.
                </Text>
              </View>

              <View className="gap-xs">
                <View className="flex-row justify-between">
                  <Text className="font-button-label text-text-muted" style={{ fontSize: 11 }}>
                    PROGRESS
                  </Text>
                  <Text className="font-headline-lg text-gold" style={{ fontSize: 16 }}>
                    6/10
                  </Text>
                </View>
                <ProgressBar progress={0.6} />
              </View>
            </View>
          </View>
        </RockCard>

        <View className="gap-lg">
          <View className="flex-row items-center gap-md">
            <Text className="font-section-header text-section-header uppercase tracking-widest text-chrome-dark">Collection</Text>
            <View className="h-px flex-1" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.5) }} />
          </View>

          <View className="flex-row flex-wrap gap-y-lg" style={{ justifyContent: 'space-between' }}>
            {BADGES.map((badge) => (
              <Pressable
                key={badge.id}
                style={{ width: '31%' }}
                className="items-center gap-xs"
                onPress={() => console.log(badge.unlocked ? `${badge.title} viewed` : `${badge.title} is locked`)}
              >
                {badge.unlocked ? (
                  <View
                    className="aspect-square w-full items-center justify-center rounded-full"
                    style={{
                      borderWidth: 1,
                      borderColor: withOpacity(badge.variant === 'gold' ? Colors.gold : Colors.chrome, 0.3),
                      boxShadow: `0px 0px 18px ${withOpacity(badge.variant === 'gold' ? Colors.gold : Colors.chrome, 0.4)}`,
                    }}
                  >
                    <LinearGradient
                      colors={badge.variant === 'gold' ? [Colors.gold, Colors.emberLight, Colors.ember] : [Colors.chrome, Colors.chromeMid, Colors.chromeDark]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}
                      style={{ position: 'absolute', inset: 0, borderRadius: 999 }}
                    />
                    <MaterialCommunityIcons name={badge.icon} size={32} color={Colors.bgBase} />
                  </View>
                ) : (
                  <View
                    className="aspect-square w-full items-center justify-center rounded-full"
                    style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.7), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
                  >
                    <MaterialCommunityIcons name="lock" size={30} color={Colors.chromeMid} />
                  </View>
                )}
                <Text
                  className="text-center font-button-label uppercase"
                  style={{ fontSize: 11, color: badge.unlocked ? Colors.textPrimary : Colors.textMuted }}
                >
                  {badge.title}
                </Text>
                <Text className="font-body-sm" style={{ fontSize: 10, color: badge.unlocked ? Colors.gold : withOpacity(Colors.textMuted, 0.6) }}>
                  {badge.reward}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
