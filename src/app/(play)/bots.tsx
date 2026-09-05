import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, BottomNav, CurrencyIcon, CurrencyPill, PlayerAvatar, RockCard } from '@/components/ui';
import { BoardAssetPrewarm } from '@/components/ui/BoardAssetPrewarm';
import { MatchOptionsModal } from '@/components/ui/MatchOptionsModal';
import { SubPageHeader } from '@/components/layout';
import { Colors, withOpacity } from '@/constants/theme';
import { getVenue } from '@/constants/venues';
import type { BotDifficulty } from '@/hooks/useChessGame';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import type { Duration } from '@/lib/onlineMatch';

interface Bot {
  id: string;
  name: string;
  emoji: string;
  stars: number;
  tier: string;
  locked: boolean;
  gemPrice?: number;
  /** A real difficulty ladder, independent of the cosmetic `stars` rating above. */
  difficulty: BotDifficulty;
}

// Bots render as an emoji glyph via PlayerAvatar's `emoji` prop -- they're
// distinct roster characters, not entries in the selectable player-avatar
// badge set (src/constants/avatars.ts), and `emoji` also rides along as the
// `botEmoji` route param into /match.
const BOTS: Bot[] = [
  { id: 'roadie-rick', name: 'Roadie Rick', emoji: '🧢', stars: 1, tier: 'Novice', locked: false, difficulty: 'easy' },
  { id: 'valkyrie-riff', name: 'Valkyrie Riff', emoji: '⚡', stars: 2, tier: 'Amateur', locked: false, difficulty: 'medium' },
  { id: 'metal-head', name: 'Metal Head', emoji: '🤘', stars: 3, tier: 'Skilled', locked: false, difficulty: 'stockfish-basic' },
  { id: 'the-reaper', name: 'The Reaper', emoji: '💀', stars: 4, tier: 'Expert', locked: false, difficulty: 'stockfish-lite' },
  { id: 'old-school-roy', name: 'Old School Roy', emoji: '🕶️', stars: 2, tier: 'Amateur', locked: false, difficulty: 'medium' },
  { id: 'king-axl', name: 'King Axl', emoji: '👑', stars: 5, tier: 'Grandmaster', locked: false, difficulty: 'stockfish-strong' },
];

// Real engine-strength order (matches botEngine.ts's BotDifficulty union).
const DIFFICULTY_RANK: Record<BotDifficulty, number> = {
  easy: 0,
  medium: 1,
  'stockfish-basic': 2,
  'stockfish-lite': 3,
  'stockfish-strong': 4,
};

// Easiest first, then by star rating, so the ladder reads top-to-bottom.
const SORTED_BOTS = [...BOTS].sort(
  (a, b) => DIFFICULTY_RANK[a.difficulty] - DIFFICULTY_RANK[b.difficulty] || a.stars - b.stars,
);

