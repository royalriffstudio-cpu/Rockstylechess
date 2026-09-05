import { Image } from 'expo-image';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useEffect, useState, type ReactNode } from 'react';

import { AppIcon, ChessBoard, CurrencyIcon, PlayerAvatar, RockButton } from '@/components/ui';
import { getPieceSprites } from '@/components/ui/pieceSprites';
import { SubPageHeader } from '@/components/layout';
import { AVATARS } from '@/constants/avatars';
import { BOARD_THEMES, getBoardTheme, type BoardTheme } from '@/constants/boardThemes';
import { PIECE_SETS, type PieceSet } from '@/constants/pieceSets';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { unlockCosmetic, updateProfile } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

type ForgeCategory = 'boards' | 'pieces' | 'avatars';

interface ForgeOption {
  id: string;
  name: string;
  locked: boolean;
  gemPrice?: number;
}

const TABS: { key: ForgeCategory; label: string }[] = [
  { key: 'boards', label: 'Boards' },
  { key: 'pieces', label: 'Pieces' },
  { key: 'avatars', label: 'Avatars' },
];

export default function ForgeScreen() {
  const insets = useSafeAreaInsets();
  const { profile, gems, chips, refresh: refreshProfile } = usePlayerProfile();
  const [activeTab, setActiveTab] = useState<ForgeCategory>('boards');
  // Locked board/piece the player tapped to buy -- drives the unlock modal.
  const [unlockTarget, setUnlockTarget] = useState<{
    category: 'boards' | 'pieces';
    option: BoardTheme | PieceSet;
  } | null>(null);
  const [selected, setSelected] = useState<Record<ForgeCategory, string>>({
    boards: 'classic-chrome',
    pieces: 'classic-pieces',
    avatars: 'axl',
  });
  // Shared by equip and purchase: both are single in-flight profile
  // mutations from this screen, and a purchase's confirm dialog closes
  // before its async call resolves -- this guards that window too.
  const [isMutating, setIsMutating] = useState(false);

  // Reflect whatever's actually equipped server-side once the profile loads,
  // rather than always defaulting the picker to Classic Chrome.
  useEffect(() => {
    if (profile?.equippedBoardId) {
      setSelected((prev) => ({ ...prev, boards: profile.equippedBoardId as string }));
    }
  }, [profile?.equippedBoardId]);

  useEffect(() => {
    if (profile?.equippedPieceId) {
      setSelected((prev) => ({ ...prev, pieces: profile.equippedPieceId as string }));
    }
  }, [profile?.equippedPieceId]);

  useEffect(() => {
    if (profile?.avatarId) {
      setSelected((prev) => ({ ...prev, avatars: profile.avatarId as string }));
    }
  }, [profile?.avatarId]);

  function isBoardOwned(id: string): boolean {
    const theme = BOARD_THEMES.find((t) => t.id === id);
    return !theme?.locked || (profile?.ownedCosmeticIds?.includes(id) ?? false);
  }

  function isPieceOwned(id: string): boolean {
    const set = PIECE_SETS.find((s) => s.id === id);
    return !set?.locked || (profile?.ownedCosmeticIds?.includes(id) ?? false);
  }

  function handleSelect(category: ForgeCategory, option: ForgeOption) {
    if (category === 'boards' && option.locked) {
      if (isBoardOwned(option.id)) {
        setSelected((prev) => ({ ...prev, boards: option.id }));
        return;
      }
      handleLockedTap('boards', option as BoardTheme);
      return;
    }
    if (category === 'pieces' && option.locked) {
      if (isPieceOwned(option.id)) {
        setSelected((prev) => ({ ...prev, pieces: option.id }));
        return;
      }
      handleLockedTap('pieces', option as PieceSet);
      return;
    }
    if (option.locked) {
      console.log('Forge option locked', option.name, `${option.gemPrice} gems required`);
      return;
    }
    setSelected((prev) => ({ ...prev, [category]: option.id }));
    console.log('Forge option selected', category, option.name);
  }

  function handleLockedTap(category: 'boards' | 'pieces', option: BoardTheme | PieceSet) {
    if (isMutating) return;
    setUnlockTarget({ category, option });
  }

  async function confirmPurchase(category: 'boards' | 'pieces', option: BoardTheme | PieceSet, currency: 'gems' | 'chips') {
    const token = await getAuthToken();
    if (!token) return;
    setIsMutating(true);
    try {
      await unlockCosmetic(token, option.id, currency);
      await refreshProfile();
      // Auto-select (not auto-equip) the newly-owned item -- equip stays a
      // separate, deliberate action via the Equip button below.
      setSelected((prev) => ({ ...prev, [category]: option.id }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (message === 'insufficient-funds') {
        const price = currency === 'gems' ? option.gemPrice : option.chipPrice;
        Alert.alert('Not Enough Funds', `You need ${(price ?? 0).toLocaleString()} ${currency} to unlock ${option.name}.`);
      } else if (message === 'already-owned') {
        setSelected((prev) => ({ ...prev, [category]: option.id }));
      } else {
        console.log('Failed to unlock cosmetic', error);
        Alert.alert('Something Went Wrong', 'Could not unlock this item. Please try again.');
      }
    } finally {
      setIsMutating(false);
    }
  }

  async function handleEquip() {
    const token = await getAuthToken();
    if (!token) return;
    setIsMutating(true);
    try {
      if (activeTab === 'boards') {
        await updateProfile(token, { equippedBoardId: selected.boards });
      } else if (activeTab === 'pieces') {
        await updateProfile(token, { equippedPieceId: selected.pieces });
      } else {
        await updateProfile(token, { avatarId: selected.avatars });
      }
      await refreshProfile();
    } catch (error) {
      console.log('Failed to equip', activeTab, error);
    } finally {
      setIsMutating(false);
    }
  }

  const selectedName =
    activeTab === 'boards'
      ? BOARD_THEMES.find((o) => o.id === selected.boards)?.name
      : activeTab === 'pieces'
        ? PIECE_SETS.find((o) => o.id === selected.pieces)?.name
        : AVATARS.find((o) => o.id === selected.avatars)?.name;

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader
        title="The Forge"
        trailing={
          <View
            className="flex-row items-center gap-2 rounded-full px-3 py-1"
            style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.85), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) }}
          >
            <View className="flex-row items-center gap-1">
              <CurrencyIcon type="chips" size={13} />
              <Text className="font-heading-md text-text-primary" style={{ fontSize: 12 }}>
                {chips.toLocaleString('en-US')}
              </Text>
            </View>
            <View style={{ width: 1, height: 12, backgroundColor: withOpacity(Colors.chromeDark, 0.5) }} />
            <View className="flex-row items-center gap-1">
              <CurrencyIcon type="gems" size={13} />
              <Text className="font-heading-md text-text-primary" style={{ fontSize: 12 }}>
                {gems.toLocaleString('en-US')}
              </Text>
            </View>
          </View>
        }
      />

      <ScrollView contentContainerClassName="mx-auto w-full max-w-2xl gap-lg px-margin-mobile py-md" contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}>
        <View className="w-full flex-row rounded-lg p-1" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}>
          {TABS.map((tab) => (
            <Pressable key={tab.key} onPress={() => setActiveTab(tab.key)} className="flex-1 items-center rounded-md py-2" style={activeTab === tab.key ? { backgroundColor: Colors.cyan } : undefined}>
              <Text className="font-button-label text-button-label uppercase" style={{ color: activeTab === tab.key ? Colors.bgPanel : Colors.textMuted }}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="overflow-hidden rounded-xl" style={{ minHeight: 300, backgroundColor: withOpacity(Colors.bgPanel, 0.6), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) }}>
          <View className="absolute top-0 z-10 w-full flex-row items-center justify-between p-sm" style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.5), borderBottomWidth: 1, borderBottomColor: withOpacity(Colors.chromeDark, 0.3) }}>
            <Text className="font-heading-md text-heading-md tracking-wide text-cyan">{(selectedName ?? '').toUpperCase()}</Text>
            <View className="rounded px-2 py-1" style={{ backgroundColor: withOpacity(Colors.cyan, 0.2) }}>
              <Text className="font-button-label text-caption text-cyan">EQUIPPED</Text>
            </View>
          </View>
          <View className="flex-1 items-center justify-center px-4 pb-4 pt-12">
            {activeTab === 'avatars' ? (
              <PlayerAvatar source={AVATARS.find((a) => a.id === selected.avatars)?.image} size="large" selected />
            ) : (
              <View style={{ width: '100%', maxWidth: 260 }}>
                {activeTab === 'boards' ? <ChessBoard theme={getBoardTheme(selected.boards)} /> : <ChessBoard pieceSprites={getPieceSprites(selected.pieces)} />}
              </View>
            )}
          </View>
        </View>

        <View className="gap-sm">
          <Text className="font-section-header text-section-header uppercase text-text-muted">Available {activeTab}</Text>
          <View className="flex-row flex-wrap gap-3">
            {activeTab === 'boards'
              ? BOARD_THEMES.map((option) => {
                  const showLocked = option.locked && !isBoardOwned(option.id);
                  const isSelected = selected.boards === option.id;
                  return (
                    <ForgeTile key={option.id} name={option.name} selected={isSelected} locked={showLocked} gemPrice={option.gemPrice} chipPrice={option.chipPrice} onPress={() => handleSelect('boards', option)}>
                      <BoardSwatch light={option.squares.light[3]} dark={option.squares.dark[3]} />
                    </ForgeTile>
                  );
                })
              : null}

            {activeTab === 'pieces'
              ? PIECE_SETS.map((option) => {
                  const showLocked = option.locked && !isPieceOwned(option.id);
                  const isSelected = selected.pieces === option.id;
                  return (
                    <ForgeTile key={option.id} name={option.name} selected={isSelected} locked={showLocked} gemPrice={option.gemPrice} chipPrice={option.chipPrice} onPress={() => handleSelect('pieces', option)}>
                      <PieceSwatch setId={option.id} />
                    </ForgeTile>
                  );
                })
              : null}

            {activeTab === 'avatars'
              ? AVATARS.map((option) => (
                  <ForgeTile key={option.id} name={option.name} selected={selected.avatars === option.id} locked={option.locked} gemPrice={option.gemPrice} onPress={() => handleSelect('avatars', option)}>
                    <View className="flex-1 items-center justify-center" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5) }}>
                      <PlayerAvatar
                        source={option.locked ? undefined : option.image}
                        emoji={option.locked ? '🔒' : undefined}
                        size="small"
                      />
                    </View>
                  </ForgeTile>
                ))
              : null}
          </View>
        </View>
      </ScrollView>

      <View
        className="absolute bottom-0 left-0 w-full items-center p-margin-mobile"
        style={{ paddingBottom: insets.bottom + 16 }}
      >
        <RockButton
          label={isMutating ? 'Equipping...' : `Equip ${selectedName ?? ''}`}
          icon={<AppIcon name="bolt" size={20} color={Colors.bgBase} />}
          variant="cyan"
          disabled={isMutating}
          onPress={handleEquip}
          style={{ width: '100%', maxWidth: 380 }}
        />
      </View>

      <UnlockModal
        target={unlockTarget}
        gems={gems}
        chips={chips}
        onCancel={() => setUnlockTarget(null)}
        onPay={(currency) => {
          if (!unlockTarget) return;
          const target = unlockTarget;
          setUnlockTarget(null);
          void confirmPurchase(target.category, target.option, currency);
        }}
      />
    </View>
  );
}

