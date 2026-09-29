import { Alert, Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SubPageHeader } from '@/components/layout'
import { AppIcon, CurrencyPill, RockButton, RockCard } from '@/components/ui'
import { Colors, withOpacity } from '@/constants/theme'
import { usePlayerProfile } from '@/hooks/usePlayerProfile'

interface EventPreview {
  id: string
  title: string
  subtitle: string
  accent: string
}

// Flavor/preview only -- no real tournament backend exists yet (no
// schedule, no bracket, no entry/prize handling), so nothing here claims a
// specific time, prize amount, or player count. Every tap surfaces the same
// "coming soon" notice rather than silently doing nothing.
const EVENT_PREVIEWS: EventPreview[] = [
  {
    id: 'blitz-battle',
    title: 'Blitz Battle',
    subtitle: 'Fast-paced 3min games, bracket-style knockout',
    accent: Colors.cyan,
  },
  {
    id: 'night-of-the-king',
    title: 'Night of the King',
    subtitle: 'Elimination bracket, pro ranking points on the line',
    accent: Colors.emberLight,
  },
  {
    id: 'rock-n-roll-rapid',
    title: "Rock 'n' Roll Rapid",
    subtitle: 'Classic 10min time control',
    accent: Colors.textMuted,
  },
]

function notifyComingSoon() {
  Alert.alert('Coming Soon', "Tournaments aren't live yet -- we're still building brackets, scheduling, and prize pools. Check back soon!")
}

function ComingSoonBadge() {
  return (
    <View
      className="flex-row items-center gap-1 self-start rounded-sm px-sm py-0.5"
      style={{ backgroundColor: withOpacity(Colors.gold, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.35) }}
    >
      <AppIcon name="lock" size={11} color={Colors.gold} />
      <Text className="font-section-header text-section-header uppercase text-gold" style={{ fontSize: 9 }}>
        Coming Soon
      </Text>
    </View>
  )
}

export default function TournamentsScreen() {
  const insets = useSafeAreaInsets()
  const { chips } = usePlayerProfile()

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Championship Circuit" trailing={<CurrencyPill type="chips" value={chips} />} />

      <ScrollView contentContainerClassName="gap-xl px-lg py-xl" contentContainerStyle={{ paddingBottom: 32 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View className="gap-xs">
          <ComingSoonBadge />
          <Text className="font-display-hero text-display-hero uppercase text-cyan" style={{ fontSize: 20 }}>
            Tournaments Are Coming
          </Text>
          <Text className="font-body-base text-body-sm text-text-muted" style={{ fontSize: 12 }}>
            Brackets, live rankings, and prize pools are still in the works. Here's a preview of what's on the way.
          </Text>
        </View>

        <RockCard glowColor={Colors.cyan}>
          <View className="gap-md">
            <View className="flex-row items-start justify-between">
              <View className="flex-1 gap-xs">
                <ComingSoonBadge />
                <Text className="font-display-hero text-display-hero uppercase text-text-primary" style={{ fontSize: 22 }}>
                  Grandmaster Open
                </Text>
                <Text className="font-body-base text-text-muted" style={{ fontSize: 12 }}>
                  A flagship bracket tournament with chip prize pools -- format and dates aren't set yet.
                </Text>
              </View>
            </View>

            <RockButton label="Notify Me" variant="secondary" onPress={notifyComingSoon} />
          </View>
        </RockCard>

        <View className="gap-md">
          <Text className="font-section-header text-section-header uppercase text-text-muted">Planned Formats</Text>
          <View className="gap-sm">
            {EVENT_PREVIEWS.map((event) => (
              <Pressable key={event.id} onPress={notifyComingSoon}>
                <RockCard style={{ opacity: 0.85 }}>
                  <View className="flex-row items-center gap-md">
                    <View
                      className="items-center justify-center rounded-md"
                      style={{ width: 44, height: 44, backgroundColor: withOpacity(event.accent, 0.1), borderWidth: 1, borderColor: withOpacity(event.accent, 0.3) }}
                    >
                      <AppIcon name="lock" size={18} color={event.accent} />
                    </View>
                    <View className="flex-1">
                      <Text className="font-section-header text-section-header uppercase" style={{ fontSize: 14, color: event.accent }}>
                        {event.title}
                      </Text>
                      <Text className="mt-xs font-body-base text-text-muted" style={{ fontSize: 11 }}>
                        {event.subtitle}
                      </Text>
                    </View>
                    <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ fontSize: 9 }}>
                      Soon
                    </Text>
                  </View>
                </RockCard>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
