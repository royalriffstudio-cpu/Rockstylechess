import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, type ReactNode } from 'react';

import { SubPageHeader } from '@/components/layout';
import { AppIcon, BoardSwatch, ChessBoard, CurrencyPill, PieceSwatch, PlayerAvatar } from '@/components/ui';
import { getPieceSprites } from '@/components/ui/pieceSprites';
import { AVATARS } from '@/constants/avatars';
import { BOARD_THEMES, getBoardTheme } from '@/constants/boardThemes';
import { PIECE_SETS, getPieceSet } from '@/constants/pieceSets';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { updateProfile } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

type InventoryCategory = 'boards' | 'pieces' | 'avatars';

const TABS: { key: InventoryCategory; label: string }[] = [
  { key: 'boards', label: 'Boards' },
  { key: 'pieces', label: 'Pieces' },
  { key: 'avatars', label: 'Avatars' },
];

export default function CollectionsScreen() {
  const insets = useSafeAreaInsets();
  const { profile, gems, refresh: refreshProfile } = usePlayerProfile();
  const [activeTab, setActiveTab] = useState<InventoryCategory>('boards');
  const [isMutating, setIsMutating] = useState(false);

  const ownedCosmeticIds = profile?.ownedCosmeticIds ?? [];
  const ownedBoards = BOARD_THEMES.filter((t) => !t.locked || ownedCosmeticIds.includes(t.id));
  const ownedPieces = PIECE_SETS.filter((s) => !s.locked || ownedCosmeticIds.includes(s.id));
  const ownedAvatars = AVATARS.filter((a) => !a.locked);

  const equippedBoardId = getBoardTheme(profile?.equippedBoardId).id;
  const equippedPieceId = getPieceSet(profile?.equippedPieceId).id;
  const equippedAvatarId = profile?.avatarId;

  async function handleEquip(category: InventoryCategory, id: string) {
    if (isMutating) return;
    const token = await getAuthToken();
    if (!token) return;
    setIsMutating(true);
    try {
      if (category === 'boards') {
        await updateProfile(token, { equippedBoardId: id });
      } else if (category === 'pieces') {
        await updateProfile(token, { equippedPieceId: id });
      } else {
        await updateProfile(token, { avatarId: id });
      }
      await refreshProfile();
    } catch (error) {
      console.log('Failed to equip', category, error);
    } finally {
      setIsMutating(false);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Collections" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView contentContainerClassName="mx-auto w-full max-w-2xl gap-lg px-margin-mobile py-md" contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}>
        <View className="w-full flex-row rounded-lg p-1" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}>
          {TABS.map((tab) => (
            <Pressable
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              className="flex-1 items-center rounded-md py-2"
              style={activeTab === tab.key ? { backgroundColor: Colors.cyan } : undefined}
            >
              <Text className="font-button-label text-button-label uppercase" style={{ color: activeTab === tab.key ? Colors.bgPanel : Colors.textMuted }}>
                {tab.label}
              </Text>
            </Pressable>
          ))}
        </View>

        <View className="overflow-hidden rounded-xl" style={{ minHeight: 220, backgroundColor: withOpacity(Colors.bgPanel, 0.6), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) }}>
          <View className="flex-1 items-center justify-center px-4 py-6">
            {activeTab === 'avatars' ? (
              <PlayerAvatar source={AVATARS.find((a) => a.id === equippedAvatarId)?.image} size="large" selected />
            ) : (
              <View style={{ width: '100%', maxWidth: 220 }}>
                {activeTab === 'boards' ? (
                  <ChessBoard theme={getBoardTheme(equippedBoardId)} />
                ) : (
                  <ChessBoard pieceSprites={getPieceSprites(equippedPieceId)} />
                )}
              </View>
            )}
          </View>
        </View>

        <View className="gap-sm">
          <Text className="font-section-header text-section-header uppercase text-text-muted">
            Your {activeTab} ({activeTab === 'boards' ? ownedBoards.length : activeTab === 'pieces' ? ownedPieces.length : ownedAvatars.length})
          </Text>
          <View className="flex-row flex-wrap gap-3">
            {activeTab === 'boards'
              ? ownedBoards.map((option) => (
                  <InventoryTile
                    key={option.id}
                    name={option.name}
                    equipped={equippedBoardId === option.id}
                    onPress={() => handleEquip('boards', option.id)}
                  >
                    <BoardSwatch light={option.squares.light[3]} dark={option.squares.dark[3]} />
                  </InventoryTile>
                ))
              : null}

            {activeTab === 'pieces'
              ? ownedPieces.map((option) => (
                  <InventoryTile
                    key={option.id}
                    name={option.name}
                    equipped={equippedPieceId === option.id}
                    onPress={() => handleEquip('pieces', option.id)}
                  >
                    <PieceSwatch setId={option.id} />
                  </InventoryTile>
                ))
              : null}

            {activeTab === 'avatars'
              ? ownedAvatars.map((option) => (
                  <InventoryTile
                    key={option.id}
                    name={option.name}
                    equipped={equippedAvatarId === option.id}
                    onPress={() => handleEquip('avatars', option.id)}
                  >
                    <View className="flex-1 items-center justify-center" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5) }}>
                      <PlayerAvatar source={option.image} size="small" />
                    </View>
                  </InventoryTile>
                ))
              : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// Simpler sibling of Forge's ForgeTile -- Collections only ever shows owned
// items, so there's no locked/price state to render, just the
// currently-equipped highlight.
function InventoryTile({
  name,
  equipped,
  onPress,
  children,
}: {
  name: string;
  equipped: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={{ width: '30%', aspectRatio: 1 }} className="overflow-hidden rounded-lg">
      <View style={{ width: '100%', height: '100%', opacity: equipped ? 1 : 0.75 }}>{children}</View>
      <View
        style={{
          position: 'absolute',
          inset: 0,
          borderWidth: equipped ? 2 : 1,
          borderColor: equipped ? Colors.cyan : withOpacity(Colors.chromeDark, 0.5),
          borderRadius: 8,
        }}
      />
      {equipped ? (
        <View className="absolute right-1 top-1 items-center justify-center rounded-full" style={{ width: 18, height: 18, backgroundColor: Colors.cyan }}>
          <AppIcon name="check" size={12} color={Colors.bgPanel} />
        </View>
      ) : null}
      <View
        className="absolute bottom-0 w-full items-center py-1"
        style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.9), borderTopWidth: equipped ? 1 : 0, borderTopColor: withOpacity(Colors.cyan, 0.5) }}
      >
        <Text className="font-caption text-caption" style={{ color: equipped ? Colors.cyan : Colors.textMuted }}>
          {name}
        </Text>
      </View>
    </Pressable>
  );
}
