import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, CurrencyIcon, EmberParticles, ProgressBar, RockButton, RockCard } from '@/components/ui';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import { goUp } from '@/lib/navigation';

interface ChipPack {
  id: string;
  amount: string;
  name: string;
  price: string;
  isClaim?: boolean;
  highlighted?: boolean;
  badge?: string;
  bonusNote?: string;
}

const CHIP_PACKS: ChipPack[] = [
  { id: 'starter', amount: '1,000', name: 'Starter Pack', price: '$1.99' },
  { id: 'roadie-box', amount: '10,000', name: 'Roadie Box', price: '$9.99' },
  {
    id: 'bonus-pack',
    amount: '250,000',
    name: '+ Bonus Pack',
    price: '$49.99',
    highlighted: true,
    badge: 'HOT',
    bonusNote: 'Includes Exclusive "Electric Legend" Piece Skin',
  },
  { id: 'headliner-chest', amount: '50,000', name: 'Headliner Chest', price: '$24.99' },
  { id: 'stadium-vault', amount: 'Stadium Vault', name: 'Unlimited Energy', price: 'Claim', isClaim: true },
];

interface GemPack {
  id: string;
  amount: number;
  price: string;
}

const GEM_PACKS: GemPack[] = [
  { id: 'gem-100', amount: 100, price: '$0.99' },
  { id: 'gem-550', amount: 550, price: '$4.99' },
  { id: 'gem-1200', amount: 1200, price: '$9.99' },
];

const VIP_PERKS = ['+20% Chip Bonus on every win', 'Exclusive avatar skin', 'Daily Bonus x2', 'Ad-free matchmaking'];

type ShopTab = 'chips' | 'gems' | 'vip';

