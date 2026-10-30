import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { Purchase, PurchaseError } from 'react-native-iap';

import { AppIcon, CurrencyIcon, RewardedAdButton, RockButton, RockCard } from '@/components/ui';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import {
  ALL_IAP_ANDROID_PRODUCT_IDS,
  androidProductIdForPack,
  packIdForAndroidProductId,
  REMOVE_ADS_ANDROID_PRODUCT_ID,
  REMOVE_ADS_PACK_ID,
} from '@/constants/iapProducts';
import { useAdStatus } from '@/hooks/useAdStatus';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { useShopIAP } from '@/hooks/useShopIAP';
import { redeemFreeChipsAd, verifyPurchase } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { ECONOMY } from '@/lib/economy.generated';
import { goUp } from '@/lib/navigation';

interface ChipPack {
  id: string;
  amount: string;
  name: string;
  fallbackPrice: string;
  highlighted?: boolean;
  badge?: string;
}

// fallbackPrice shows only until the Play Store's own (correctly localized)
// price loads via useIAP's fetchProducts -- see priceForPack below. Never
// used to actually charge anything; server/src/iapCatalog.ts is the only
// source of truth for what a purchase grants and costs.
// Amounts and USD prices come from economy.config.json (shared with the server's
// iapCatalog.ts); only the names/badges are presentation.
const CHIP_PACK_COPY: Record<string, { name: string; highlighted?: boolean; badge?: string }> = {
  starter: { name: 'Starter Pack' },
  'roadie-box': { name: 'Roadie Box' },
  'bonus-pack': { name: '+ Bonus Pack', highlighted: true, badge: 'HOT' },
  'headliner-chest': { name: 'Headliner Chest' },
};
// Display order: small to large, with the big "hot" pack as a full-width row.
const CHIP_PACK_ORDER = ['starter', 'roadie-box', 'bonus-pack', 'headliner-chest'];

const formatUsd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

const CHIP_PACKS: ChipPack[] = CHIP_PACK_ORDER.map((id) => {
  const pack = ECONOMY.iap.chipPacks.find((p) => p.id === id)!;
  return {
    id,
    amount: pack.amount.toLocaleString('en-US'),
    fallbackPrice: formatUsd(pack.priceUsdCents),
    ...CHIP_PACK_COPY[id],
  };
});

interface GemPack {
  id: string;
  amount: number;
  fallbackPrice: string;
}

const GEM_PACKS: GemPack[] = ECONOMY.iap.gemPacks.map((p) => ({
  id: p.id,
  amount: p.amount,
  fallbackPrice: formatUsd(p.priceUsdCents),
}));

const VIP_PERKS = ['+20% Chip Bonus on every win', 'Exclusive avatar skin', 'Daily Bonus x2', 'Ad-free matchmaking'];

type ShopTab = 'chips' | 'gems' | 'vip';

function notifyVipComingSoon() {
  Alert.alert('Coming Soon', "Backstage Pass isn't live yet -- check back soon!");
}