export default function BotsGalleryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gems, profile } = usePlayerProfile();
  const [color, setColor] = useState<'w' | 'b'>('w');
  const [duration, setDuration] = useState<Duration>('5m');
  const [venueId, setVenueId] = useState('arena');
  const [optionsOpen, setOptionsOpen] = useState(false);

  function handleBotPress(bot: Bot) {
    if (bot.locked) {
      console.log('Bot locked', bot.name, `${bot.gemPrice} gems required`);
      return;
    }
    console.log('Bot challenged', bot.name);
    router.push({
      pathname: '/match',
      params: {
        mode: 'bot',
        difficulty: bot.difficulty,
        botName: bot.name,
        botEmoji: bot.emoji,
        color,
        duration,
        venueTier: venueId,
      },
    });
  }

  return (
    <View className="flex-1 bg-bg-base">
      <BoardAssetPrewarm pieceId={profile?.equippedPieceId} />
      <SubPageHeader title="Challenge the Legends" trailing={<CurrencyPill type="gems" value={gems} />} />
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-4xl gap-md px-margin-mobile pt-md"
        contentContainerStyle={{ paddingBottom: 110 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View>
          <Text className="font-headline-lg uppercase text-text-primary" style={{ fontSize: 22, letterSpacing: 1 }}>
            Pick Your Opponent
          </Text>
          <Text className="mt-1.5 font-body-sm text-text-muted" style={{ fontSize: 12 }}>
            Challenge bots of varying difficulties to earn XP.
          </Text>
        </View>

        <Pressable onPress={() => setOptionsOpen(true)}>
          <RockCard variant="surface" contentPadding={12}>
            <View className="flex-row items-center gap-md">
              <View
                className="h-9 w-9 items-center justify-center rounded-md"
                style={{ backgroundColor: withOpacity(Colors.cyan, 0.12), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3) }}
              >
                <MaterialCommunityIcons name="tune-variant" size={16} color={Colors.cyan} />
              </View>
              <View className="flex-1">
                <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 12, letterSpacing: 0.5 }}>
                  Match Options
                </Text>
                <Text className="mt-0.5 font-body-sm text-text-muted" style={{ fontSize: 11 }} numberOfLines={1}>
                  {color === 'w' ? 'White' : 'Black'} · {duration} · {getVenue(venueId).name}
                </Text>
              </View>
              <MaterialCommunityIcons name="chevron-right" size={18} color={Colors.textMuted} />
            </View>
          </RockCard>
        </Pressable>

        {SORTED_BOTS.map((bot) => (
          <RockCard
            key={bot.id}
            variant="surface"
            contentPadding={16}
            style={bot.locked ? { opacity: 0.6 } : undefined}
          >
            <View className="flex-row items-center justify-between gap-md">
              <View className="flex-1 flex-row items-center gap-md">
                <View>
                  <PlayerAvatar emoji={bot.locked ? '🔒' : bot.emoji} size="small" />
                  <View className="absolute -bottom-1 -right-1 rounded-full p-0.5" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: Colors.chromeDark }}>
                    <AppIcon name="smart_toy" size={10} color={Colors.textMuted} />
                  </View>
                </View>
                <View className="flex-1 gap-1">
                  <Text className="font-heading-md" numberOfLines={1} style={{ fontSize: 15, color: bot.locked ? Colors.textMuted : Colors.textPrimary }}>
                    {bot.name}
                  </Text>
                  {bot.locked ? (
                    <View className="flex-row items-center gap-1 self-start rounded-full px-sm" style={{ paddingVertical: 3, backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.emberLight, 0.5) }}>
                      <CurrencyIcon type="gems" size={11} color={Colors.emberLight} />
                      <Text className="font-heading-md" style={{ fontSize: 10, color: Colors.emberLight }}>
                        {bot.gemPrice} Gems
                      </Text>
                    </View>
                  ) : (
                    <View className="flex-row gap-1">
                      {Array.from({ length: 5 }, (_, i) => (
                        <AppIcon key={i} name="star" size={13} color={i < bot.stars ? Colors.cyan : Colors.chromeDark} />
                      ))}
                    </View>
                  )}
                  <Text className="font-caption uppercase text-text-muted" style={{ fontSize: 10, letterSpacing: 0.5 }}>{bot.tier}</Text>
                </View>
              </View>
              <Pressable
                onPress={() => handleBotPress(bot)}
                className="rounded px-4 py-2.5"
                hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
                style={{ backgroundColor: bot.locked ? withOpacity(Colors.chromeDark, 0.4) : Colors.chromeDark }}
              >
                <Text className="font-button-label uppercase text-text-primary" style={{ fontSize: 12, letterSpacing: 0.5 }}>{bot.locked ? 'Unlock' : 'Challenge'}</Text>
              </Pressable>
            </View>
          </RockCard>
        ))}
      </ScrollView>

      <BottomNav activeTab="play" />

      <MatchOptionsModal
        visible={optionsOpen}
        color={color}
        duration={duration}
        venueId={venueId}
        onColor={setColor}
        onDuration={setDuration}
        onVenue={setVenueId}
        onClose={() => setOptionsOpen(false)}
      />
    </View>
  );
}