export default function RockShopScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ShopTab>('chips');

  return (
    <View className="flex-1 bg-bg-base">
      <View
        pointerEvents="none"
        className="absolute rounded-full"
        style={{
          top: -80,
          right: -60,
          width: 260,
          height: 260,
          backgroundColor: withOpacity(Colors.cyan, 0.04),
          boxShadow: `0px 0px 90px ${withOpacity(Colors.cyan, 0.14)}`,
        }}
      />
      <View
        pointerEvents="none"
        className="absolute rounded-full"
        style={{
          bottom: 60,
          left: -60,
          width: 220,
          height: 220,
          backgroundColor: withOpacity(Colors.ember, 0.04),
          boxShadow: `0px 0px 80px ${withOpacity(Colors.ember, 0.12)}`,
        }}
      />
      <EmberParticles count={12} />

      <View
        className="flex-row items-center justify-between gap-sm px-lg pb-md"
        style={{ paddingTop: insets.top + Spacing.sm }}
      >
        <Pressable
          onPress={() => goUp('/shop')}
          className="items-center justify-center rounded-full"
          style={{ width: 42, height: 42, backgroundColor: withOpacity(Colors.bgPanel, 0.8), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
        >
          <MaterialCommunityIcons name="chevron-left" size={26} color={Colors.textPrimary} />
        </Pressable>
        <Text className="flex-1 text-center font-display-hero text-headline-lg uppercase text-text-primary" style={{ fontSize: 16 }}>
          Rock Shop
        </Text>
        <View
          className="flex-row items-center gap-1 rounded-full px-md py-1"
          style={{ backgroundColor: withOpacity(Colors.gold, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.3) }}
        >
          <MaterialCommunityIcons name="star-four-points" size={14} color={Colors.gold} />
          <Text className="font-section-header text-caption text-gold">2,400 XP</Text>
        </View>
      </View>

      <View
        className="mx-lg flex-row gap-1 rounded-md p-1"
        style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.7), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
      >
        <ShopTabButton label="Chips" active={activeTab === 'chips'} onPress={() => setActiveTab('chips')} />
        <ShopTabButton label="Gems" active={activeTab === 'gems'} onPress={() => setActiveTab('gems')} />
        <ShopTabButton label="VIP" active={activeTab === 'vip'} onPress={() => setActiveTab('vip')} />
      </View>

      {/* Always visible regardless of which sub-tab is active -- cosmetics
          (boards/pieces/avatars) live in a separate screen (Forge), not a
          currency purchase, so this is a way in rather than a 4th tab here. */}
      <Pressable onPress={() => router.push('/forge')} className="mx-lg mt-md">
        <RockCard glowColor={Colors.chromeDark} innerGlow={Colors.cyan}>
          <View className="flex-row items-center gap-md">
            <View
              className="items-center justify-center rounded-sm"
              style={{ width: 38, height: 38, backgroundColor: withOpacity(Colors.cyan, 0.12) }}
            >
              <MaterialCommunityIcons name="hammer" size={20} color={Colors.cyan} />
            </View>
            <View className="flex-1">
              <Text className="font-heading-md text-heading-md uppercase text-text-primary" style={{ fontSize: 14 }}>
                The Forge
              </Text>
              <Text className="mt-xs font-body-sm text-body-sm text-text-muted">Boards, pieces &amp; avatars</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color={Colors.textMuted} />
          </View>
        </RockCard>
      </Pressable>

      <ScrollView
        contentContainerClassName="gap-lg px-lg pt-lg"
        contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === 'chips' ? (
          <>
            <VipBanner compact onUpgrade={() => setActiveTab('vip')} />

            <Text className="font-display-hero text-headline-lg uppercase text-cyan" style={{ fontSize: 18 }}>
              Chip Stacks
            </Text>
            <View className="flex-row flex-wrap justify-between gap-y-md">
              {CHIP_PACKS.map((pack) => (
                <ChipPackCard key={pack.id} pack={pack} />
              ))}
            </View>
          </>
        ) : null}

        {activeTab === 'gems' ? (
          <>
            <Text className="font-display-hero text-headline-lg uppercase text-cyan" style={{ fontSize: 18 }}>
              Crystal Gems
            </Text>
            <View className="flex-row flex-wrap justify-between gap-y-md">
              {GEM_PACKS.map((pack) => (
                <GemPackCard key={pack.id} pack={pack} />
              ))}
            </View>
          </>
        ) : null}

        {activeTab === 'vip' ? (
          <>
            <VipBanner compact={false} onUpgrade={() => console.log('Upgrade to Backstage Pass pressed')} />
            <View className="gap-sm">
              {VIP_PERKS.map((perk) => (
                <View key={perk} className="flex-row items-center gap-sm">
                  <MaterialCommunityIcons name="check-circle" size={18} color={Colors.gold} />
                  <Text className="font-body-base text-body-base text-text-primary">{perk}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

function ShopTabButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 items-center rounded-sm py-3"
      style={active ? { backgroundColor: withOpacity(Colors.cyan, 0.1) } : undefined}
    >
      <Text
        className="font-section-header text-caption uppercase tracking-wide"
        style={{ color: active ? Colors.cyan : Colors.textMuted }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function VipBanner({ compact, onUpgrade }: { compact: boolean; onUpgrade: () => void }) {
  return (
    <RockCard glowColor={Colors.chromeDark} innerGlow={Colors.gold} style={{ minHeight: compact ? 150 : 200, overflow: 'hidden' }}>
      <View
        pointerEvents="none"
        className="absolute items-center justify-center"
        style={{ right: -20, top: -20, opacity: 0.1 }}
      >
        <AppIcon name="workspace_premium" size={140} color={Colors.gold} />
      </View>
      <View className="gap-sm">
        <View className="flex-row items-end justify-between gap-sm">
          <View>
            <Text className="font-display-hero text-headline-lg uppercase text-gold" style={{ fontSize: 20, fontStyle: 'italic' }}>
              Backstage Pass
            </Text>
            <Text className="font-heading-md text-caption text-cyan">Season 4: Molten Riff</Text>
          </View>
          <RockButton label="Upgrade" variant="reward" onPress={onUpgrade} />
        </View>
        <ProgressBar progress={0.65} label="Level 42 / 60" />
      </View>
    </RockCard>
  );
}

function ChipPackCard({ pack }: { pack: ChipPack }) {
  const iconColor = pack.isClaim ? Colors.cyan : Colors.gold;
  const iconSize = pack.highlighted ? 88 : 56;

  return (
    <RockCard
      glowColor={pack.highlighted ? Colors.chromeDark : undefined}
      innerGlow={pack.highlighted ? Colors.gold : undefined}
      style={{ width: pack.highlighted ? '100%' : '48%', position: 'relative' }}
    >
      {pack.badge ? (
        <View
          className="absolute"
          style={{
            top: 10,
            right: -28,
            backgroundColor: Colors.crimson,
            paddingHorizontal: 36,
            paddingVertical: 4,
            transform: [{ rotate: '45deg' }],
            zIndex: 1,
          }}
        >
          <Text className="text-center font-heading-md text-caption text-text-primary">{pack.badge}</Text>
        </View>
      ) : null}
      <View className={pack.highlighted ? 'flex-row items-center gap-md' : 'items-center gap-1'}>
        <View
          className="items-center justify-center rounded-md"
          style={{
            width: iconSize,
            height: iconSize,
            backgroundColor: withOpacity(iconColor, 0.12),
            borderWidth: 1,
            borderColor: withOpacity(iconColor, 0.3),
          }}
        >
          {pack.isClaim ? (
            <AppIcon name="bolt" size={iconSize * 0.5} color={iconColor} />
          ) : (
            <CurrencyIcon type="chips" size={iconSize * 0.5} />
          )}
        </View>
        <View className={pack.highlighted ? 'flex-1 gap-1' : 'w-full items-center gap-1'}>
          <Text
            className="font-heading-md text-body-base text-text-primary"
            style={pack.highlighted ? { fontFamily: undefined, fontSize: 22, color: Colors.gold } : { fontSize: 15 }}
          >
            {pack.amount}
          </Text>
          <Text className="mb-1.5 font-body-sm text-caption uppercase text-text-muted">{pack.name}</Text>
          {pack.bonusNote ? (
            <Text className="mb-1.5 font-body-sm text-caption italic text-text-muted">{pack.bonusNote}</Text>
          ) : null}
          <View className="w-full">
            <RockButton
              label={pack.price}
              variant={pack.isClaim ? 'primary' : 'reward'}
              onPress={() => console.log('Purchase pressed', pack.id, pack.price)}
            />
          </View>
        </View>
      </View>
    </RockCard>
  );
}

// Standard RockButton's fixed padding doesn't fit a 3-col gem grid's narrow
// cards, so gem packs use a smaller dedicated price chip instead -- same
// depth language, just sized for the space, consistent with how Match's
// action bar already deviated from RockButton for a shape it wasn't built for.
function GemPackCard({ pack }: { pack: GemPack }) {
  return (
    <RockCard style={{ width: '31%', alignItems: 'center' }}>
      <View
        className="items-center justify-center rounded-md"
        style={{ width: 44, height: 44, backgroundColor: withOpacity(Colors.cyan, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3) }}
      >
        <CurrencyIcon type="gems" size={24} />
      </View>
      <Text className="mb-sm mt-1 font-heading-md text-caption text-text-primary" style={{ fontSize: 13 }}>
        {pack.amount}
      </Text>
      <Pressable
        className="w-full items-center rounded-sm py-2"
        style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.4) }}
        onPress={() => console.log('Purchase gems pressed', pack.id, pack.price)}
      >
        <Text className="font-heading-md text-caption text-cyan">{pack.price}</Text>
      </Pressable>
    </RockCard>
  );
}