// Mirrors ConfirmModal's card recipe (dimmed backdrop, centered panel, cyan
// accent, spring-in), but with two "pay" buttons instead of one Confirm --
// forge cosmetics can be bought with either gems or chips.
function UnlockModal({
  target,
  gems,
  chips,
  onCancel,
  onPay,
}: {
  target: { category: 'boards' | 'pieces'; option: BoardTheme | PieceSet } | null;
  gems: number;
  chips: number;
  onCancel: () => void;
  onPay: (currency: 'gems' | 'chips') => void;
}) {
  const visible = target !== null;
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: 180, easing: Easing.out(Easing.quad) });
  }, [visible, progress]);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.92 + progress.value * 0.08 }],
  }));

  const gemPrice = target?.option.gemPrice ?? 0;
  const chipPrice = target?.option.chipPrice ?? 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable
        onPress={onCancel}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: withOpacity(Colors.bgBase, 0.8) }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 340 }}>
          <Animated.View style={cardStyle}>
            <View
              style={{
                alignItems: 'center',
                borderRadius: 20,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: withOpacity(Colors.cyan, 0.3),
                backgroundColor: Colors.bgPanel,
                padding: 16,
                boxShadow: `0px 10px 25px ${withOpacity(Colors.cyan, 0.3)}`,
              }}
            >
              <View
                style={{
                  marginBottom: 12,
                  height: 56,
                  width: 56,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 28,
                  backgroundColor: withOpacity(Colors.cyan, 0.1),
                  borderWidth: 1,
                  borderColor: withOpacity(Colors.cyan, 0.3),
                }}
              >
                <AppIcon name="lock" size={26} color={Colors.cyan} />
              </View>
              <Text style={{ marginBottom: 4, textAlign: 'center', fontSize: 18, fontWeight: '600', color: Colors.textPrimary }}>
                Unlock {target?.option.name ?? ''}?
              </Text>
              <Text style={{ marginBottom: 16, textAlign: 'center', fontSize: 14, color: Colors.textMuted }}>
                Add this {target?.category === 'boards' ? 'board' : 'piece set'} to your collection.
              </Text>
              <View style={{ width: '100%', gap: 8 }}>
                <RockButton
                  label={`${gemPrice.toLocaleString()} Gems`}
                  variant="cyan"
                  icon={<CurrencyIcon type="gems" size={16} color={Colors.bgBase} />}
                  disabled={gems < gemPrice}
                  onPress={() => onPay('gems')}
                />
                <RockButton
                  label={`${chipPrice.toLocaleString()} Chips`}
                  variant="gold"
                  icon={<CurrencyIcon type="chips" size={16} color={Colors.bgBase} />}
                  disabled={chips < chipPrice}
                  onPress={() => onPay('chips')}
                />
                <RockButton label="Cancel" variant="secondary" onPress={onCancel} />
              </View>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ForgeTile({
  name,
  selected,
  locked,
  gemPrice,
  chipPrice,
  onPress,
  children,
}: {
  name: string;
  selected: boolean;
  locked: boolean;
  gemPrice?: number;
  chipPrice?: number;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={{ width: '30%', aspectRatio: 1 }} className="overflow-hidden rounded-lg">
      <View style={{ width: '100%', height: '100%', opacity: locked ? undefined : selected ? 1 : 0.6 }}>{children}</View>
      <View style={{ position: 'absolute', inset: 0, borderWidth: selected ? 2 : 1, borderColor: selected ? Colors.cyan : withOpacity(Colors.chromeDark, 0.5), borderRadius: 8 }} />
      {locked ? (
        <View className="absolute inset-0 items-center justify-center" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.6) }}>
          <AppIcon name="lock" size={22} color={Colors.textMuted} />
          <View
            className="mt-1 items-center gap-0.5 rounded-md px-1.5 py-1"
            style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.85), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.8) }}
          >
            {gemPrice ? (
              <View className="flex-row items-center gap-0.5">
                <CurrencyIcon type="gems" size={10} />
                <Text className="font-caption text-text-primary" style={{ fontSize: 9 }}>{gemPrice.toLocaleString()}</Text>
              </View>
            ) : null}
            {chipPrice ? (
              <View className="flex-row items-center gap-0.5">
                <CurrencyIcon type="chips" size={10} />
                <Text className="font-caption text-text-primary" style={{ fontSize: 9 }}>{chipPrice.toLocaleString()}</Text>
              </View>
            ) : null}
          </View>
        </View>
      ) : null}
      <View className="absolute bottom-0 w-full items-center py-1" style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.9), borderTopWidth: selected ? 1 : 0, borderTopColor: withOpacity(Colors.cyan, 0.5) }}>
        <Text className="font-caption text-caption" style={{ color: locked ? Colors.chromeDark : selected ? Colors.cyan : Colors.textMuted }}>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}

function BoardSwatch({ light, dark }: { light: string; dark: string }) {
  return (
    <View className="flex-1 flex-row flex-wrap">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} style={{ width: '50%', height: '50%', backgroundColor: (Math.floor(i / 2) + i) % 2 === 0 ? light : dark }} />
      ))}
    </View>
  );
}

function PieceSwatch({ setId }: { setId: string }) {
  const sprite = getPieceSprites(setId).wk;
  return <View className="flex-1 items-center justify-center" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5) }}>{sprite ? <Image source={sprite} contentFit="contain" style={{ width: '70%', height: '70%' }} /> : null}</View>;
}
