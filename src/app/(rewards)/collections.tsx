import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons'
import { Image, type ImageSource } from 'expo-image'
import { LinearGradient } from 'expo-linear-gradient'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SubPageHeader } from '@/components/layout'
import { AppIcon, CurrencyPill, ProgressBar, RockCard } from '@/components/ui'
import { ScreenArt } from '@/constants/screenArt'
import { Colors, withOpacity } from '@/constants/theme'
import { usePlayerProfile } from '@/hooks/usePlayerProfile'

interface CollectibleCard {
  id: string
  name: string
  rarity: string
  isNew?: boolean
  locked?: boolean
  /** Collectible portrait art; falls back to a generic icon when absent. */
  image?: ImageSource | number
}

interface CardSet {
  id: string
  name: string
  tagline: string
  accent: string
  owned: number
  total: number
  cards: CollectibleCard[]
}

const CARD_SETS: CardSet[] = [
  {
    id: 'metal-legends',
    name: 'Metal Legends',
    tagline: 'The heaviest pieces in the game',
    accent: Colors.crimson,
    owned: 12,
    total: 30,
    cards: [
      { id: 'thrasher-max', name: 'Thrasher Max', rarity: 'Legendary Pawn', isNew: true, image: ScreenArt.collectibleThrasherMax },
      { id: 'valkyrie-riff', name: 'Valkyrie Riff', rarity: 'Elite Queen', image: ScreenArt.collectibleValkyrieRiff },
      { id: 'locked-1', name: '', rarity: '', locked: true },
      { id: 'iron-steed', name: 'Iron Steed', rarity: 'Rare Knight', image: ScreenArt.collectibleIronSteed },
      { id: 'the-blast-beat', name: 'The Blast Beat', rarity: 'Elite Rook' },
    ],
  },
  {
    id: 'punk-rockers',
    name: 'Punk Rockers',
    tagline: 'Fast, loud, and unstoppable',
    accent: Colors.emberLight,
    owned: 8,
    total: 15,
    cards: [
      { id: 'spike-junior', name: 'Spike Junior', rarity: 'Common Pawn', image: ScreenArt.collectibleSpikeJunior },
      { id: 'anarchy-bish', name: 'Anarchy Bish', rarity: 'Rare Bishop', isNew: true },
      { id: 'old-school-roy', name: 'Old School Roy', rarity: 'Elite King' },
      { id: 'locked-2', name: '', rarity: '', locked: true },
    ],
  },
]

export default function CollectionsScreen() {
  const insets = useSafeAreaInsets()
  const { gems } = usePlayerProfile()

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Collections" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView contentContainerClassName="gap-xl px-lg py-xl" contentContainerStyle={{ paddingBottom: 60 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <RockCard glowColor={Colors.cyan}>
          <View className="gap-md">
            <View className="flex-row items-end justify-between">
              <View>
                <Text className="font-display-hero text-display-hero uppercase text-cyan" style={{ fontSize: 18 }}>
                  Tour Collection
                </Text>
                <Text className="mt-xs font-section-header text-section-header uppercase text-text-muted">Total Completion</Text>
              </View>
              <Text className="font-display-hero text-display-hero text-text-primary" style={{ fontSize: 32 }}>
                42<Text style={{ fontSize: 18, color: Colors.textMuted }}>/120</Text>
              </Text>
            </View>
            <ProgressBar progress={42 / 120} />
            <View className="flex-row justify-between">
              <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ fontSize: 10 }}>
                Level 8 Vibe
              </Text>
              <Text className="font-section-header text-section-header uppercase text-text-muted" style={{ fontSize: 10 }}>
                Next: Legendary Pack
              </Text>
            </View>
          </View>
        </RockCard>

        {CARD_SETS.map((set) => (
          <View key={set.id} className="gap-md">
            <View className="flex-row items-center justify-between pl-md" style={{ borderLeftWidth: 4, borderLeftColor: set.accent }}>
              <View>
                <Text className="font-display-hero text-display-hero uppercase text-text-primary" style={{ fontSize: 18 }}>
                  {set.name}
                </Text>
                <Text className="mt-xs font-body-sm" style={{ fontSize: 10, color: Colors.textMuted, letterSpacing: 0.5 }}>
                  {set.tagline.toUpperCase()}
                </Text>
              </View>
              <Text className="font-section-header" style={{ fontSize: 15, color: set.accent }}>
                {set.owned}/{set.total}
              </Text>
            </View>

            <View className="flex-row flex-wrap gap-y-md" style={{ justifyContent: 'space-between' }}>
              {set.cards.map((card) =>
                card.locked ? (
                  <View key={card.id} style={{ width: '48%', aspectRatio: 3 / 4 }}>
                    <View
                      className="flex-1 items-center justify-center gap-xs rounded-lg"
                      style={{ backgroundColor: withOpacity(Colors.bgBase, 0.6), borderWidth: 1, borderColor: withOpacity(Colors.chrome, 0.06) }}
                    >
                      <AppIcon name="lock" size={32} color={Colors.chromeMid} />
                      <Text className="font-section-header uppercase" style={{ fontSize: 11, color: Colors.chromeMid, letterSpacing: 1 }}>
                        Locked
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Pressable key={card.id} style={{ width: '48%', aspectRatio: 3 / 4 }} onPress={() => console.log('Collectible viewed', card.name)}>
                    <View className="flex-1 overflow-hidden rounded-lg" style={{ borderWidth: 1, borderColor: withOpacity(Colors.chrome, 0.12), backgroundColor: Colors.bgPanel }}>
                      {card.image ? (
                        <Image source={card.image} contentFit="cover" cachePolicy="memory-disk" transition={300} style={{ position: 'absolute', inset: 0 }} />
                      ) : null}
                      <LinearGradient
                        colors={
                          card.image
                            ? [withOpacity(Colors.bgBase, 0), withOpacity(Colors.bgBase, 0.15), Colors.bgPanel]
                            : [withOpacity(set.accent, 0.35), Colors.bgPanel]
                        }
                        start={{ x: 0, y: 0 }}
                        end={card.image ? { x: 0, y: 1 } : { x: 1, y: 1 }}
                        style={{ position: 'absolute', inset: 0 }}
                      />
                      {card.image ? null : (
                        <View className="flex-1 items-center justify-center">
                          <MaterialCommunityIcons name="guitar-electric" size={40} color={withOpacity(Colors.textPrimary, 0.5)} />
                        </View>
                      )}
                      {card.isNew ? (
                        <View className="absolute right-sm top-sm rounded-full px-sm py-xs" style={{ backgroundColor: Colors.cyan }}>
                          <Text className="font-body-sm uppercase" style={{ fontSize: 9, color: Colors.bgBase }}>
                            New
                          </Text>
                        </View>
                      ) : null}
                      <View className="absolute bottom-0 left-0 right-0 p-sm">
                        <Text className="font-body-sm uppercase" style={{ fontSize: 9, color: withOpacity(Colors.textPrimary, 0.7), letterSpacing: 0.5 }}>
                          {card.rarity}
                        </Text>
                        <Text className="font-section-header" style={{ fontSize: 13, color: Colors.textPrimary }}>
                          {card.name}
                        </Text>
                      </View>
                    </View>
                  </Pressable>
                ),
              )}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  )
}
