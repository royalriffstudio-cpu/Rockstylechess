import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SubPageHeader } from '@/components/layout'
import { AppIcon, BottomNav, CurrencyPill, ProgressBar, RockButton, RockCard, SectionLabel } from '@/components/ui'
import { Colors, withOpacity } from '@/constants/theme'
import { usePlayerProfile } from '@/hooks/usePlayerProfile'

interface UpcomingEvent {
  id: string
  title: string
  subtitle: string
  startsIn: string
  accent: string
  locked: boolean
}

const UPCOMING_EVENTS: UpcomingEvent[] = [
  {
    id: 'blitz-battle',
    title: 'Blitz Battle',
    subtitle: 'Fast-paced 3min games • Winner takes 500k',
    startsIn: '2h',
    accent: Colors.cyan,
    locked: false,
  },
  {
    id: 'night-of-the-king',
    title: 'Night of the King',
    subtitle: 'Elimination bracket • Pro Ranking Points',
    startsIn: '6h',
    accent: Colors.emberLight,
    locked: false,
  },
  {
    id: 'rock-n-roll-rapid',
    title: "Rock 'n' Roll Rapid",
    subtitle: 'Classic 10min time control • Entry 50k',
    startsIn: '12h',
    accent: Colors.textMuted,
    locked: true,
  },
]

export default function TournamentsScreen() {
  const insets = useSafeAreaInsets()
  const { chips } = usePlayerProfile()

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Championship Circuit" trailing={<CurrencyPill type="chips" value={chips} />} />

      <ScrollView contentContainerClassName="gap-xl px-lg py-xl" contentContainerStyle={{ paddingBottom: 110 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View className="flex-row items-end justify-between">
          <Text className="font-display-hero text-display-hero uppercase text-cyan" style={{ fontSize: 20 }}>
            Live Now
          </Text>
          <View className="flex-row items-center gap-xs">
            <View className="h-2 w-2 rounded-full bg-crimson" />
            <Text className="font-section-header text-section-header uppercase text-crimson">On Air</Text>
          </View>
        </View>

        <RockCard glowColor={Colors.cyan}>
          <View className="gap-lg">
            <View className="flex-row items-start justify-between">
              <View>
                <View
                  className="mb-xs self-start rounded-sm px-sm py-0.5"
                  style={{ backgroundColor: withOpacity(Colors.cyan, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.2) }}
                >
                  <Text className="font-section-header text-section-header uppercase text-cyan" style={{ fontSize: 9 }}>
                    The Championship Circuit
                  </Text>
                </View>
                <Text className="font-display-hero text-display-hero uppercase text-text-primary" style={{ fontSize: 24 }}>
                  Grandmaster Open
                </Text>
              </View>
              <View className="items-end">
                <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ fontSize: 10 }}>
                  Ends in
                </Text>
                <Text className="font-display-hero text-display-hero text-text-primary" style={{ fontSize: 18 }}>
                  04:12:09
                </Text>
              </View>
            </View>

            <View>
              <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ letterSpacing: 2 }}>
                Grand Prize Pool
              </Text>
              <Text
                className="font-display-hero text-display-hero text-gold"
                style={{ fontSize: 26, textShadowColor: withOpacity(Colors.gold, 0.4), textShadowRadius: 12, textShadowOffset: { width: 0, height: 0 } }}
              >
                100,000 CHIPS
              </Text>
            </View>

            <View className="gap-xs">
              <View className="flex-row justify-between">
                <Text className="font-section-header text-cyan" style={{ fontSize: 11 }}>
                  1,240 / 2,000 PLAYERS
                </Text>
                <Text className="font-body-base text-text-muted" style={{ fontSize: 11 }}>
                  62% FULL
                </Text>
              </View>
              <ProgressBar progress={0.62} />
            </View>

            <RockButton label="Join Now - 1M" variant="primary" onPress={() => console.log('Join Grandmaster Open pressed')} />
          </View>
        </RockCard>

        <View className="gap-md">
          <SectionLabel label="My Tickets" />
          <RockCard>
            <View className="gap-md">
              <View className="flex-row items-center gap-md">
                <View
                  className="h-12 w-12 items-center justify-center rounded-md"
                  style={{ backgroundColor: withOpacity(Colors.cyan, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3) }}
                >
                  <AppIcon name="local_play" size={26} color={Colors.cyan} />
                </View>
                <View className="flex-1">
                  <Text className="font-section-header text-section-header uppercase text-text-primary" style={{ fontSize: 14 }}>
                    Challenger Series
                  </Text>
                  <Text className="mt-xs font-body-base text-text-muted" style={{ fontSize: 12 }}>
                    Table #42 • Round 3/5
                  </Text>
                </View>
              </View>
              <RockButton label="Go to Arena" variant="primary" onPress={() => console.log('Go to Arena pressed')} />
            </View>
          </RockCard>
        </View>

        <View className="gap-md">
          <SectionLabel label="Upcoming Events" />
          <View className="gap-sm">
            {UPCOMING_EVENTS.map((event) => (
              <Pressable key={event.id} onPress={() => console.log(event.locked ? `${event.title} is locked` : `${event.title} pressed`)}>
                <RockCard style={event.locked ? { opacity: 0.7 } : undefined}>
                  <View className="flex-row items-center gap-md">
                    <View className="items-center pr-md" style={{ borderRightWidth: 1, borderRightColor: withOpacity(Colors.chromeDark, 0.4) }}>
                      <Text className="font-display-hero text-display-hero text-text-primary" style={{ fontSize: 18 }}>
                        {event.startsIn}
                      </Text>
                      <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ fontSize: 9 }}>
                        Starts
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="font-section-header text-section-header uppercase" style={{ fontSize: 14, color: event.accent }}>
                        {event.title}
                      </Text>
                      <Text className="mt-xs font-body-base text-text-muted" style={{ fontSize: 11 }}>
                        {event.subtitle}
                      </Text>
                    </View>
                    <AppIcon name={event.locked ? 'lock' : 'chevron_right'} size={20} color={Colors.textMuted} />
                  </View>
                </RockCard>
              </Pressable>
            ))}
          </View>
        </View>
      </ScrollView>

      <BottomNav activeTab="play" />
    </View>
  )
}