export default function RockShopScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<ShopTab>('chips');
  const { status: profileStatus, profile, refresh: refreshProfile } = usePlayerProfile();
  const { adStatus, refetch: refetchAdStatus } = useAdStatus();
  const adsRemoved = profile?.adsRemoved === true;
  // Tracks the pack currently being purchased so its button can show a
  // loading state and so a stray purchaseUpdatedListener delivery (e.g. a
  // restored/pending purchase from a previous session) doesn't get treated
  // as "just bought this" for an unrelated pack.
  const [purchasingPackId, setPurchasingPackId] = useState<string | null>(null);

  const { connected, products, fetchProducts, requestPurchase, finishTransaction, getOwnedPurchases } = useShopIAP({
    onPurchaseSuccess: async (purchase: Purchase) => {
      if (purchase.productId === REMOVE_ADS_ANDROID_PRODUCT_ID) {
        await confirmRemoveAds(purchase);
        return;
      }
      const packId = packIdForAndroidProductId(purchase.productId);
      if (!packId || !purchase.purchaseToken) {
        setPurchasingPackId(null);
        return;
      }
      try {
        const token = await getAuthToken();
        if (!token) throw new Error('not-signed-in');
        await verifyPurchase(token, packId, purchase.purchaseToken);
        await refreshProfile();
        // The server already verified + consumed the purchase via the Play
        // Developer API -- this local call just clears react-native-iap's
        // own pending-purchase cache so the same purchase isn't redelivered
        // on next app start.
        await finishTransaction({ purchase, isConsumable: true });
      } catch (error) {
        console.log('Purchase verification failed', error);
        Alert.alert('Purchase Error', "We couldn't confirm this purchase. If you were charged, contact support and it'll be sorted out.");
      } finally {
        setPurchasingPackId(null);
      }
    },
    onPurchaseError: (error: PurchaseError) => {
      setPurchasingPackId(null);
      if (error.code === 'user-cancelled') return;
      Alert.alert('Purchase Failed', error.message || 'Something went wrong. Please try again.');
    },
  });

  useEffect(() => {
    if (connected) void fetchProducts({ skus: [...ALL_IAP_ANDROID_PRODUCT_IDS, REMOVE_ADS_ANDROID_PRODUCT_ID], type: 'in-app' });
  }, [connected, fetchProducts]);

  // Remove Ads is a one-time NON-consumable: the server verifies it and only
  // acknowledges it (never consumes), so finishTransaction is told it is not
  // consumable. Used by both a fresh purchase and "Restore purchase".
  async function confirmRemoveAds(purchase: Purchase) {
    if (!purchase.purchaseToken) {
      setPurchasingPackId(null);
      return;
    }
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('not-signed-in');
      await verifyPurchase(token, REMOVE_ADS_PACK_ID, purchase.purchaseToken);
      await refreshProfile();
      await finishTransaction({ purchase, isConsumable: false });
    } catch (error) {
      console.log('Remove Ads verification failed', error);
      const message = error instanceof Error ? error.message : '';
      Alert.alert(
        'Purchase Error',
        message === 'purchase-belongs-to-another-account'
          ? 'This purchase is already linked to a different account.'
          : "We couldn't confirm this purchase. If you were charged, contact support and it'll be sorted out.",
      );
    } finally {
      setPurchasingPackId(null);
    }
  }

  function handleBuyRemoveAds() {
    if (profileStatus === 'guest') {
      router.push('/sign-in');
      return;
    }
    if (!connected) {
      Alert.alert('Store Unavailable', "Can't reach the Play Store right now. Please try again in a moment.");
      return;
    }
    setPurchasingPackId(REMOVE_ADS_PACK_ID);
    requestPurchase({ request: { google: { skus: [REMOVE_ADS_ANDROID_PRODUCT_ID] } }, type: 'in-app' }).catch((error) => {
      setPurchasingPackId(null);
      console.log('requestPurchase dispatch failed', error);
    });
  }

  async function handleRestoreRemoveAds() {
    if (profileStatus === 'guest') {
      router.push('/sign-in');
      return;
    }
    try {
      const owned = await getOwnedPurchases();
      const existing = owned.find((p) => p.productId === REMOVE_ADS_ANDROID_PRODUCT_ID);
      if (!existing) {
        Alert.alert('Nothing to restore', "We couldn't find a Remove Ads purchase on this Google account.");
        return;
      }
      setPurchasingPackId(REMOVE_ADS_PACK_ID);
      await confirmRemoveAds(existing);
    } catch (error) {
      console.log('Restore purchases failed', error);
      Alert.alert('Restore failed', 'Please try again in a moment.');
    }
  }

  async function handleFreeChipsEarned() {
    const token = await getAuthToken();
    if (!token) throw new Error('not-signed-in');
    await redeemFreeChipsAd(token);
    await refreshProfile();
    void refetchAdStatus();
  }

  function priceForPack(packId: string, fallbackPrice: string): string {
    const androidProductId = packId === REMOVE_ADS_PACK_ID ? REMOVE_ADS_ANDROID_PRODUCT_ID : androidProductIdForPack(packId);
    const product = products.find((p) => p.id === androidProductId);
    return product?.displayPrice ?? fallbackPrice;
  }

  function handlePurchase(packId: string) {
    const androidProductId = androidProductIdForPack(packId);
    if (!androidProductId) return;
    if (!connected) {
      Alert.alert('Store Unavailable', "Can't reach the Play Store right now. Please try again in a moment.");
      return;
    }
    setPurchasingPackId(packId);
    requestPurchase({ request: { google: { skus: [androidProductId] } }, type: 'in-app' }).catch((error) => {
      setPurchasingPackId(null);
      console.log('requestPurchase dispatch failed', error);
    });
  }

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
        {/* Real level (this used to be a hardcoded "2,400 XP"); an empty slot keeps
            the title centred for guests. */}
        <View
          className="flex-row items-center gap-1 rounded-full px-md py-1"
          style={{ backgroundColor: withOpacity(Colors.gold, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.3), opacity: profile ? 1 : 0 }}
        >
          <MaterialCommunityIcons name="star-four-points" size={14} color={Colors.gold} />
          <Text className="font-section-header text-caption text-gold">LVL {profile?.level ?? 1}</Text>
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

            <RemoveAdsCard
              owned={adsRemoved}
              price={priceForPack(REMOVE_ADS_PACK_ID, formatUsd(ECONOMY.iap.removeAds.priceUsdCents))}
              purchasing={purchasingPackId === REMOVE_ADS_PACK_ID}
              onBuy={handleBuyRemoveAds}
              onRestore={handleRestoreRemoveAds}
            />

            <FreeChipsCard
              remaining={adStatus?.placements['free-chips'].remaining ?? null}
              onEarned={handleFreeChipsEarned}
            />

            <Text className="font-display-hero text-headline-lg uppercase text-cyan" style={{ fontSize: 18 }}>
              Chip Stacks
            </Text>
            <View className="flex-row flex-wrap justify-between gap-y-md">
              {CHIP_PACKS.map((pack) => (
                <ChipPackCard
                  key={pack.id}
                  pack={pack}
                  price={priceForPack(pack.id, pack.fallbackPrice)}
                  purchasing={purchasingPackId === pack.id}
                  onPress={() => handlePurchase(pack.id)}
                />
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
                <GemPackCard
                  key={pack.id}
                  pack={pack}
                  price={priceForPack(pack.id, pack.fallbackPrice)}
                  purchasing={purchasingPackId === pack.id}
                  onPress={() => handlePurchase(pack.id)}
                />
              ))}
            </View>
          </>
        ) : null}

        {activeTab === 'vip' ? (
          <>
            <VipBanner compact={false} onUpgrade={notifyVipComingSoon} />
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
            <Text className="font-heading-md text-caption text-cyan">Coming soon</Text>
          </View>
          <RockButton label="Upgrade" variant="reward" onPress={onUpgrade} />
        </View>
      </View>
    </RockCard>
  );
}

