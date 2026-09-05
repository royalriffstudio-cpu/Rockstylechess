import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TopAppBar } from '@/components/layout';
import { AppIcon, BottomNav, RockButton, RockCard, SectionLabel } from '@/components/ui';
import type { ICONS } from '@/constants/icons';
import { Colors, withOpacity } from '@/constants/theme';
import type { Duration } from '@/lib/onlineMatch';

// The "Play" bottom-nav destination -- a mode picker, fused from
// new_ui/play.tsx. `GradientCard` -> `RockCard variant="surface"`,
// `colors` -> `Colors`, MD3 `surface-*` tokens -> chrome/bg tints.

type Glow = 'cyan' | 'gold' | 'crimson';
const GLOW_HEX: Record<Glow, string> = {
  cyan: Colors.cyan,
  gold: Colors.gold,
  crimson: Colors.crimson,
};

interface TimeFormat {
  id: string;
  label: string;
  clock: string;
  icon: keyof typeof ICONS;
  // Nearest real queue duration -- production only supports 3m/5m/10m
  // (setup.tsx / onlineMatch.ts); the clock labels above are cosmetic, as
  // in new_ui.
  duration: Duration;
}

const TIME_FORMATS: TimeFormat[] = [
  { id: 'bullet', label: 'Bullet', clock: '1+0', icon: 'bolt', duration: '3m' },
  { id: 'blitz', label: 'Blitz', clock: '3+2', icon: 'local_fire_department', duration: '3m' },
  { id: 'rapid', label: 'Rapid', clock: '10+0', icon: 'timer', duration: '10m' },
  { id: 'classical', label: 'Classical', clock: '30+0', icon: 'schedule', duration: '10m' },
];

interface Mode {
  id: string;
  title: string;
  sub: string;
  icon: keyof typeof ICONS;
  glow: Glow;
  path: '/setup' | '/game-room' | '/tournaments' | '/bots' | '/puzzles' | '/replay';
}

const COMPETITIVE: Mode[] = [
  { id: 'iron-duel', title: 'Iron Duel', sub: 'Custom 1v1 · pick venue & time control', icon: 'swords', glow: 'cyan', path: '/setup' },
  { id: 'friend', title: 'Play a Friend', sub: 'Private room · create or join by code', icon: 'handshake', glow: 'gold', path: '/game-room' },
  { id: 'tournaments', title: 'Tournaments', sub: 'Arenas & brackets · high stakes', icon: 'emoji_events', glow: 'gold', path: '/tournaments' },
];

const TRAINING: Mode[] = [
  { id: 'bots', title: 'Vs Bots', sub: 'Practice · adjustable difficulty', icon: 'smart_toy', glow: 'crimson', path: '/bots' },
  { id: 'puzzles', title: 'Puzzles', sub: 'Daily grind · tactics training', icon: 'extension', glow: 'cyan', path: '/puzzles' },
  { id: 'analysis', title: 'Analysis Board', sub: 'Replay games · explore lines', icon: 'replay', glow: 'cyan', path: '/replay' },
];

function ModeRow({ mode }: { mode: Mode }) {
  const router = useRouter();
  const hex = GLOW_HEX[mode.glow];
  return (
    <Pressable onPress={() => router.push(mode.path)}>
      <RockCard variant="surface" glowColor={hex}>
        <View className="flex-row items-center gap-md">
          <View
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: withOpacity(Colors.chrome, 0.1), borderWidth: 1, borderColor: withOpacity(hex, 0.3) }}
          >
            <AppIcon name={mode.icon} size={22} color={hex} />
          </View>
          <View className="flex-1">
            <Text className="font-heading-md text-heading-md text-text-primary">{mode.title}</Text>
            <Text className="font-caption text-caption text-text-muted">{mode.sub}</Text>
          </View>
          <AppIcon name="chevron_right" size={22} color={Colors.chromeMid} />
        </View>
      </RockCard>
    </Pressable>
  );
}

export default function PlayScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [format, setFormat] = useState('blitz');

  const selectedDuration = TIME_FORMATS.find((tf) => tf.id === format)?.duration ?? '5m';

  return (
    <View className="flex-1 bg-bg-base">
      <TopAppBar />
      <ScrollView
        contentContainerClassName="gap-xl px-margin-mobile py-xl"
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
      >
        <View className="gap-xs">
          <Text className="font-section-header text-section-header uppercase tracking-widest text-ember-light">Ready Up</Text>
          <Text className="font-display-hero text-display-hero text-text-primary">CHOOSE YOUR MODE</Text>
        </View>

        {/* Featured -- Quick Match */}
        <RockCard variant="surface" glowColor={Colors.cyan}>
          <View className="gap-md">
            <View className="flex-row items-center gap-sm">
              <AppIcon name="bolt" size={24} color={Colors.cyan} />
              <Text className="font-heading-md text-heading-md uppercase text-text-primary">Quick Match</Text>
            </View>
            <Text className="font-caption text-caption text-text-muted">Jump into a ranked game, auto-paired by rating.</Text>

            <View className="flex-row flex-wrap gap-sm">
              {TIME_FORMATS.map((tf) => {
                const selected = format === tf.id;
                return (
                  <Pressable
                    key={tf.id}
                    onPress={() => setFormat(tf.id)}
                    className="items-center gap-1 rounded-lg px-md py-sm"
                    style={{
                      minWidth: 76,
                      backgroundColor: selected ? withOpacity(Colors.cyan, 0.1) : withOpacity(Colors.bgBase, 0.5),
                      borderWidth: 1,
                      borderColor: selected ? withOpacity(Colors.cyan, 0.5) : withOpacity(Colors.chromeDark, 0.5),
                    }}
                  >
                    <AppIcon name={tf.icon} size={18} color={selected ? Colors.cyan : Colors.chromeMid} />
                    <Text
                      className="font-button-label text-button-label uppercase"
                      style={{ color: selected ? Colors.cyan : Colors.textPrimary }}
                    >
                      {tf.label}
                    </Text>
                    <Text className="font-caption text-caption text-text-muted">{tf.clock}</Text>
                  </Pressable>
                );
              })}
            </View>

            <RockButton
              label="Find Match"
              variant="cyan"
              icon={<AppIcon name="bolt" size={18} color={Colors.bgBase} />}
              onPress={() => router.push({ pathname: '/matchmaking', params: { duration: selectedDuration } })}
            />
          </View>
        </RockCard>

        {/* Competitive */}
        <View className="gap-sm">
          <SectionLabel label="Competitive" />
          {COMPETITIVE.map((mode) => (
            <ModeRow key={mode.id} mode={mode} />
          ))}
        </View>

        {/* Casual & Training */}
        <View className="gap-sm">
          <SectionLabel label="Casual & Training" />
          {TRAINING.map((mode) => (
            <ModeRow key={mode.id} mode={mode} />
          ))}
        </View>
      </ScrollView>

      <BottomNav activeTab="play" />
    </View>
  );
}
