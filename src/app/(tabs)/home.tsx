import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, BottomNav, EmberParticles, RockButton, RockCard } from '@/components/ui';
import { TopAppBar } from '@/components/layout';
import type { ICONS } from '@/constants/icons';
import { Colors, withOpacity } from '@/constants/theme';
import { VENUES, formatChips, getVenue, isVenueLocked, type Venue } from '@/constants/venues';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { DURATIONS, type Duration } from '@/lib/onlineMatch';

// Bento grid -- from new_ui (tabs)/index.tsx (icons, labels, sub-labels,
// routes). Each tile carries the same colored glow so all four read
// consistently (new_ui left the ember one flat).
type HomeTile = {
  icon: keyof typeof ICONS;
  color: string;
  glow: string;
  label: string;
  sub: string;
  route: '/setup' | '/tournaments' | '/bots' | '/puzzles';
};

const HOME_TILES: HomeTile[] = [
  { icon: 'swords', color: Colors.cyan, glow: Colors.cyan, label: 'Iron Duel', sub: '1v1 Ranked', route: '/setup' },
  { icon: 'emoji_events', color: Colors.gold, glow: Colors.gold, label: 'Tournaments', sub: 'High Stakes', route: '/tournaments' },
  { icon: 'smart_toy', color: Colors.ember, glow: Colors.ember, label: 'Bots', sub: 'Practice', route: '/bots' },
  { icon: 'extension', color: Colors.cyan, glow: Colors.cyan, label: 'Puzzles', sub: 'Daily Grind', route: '/puzzles' },
];