const FREE_CHIPS_REWARD = ECONOMY.ads['free-chips'].rewardChips;

function FreeChipsCard({ remaining, onEarned }: { remaining: number | null; onEarned: () => Promise<void> }) {
  return (
    <RockCard glowColor={Colors.chromeDark} innerGlow={Colors.cyan}>
      <View className="gap-md">
        <View className="flex-row items-center gap-md">
          <View
            className="items-center justify-center rounded-md"
            style={{ width: 44, height: 44, backgroundColor: withOpacity(Colors.cyan, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3) }}
          >
            <MaterialCommunityIcons name="movie-open-play" size={22} color={Colors.cyan} />
          </View>
          <View className="flex-1">
            <Text className="font-heading-md text-heading-md uppercase text-text-primary" style={{ fontSize: 14 }}>
              Free Chips
            </Text>
            <Text className="mt-xs font-body-sm text-body-sm text-text-muted">
              Watch a short ad for {FREE_CHIPS_REWARD} chips{remaining !== null ? ` · ${remaining} left today` : ''}
            </Text>
          </View>
        </View>
        <RewardedAdButton label={`Watch ad · +${FREE_CHIPS_REWARD} chips`} variant="primary" remaining={remaining} onEarned={onEarned} />
      </View>
    </RockCard>
  );
}

function RemoveAdsCard({
  owned,
  price,
  purchasing,
  onBuy,
  onRestore,
}: {
  owned: boolean;
  price: string;
  purchasing: boolean;
  onBuy: () => void;
  onRestore: () => void;
}) {
  return (
    <RockCard glowColor={Colors.chromeDark} innerGlow={Colors.gold}>
      <View className="gap-md">
        <View className="flex-row items-center gap-md">
          <View
            className="items-center justify-center rounded-md"
            style={{ width: 44, height: 44, backgroundColor: withOpacity(Colors.gold, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.3) }}
          >
            <MaterialCommunityIcons name={owned ? 'shield-check' : 'advertisements-off'} size={22} color={Colors.gold} />
          </View>
          <View className="flex-1">
            <Text className="font-heading-md text-heading-md uppercase text-text-primary" style={{ fontSize: 14 }}>
              {owned ? 'Ads Removed' : 'Remove Ads'}
            </Text>
            <Text className="mt-xs font-body-sm text-body-sm text-text-muted">
              {owned ? 'Thanks for supporting the band! Optional reward ads still earn you free chips.' : 'One-time purchase. No more ads between games.'}
            </Text>
          </View>
        </View>
        {owned ? null : (
          <>
            <RockButton label={price} loadingLabel="Purchasing…" loading={purchasing} variant="reward" onPress={onBuy} />
            <Pressable onPress={onRestore} disabled={purchasing} className="items-center">
              <Text className="font-body-sm text-caption text-text-muted" style={{ textDecorationLine: 'underline' }}>
                Restore purchase
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </RockCard>
  );
}

function ChipPackCard({
  pack,
  price,
  purchasing,
  onPress,
}: {
  pack: ChipPack;
  price: string;
  purchasing: boolean;
  onPress: () => void;
}) {
  const iconColor = Colors.gold;
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
          <CurrencyIcon type="chips" size={iconSize * 0.5} />
        </View>
        <View className={pack.highlighted ? 'flex-1 gap-1' : 'w-full items-center gap-1'}>
          <Text
            className="font-heading-md text-body-base text-text-primary"
            style={pack.highlighted ? { fontFamily: undefined, fontSize: 22, color: Colors.gold } : { fontSize: 15 }}
          >
            {pack.amount}
          </Text>
          <Text className="mb-1.5 font-body-sm text-caption uppercase text-text-muted">{pack.name}</Text>
          <View className="w-full">
            <RockButton
              label={price}
              loadingLabel="Purchasing…"
              loading={purchasing}
              variant="reward"
              onPress={onPress}
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
function GemPackCard({
  pack,
  price,
  purchasing,
  onPress,
}: {
  pack: GemPack;
  price: string;
  purchasing: boolean;
  onPress: () => void;
}) {
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
        style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.4), opacity: purchasing ? 0.6 : 1 }}
        onPress={onPress}
        disabled={purchasing}
      >
        <Text className="font-heading-md text-caption text-cyan">{purchasing ? '…' : price}</Text>
      </Pressable>
    </RockCard>
  );
}
