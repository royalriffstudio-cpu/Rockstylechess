import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CurrencyPill, RockButton, RockCard } from '@/components/ui';
import { BoardAssetPrewarm } from '@/components/ui/BoardAssetPrewarm';
import { SubPageHeader } from '@/components/layout';
import { Colors, withOpacity } from '@/constants/theme';
import { VENUES, formatChips, getVenue, isVenueLocked, type Venue } from '@/constants/venues';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { DURATIONS, DURATION_LABELS, type Duration } from '@/lib/onlineMatch';

export default function PlaySetupScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { chips, profile } = usePlayerProfile();
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
      <BoardAssetPrewarm pieceId={profile?.equippedPieceId} />
      <SubPageHeader title="Match Setup" trailing={<CurrencyPill type="chips" value={chips} />} />

      <ScrollView contentContainerClassName="mx-auto w-full max-w-4xl gap-xl px-margin-mobile pt-lg" contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}>
        <View className="gap-md">
          <Text className="font-section-header text-section-header uppercase tracking-widest text-text-muted">Venue &amp; Stakes</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-md pb-1">
            {VENUES.map((venue) => {
              const locked = isVenueLocked(venue, chips);
              const isActive = !locked && selectedVenueId === venue.id;
              return (
                <Pressable
                  key={venue.id}
                  onPress={() => handleVenuePress(venue)}
                  className="items-center justify-center gap-1 overflow-hidden rounded-lg"
                  style={{
                    width: isActive ? 130 : 110,
                    height: isActive ? 108 : 96,
                    backgroundColor: isActive ? withOpacity(Colors.cyan, 0.14) : withOpacity(Colors.bgPanel, 0.7),
                    borderWidth: isActive ? 2 : 1,
                    borderColor: isActive ? Colors.cyan : withOpacity(Colors.ember, 0.18),
                    boxShadow: isActive ? `0px 0px 20px ${withOpacity(Colors.cyan, 0.4)}` : undefined,
                    opacity: locked ? 0.6 : 1,
                  }}
                >
                  <Image
                    source={venue.image}
                    contentFit="cover"
                    cachePolicy="memory-disk"
                    pointerEvents="none"
                    style={{ position: 'absolute', inset: 0, opacity: isActive ? 0.35 : 0.18 }}
                  />
                  {locked ? (
                    <View style={{ position: 'absolute', top: 6, right: 6 }}>
                      <MaterialCommunityIcons name="lock" size={18} color={Colors.chromeMid} />
                    </View>
                  ) : null}
                  <MaterialCommunityIcons name={venue.icon} size={isActive ? 28 : 22} color={locked ? Colors.chromeMid : isActive ? Colors.cyan : Colors.textMuted} />
                  <Text className="font-heading-md uppercase" style={{ fontSize: isActive ? 13 : 11, color: locked ? Colors.chromeMid : isActive ? Colors.cyan : Colors.textMuted }}>
                    {venue.name}
                  </Text>
                  <Text className="font-display-hero" style={{ fontSize: 12, color: locked ? Colors.chromeMid : Colors.gold }}>
                    {formatChips(venue.buyIn)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>

        <View className="gap-md">
          <Text className="font-section-header text-section-header uppercase tracking-widest text-text-muted">Time Control</Text>
          <View className="flex-row flex-wrap gap-sm">
            {DURATIONS.map((d) => {
              const active = duration === d;
              return (
                <Pressable
                  key={d}
                  onPress={() => {
                    setDuration(d);
                    console.log('Duration selected', d);
                  }}
                  style={{ width: '31%' }}
                >
                  <View
                    className="items-center gap-1 rounded-lg py-md"
                    style={{ backgroundColor: active ? withOpacity(Colors.cyan, 0.1) : withOpacity(Colors.bgPanel, 0.5), borderWidth: 1, borderColor: active ? withOpacity(Colors.cyan, 0.5) : withOpacity(Colors.chromeDark, 0.4) }}
                  >
                    <Text className="font-button-label text-button-label" style={{ color: active ? Colors.cyan : Colors.textMuted }}>
                      {d}
                    </Text>
                    <Text className="font-caption text-caption uppercase" style={{ color: active ? withOpacity(Colors.cyan, 0.7) : Colors.chromeDark }}>
                      {DURATION_LABELS[d]}
                    </Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        </View>

        <RockCard glowColor={Colors.cyan} backgroundImage={selectedVenue.image} style={{ minHeight: 200 }}>
          <View className="flex-row items-center justify-between">
            <View className="flex-shrink">
              <Text className="font-display-hero text-text-primary" style={{ fontSize: 22, textTransform: 'uppercase' }}>
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
        </RockCard>
      </ScrollView>
    </View>
  );
}