export default function HomeLobbyScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { chips } = usePlayerProfile();
  const [selectedVenueId, setSelectedVenueId] = useState('arena');
  const [duration, setDuration] = useState<Duration>('5m');

  const selectedVenue = getVenue(selectedVenueId);

  function handleVenuePress(venue: Venue) {
    if (isVenueLocked(venue, chips)) {
      console.log('Venue locked - insufficient chips', venue.name);
      return;
    }
    setSelectedVenueId(venue.id);
    console.log('Venue selected', venue.name);
  }

  return (
    <View className="flex-1 bg-bg-base">
      <View pointerEvents="none" style={{ position: 'absolute', top: -80, right: -60, width: 260, height: 260, borderRadius: 130, backgroundColor: withOpacity(Colors.cyan, 0.06), boxShadow: `0px 0px 120px ${withOpacity(Colors.cyan, 0.25)}` }} />
      <View pointerEvents="none" style={{ position: 'absolute', bottom: 60, left: -60, width: 220, height: 220, borderRadius: 110, backgroundColor: withOpacity(Colors.ember, 0.06), boxShadow: `0px 0px 100px ${withOpacity(Colors.ember, 0.22)}` }} />
      <EmberParticles count={10} />

      <TopAppBar />

      <ScrollView className="flex-1" contentContainerClassName="gap-xl px-lg" contentContainerStyle={{ paddingTop: 20, paddingBottom: 130 + insets.bottom }} showsVerticalScrollIndicator={false}>
        {/* Venue picker -- icon + name only (the atmospheric photo lives on the
            hero card below). Tapping a venue re-skins that card. Locked purely
            by affordability, same rule as (play)/setup.tsx. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm" contentContainerStyle={{ paddingVertical: 2 }}>
          {VENUES.map((venue) => {
            const locked = isVenueLocked(venue, chips);
            const isActive = !locked && selectedVenueId === venue.id;
            const tint = locked ? Colors.chromeMid : isActive ? Colors.cyan : Colors.textMuted;
            return (
              <Pressable
                key={venue.id}
                onPress={() => handleVenuePress(venue)}
                className="items-center justify-center gap-1 rounded-lg"
                style={{
                  width: 88,
                  height: 72,
                  backgroundColor: isActive ? withOpacity(Colors.cyan, 0.07) : withOpacity(Colors.bgPanel, 0.6),
                  borderWidth: 1,
                  borderColor: isActive ? withOpacity(Colors.cyan, 0.55) : withOpacity(Colors.chromeDark, 0.35),
                  opacity: locked ? 0.45 : 1,
                }}
              >
                {locked ? (
                  <View style={{ position: 'absolute', top: 5, right: 5 }}>
                    <MaterialCommunityIcons name="lock" size={13} color={Colors.chromeMid} />
                  </View>
                ) : null}
                <MaterialCommunityIcons name={venue.icon} size={22} color={tint} />
                <Text className="font-heading-md uppercase" style={{ fontSize: 10, letterSpacing: 0.3, color: tint }} numberOfLines={1}>
                  {venue.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <RockCard variant="surface" glowColor={Colors.cyan} backgroundImage={selectedVenue.image}>
          {/* Fixed inner height -> ~280px hero; justify-between pins the info
              row to the top and the Play button to the bottom. */}
          <View className="justify-between" style={{ minHeight: 248 }}>
          <View className="flex-row items-end justify-between gap-md">
            <View className="flex-shrink">
              <Text className="font-display-hero text-text-primary" style={{ fontSize: 26, textTransform: 'uppercase', textShadowColor: withOpacity(Colors.bgBase, 0.8), textShadowRadius: 6, textShadowOffset: { width: 0, height: 2 } }} numberOfLines={1}>
                {selectedVenue.name}
              </Text>
              <View className="mt-sm flex-row items-center gap-md">
                <View>
                  <Text className="font-heading-md text-caption uppercase tracking-wide text-text-muted">Buy-In</Text>
                  <Text className="font-display-hero" style={{ fontSize: 18, color: Colors.cyan }}>
                    {formatChips(selectedVenue.buyIn)}
                  </Text>
                </View>
                <View style={{ width: 1, height: 28, backgroundColor: withOpacity(Colors.chromeDark, 0.5) }} />
                <View>
                  <Text className="font-heading-md text-caption uppercase tracking-wide text-text-muted">Grand Prize</Text>
                  <Text className="font-display-hero" style={{ fontSize: 18, color: Colors.emberLight }}>
                    {formatChips(selectedVenue.prize)}
                  </Text>
                </View>
              </View>
            </View>

            <View className="flex-row gap-xs">
              {DURATIONS.map((d) => {
                const active = duration === d;
                return (
                  <Pressable
                    key={d}
                    onPress={() => {
                      setDuration(d);
                      console.log('Duration selected', d);
                    }}
                    className="rounded"
                    style={{ paddingHorizontal: 8, paddingVertical: 6, backgroundColor: active ? Colors.cyan : withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: active ? Colors.cyan : withOpacity(Colors.chromeDark, 0.4) }}
                    hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  >
                    <Text className="font-heading-md" style={{ fontSize: 12, color: active ? Colors.bgBase : Colors.textPrimary }}>
                      {d}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <View className="mt-lg">
            <RockButton
              label="Play Now"
              variant="primary"
              icon={<MaterialCommunityIcons name="play" size={20} color={Colors.bgBase} />}
              onPress={() => {
                router.push({ pathname: '/matchmaking', params: { venueTier: selectedVenue.id, duration } });
              }}
            />
          </View>
          </View>
        </RockCard>

        {/* Bento grid -- 2x2 of wide, short tiles (aspectRatio 1.4). One fixed
            26px gap on BOTH axes (row === column) so it reads as four tiles,
            not two columns. flexBasis 40% + flexGrow lets each row's two tiles
            stretch flush to the content edges (so the columns line up with the
            hero card above) while the 26px gutters and the 1.4 ratio stay exact. */}
        <View className="flex-row flex-wrap justify-center" style={{ gap: 26 }}>
          {HOME_TILES.map((tile) => (
            <Pressable
              key={tile.label}
              onPress={() => router.push(tile.route)}
              style={{ flexBasis: '40%', flexGrow: 1, aspectRatio: 1.4 }}
            >
              <RockCard variant="surface" glowColor={tile.glow} contentPadding={12} fillHeight style={{ flex: 1 }}>
                <View className="flex-1 items-center justify-center">
                  <AppIcon name={tile.icon} size={24} color={tile.color} />
                  <Text
                    className="mt-1 text-center font-heading-md text-text-primary"
                    numberOfLines={1}
                    style={{ fontSize: 13 }}
                  >
                    {tile.label}
                  </Text>
                  <Text
                    className="text-center font-caption text-text-muted"
                    numberOfLines={1}
                    style={{ fontSize: 9 }}
                  >
                    {tile.sub}
                  </Text>
                </View>
              </RockCard>
            </Pressable>
          ))}
        </View>

        {/* Daily rewards -- surface cards with a faint icon-colored inner glow
            so they read as part of the same family as the bento tiles above. */}
        <View className="gap-sm">
          <Text className="pl-xs font-section-header text-section-header uppercase tracking-widest text-text-muted">
            Daily Rewards
          </Text>

          <Pressable onPress={() => router.push('/daily-bonus')}>
            <RockCard variant="surface" glowColor={Colors.gold} contentPadding={12}>
              <View className="flex-row items-center justify-between">
                <View className="flex-1 flex-row items-center gap-md">
                  <View
                    className="h-10 w-10 items-center justify-center rounded-md"
                    style={{ backgroundColor: withOpacity(Colors.gold, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.3) }}
                  >
                    <AppIcon name="calendar_today" size={20} color={Colors.gold} />
                  </View>
                  <View>
                    <Text className="font-heading-md text-heading-md text-text-primary">Daily Bonus</Text>
                    <Text className="font-caption text-caption text-text-muted">Claim in 2h 45m</Text>
                  </View>
                </View>
                <View className="h-4 w-24 overflow-hidden rounded-full" style={{ backgroundColor: withOpacity(Colors.chrome, 0.1) }}>
                  <LinearGradient
                    colors={[Colors.gold, Colors.emberLight]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={{ width: '80%', height: '100%' }}
                  />
                </View>
              </View>
            </RockCard>
          </Pressable>

          <RockCard variant="surface" glowColor={Colors.ember} contentPadding={12}>
            <View className="flex-row items-center justify-between">
              <View className="flex-1 flex-row items-center gap-md">
                <View
                  className="h-10 w-10 items-center justify-center rounded-md"
                  style={{ backgroundColor: withOpacity(Colors.ember, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.ember, 0.3) }}
                >
                  <AppIcon name="casino" size={20} color={Colors.ember} />
                </View>
                <View>
                  <Text className="font-heading-md text-heading-md text-text-primary">Spin to Win</Text>
                  <Text className="font-caption text-caption text-text-muted">1 Free Spin</Text>
                </View>
              </View>
              <Pressable
                onPress={() => router.push('/spin')}
                className="rounded-full px-md py-xs"
                style={{ backgroundColor: withOpacity(Colors.ember, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.ember, 0.4) }}
              >
                <Text className="font-button-label text-button-label uppercase" style={{ color: Colors.emberLight }}>Spin</Text>
              </Pressable>
            </View>
          </RockCard>
        </View>
      </ScrollView>

      <BottomNav activeTab="home" />
    </View>
  );
}
