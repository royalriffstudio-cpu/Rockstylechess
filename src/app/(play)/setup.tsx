import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CurrencyPill, RockButton, RockCard } from '@/components/ui';
import { BoardAssetPrewarm } from '@/components/ui/BoardAssetPrewarm';
import { SubPageHeader } from '@/components/layout';
import { Colors, withOpacity } from '@/constants/theme';
import { VENUES, formatChips, getVenue, type Venue } from '@/constants/venues';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { useGear } from '@/hooks/useGear';
import { useQueueStats } from '@/hooks/useQueueStats';
import { useVenueEntry } from '@/hooks/useVenueEntry';
import { safetyNetTerms } from '@/lib/gear';
import { DURATIONS, DURATION_LABELS, type Duration } from '@/lib/onlineMatch';

export default function PlaySetupScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { chips, profile, status } = usePlayerProfile();
  const { requirementFor, explain, tryPlay } = useVenueEntry();
  const { gear } = useGear();
  // Safety Net: an optional add-on, only offered where there is a buy-in and an account to charge.
  const [insured, setInsured] = useState(false);
  // Garage first: stakes are something you choose, never the default.
  const [selectedVenueId, setSelectedVenueId] = useState('garage');
  const [duration, setDuration] = useState<Duration>('5m');

  const selectedVenue = getVenue(selectedVenueId);
  // Players searching per time control at this venue (you are only ever matched on the clock you pick).
  const waiting = useQueueStats(selectedVenueId);
  const netOffered = selectedVenue.buyIn > 0 && status === 'ready';
  const net = netOffered ? safetyNetTerms(selectedVenue.buyIn) : null;
  const insuredNow = insured && netOffered;
  // What is on for the next match: gear the player has switched on, or sitting unused in the bag.
  const gearPills = (gear?.items ?? [])
    .map((item) => ({ item, state: item.activeCharges > 0 ? 'active' : item.quantity > 0 ? 'bag' : null }))
    .filter((g): g is { item: NonNullable<typeof gear>['items'][number]; state: 'active' | 'bag' } => g.state !== null);

  function handleVenuePress(venue: Venue) {
    const requirement = requirementFor(venue);
    if (requirement) {
      void explain(venue, requirement);
      return;
    }
    setSelectedVenueId(venue.id);
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
              const locked = requirementFor(venue) !== null;
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
                    {waiting ? (
                      <Text className="font-caption" style={{ fontSize: 10, color: waiting[d] > 0 ? Colors.gold : Colors.chromeMid }}>
                        {waiting[d] > 0 ? `${waiting[d]} searching` : 'no one waiting'}
                      </Text>
                    ) : null}
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

          {net ? (
            <Pressable
              onPress={() => setInsured((on) => !on)}
              className="mt-lg flex-row items-center gap-md rounded-lg"
              style={{ padding: 10, backgroundColor: withOpacity(Colors.bgBase, 0.55), borderWidth: 1, borderColor: insuredNow ? Colors.ember : withOpacity(Colors.chromeDark, 0.6) }}
            >
              <MaterialCommunityIcons name={insuredNow ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={22} color={insuredNow ? Colors.ember : Colors.textMuted} />
              <View className="flex-1">
                <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 13 }}>
                  Safety Net · +{formatChips(net.premium)}
                </Text>
                <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                  If you lose, {formatChips(net.cover)} of your buy-in comes back. A win or a draw doesn&apos;t get it back, so it is never free.
                </Text>
              </View>
            </Pressable>
          ) : null}

          {gearPills.length > 0 ? (
            <View className="mt-md flex-row flex-wrap gap-sm">
              {gearPills.map(({ item, state }) => (
                <Pressable
                  key={item.id}
                  onPress={state === 'bag' ? () => router.push('/shop') : undefined}
                  className="rounded-full px-sm"
                  style={{ paddingVertical: 3, backgroundColor: withOpacity(state === 'active' ? Colors.gold : Colors.chromeDark, 0.16), borderWidth: 1, borderColor: withOpacity(state === 'active' ? Colors.gold : Colors.chromeMid, 0.6) }}
                >
                  <Text className="font-heading-md uppercase" style={{ fontSize: 10, letterSpacing: 0.8, color: state === 'active' ? Colors.gold : Colors.textMuted }}>
                    {state === 'active'
                      ? item.id === 'lucky-pick'
                        ? `${item.name} armed`
                        : `${item.name} · ${item.activeCharges} win${item.activeCharges === 1 ? '' : 's'} left`
                      : `${item.name} in bag · activate in shop`}
                  </Text>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="mt-lg">
            <RockButton
              label="Play Now"
              variant="primary"
              icon={<MaterialCommunityIcons name="play" size={20} color={Colors.bgBase} />}
              onPress={() => tryPlay(selectedVenue, duration, insuredNow)}
            />
          </View>
        </RockCard>
      </ScrollView>
    </View>
  );
}
