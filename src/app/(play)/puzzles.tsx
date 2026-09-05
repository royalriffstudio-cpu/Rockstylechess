import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, SectionList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import {
  AppIcon,
  BottomNav,
  CurrencyPill,
  ProgressBar,
  RockButton,
  RockCard,
  ScreenBackdrop,
  SectionLabel,
} from '@/components/ui';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { type PuzzleEntry } from '@/lib/puzzleCatalog';
import {
  DIFFICULTY_TIERS,
  MOTIF_STYLE,
  TACTIC_FILTERS,
  TIER_IDS,
  firstUnsolved,
  puzzleMotif,
  puzzleTags,
  puzzleTitle,
  selectPuzzles,
  tacticLabelOf,
  themeLabel,
  tierAccent,
  tierLabelOf,
  tierOf,
  type TacticFilterId,
  type TierId,
} from '@/lib/puzzleMeta';
import { loadSolvedPuzzles, usePuzzleProgress } from '@/lib/puzzleProgress';

const TIER_STORAGE_KEY = 'rockstyle-chess:puzzle-tier';

// The catalog is curated in 200-point bands (scripts/curate-puzzles.mjs); the
// list groups a difficulty tier's puzzles back into those bands so a tier
// still reads as a gentle ramp rather than one undifferentiated block.
const BAND_SIZE = 200;
const BAND_START = 800;

function bandLabel(rating: number): string {
  const low = BAND_START + Math.floor((rating - BAND_START) / BAND_SIZE) * BAND_SIZE;
  return `${low}-${low + BAND_SIZE - 1}`;
}

interface PuzzleSection {
  title: string;
  data: PuzzleEntry[];
}

function groupByBand(puzzles: PuzzleEntry[]): PuzzleSection[] {
  const groups = new Map<string, PuzzleEntry[]>();
  for (const puzzle of puzzles) {
    const label = bandLabel(puzzle.rating);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(puzzle);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => Number(a.split('-')[0]) - Number(b.split('-')[0]))
    .map(([title, data]) => ({ title, data }));
}

// Dark accents (ember/crimson) need light label text on an active tab; bright
// ones (cyan/gold/emberLight) need dark text -- mirrors RockButton's rule.
function activeLabelColor(accent: string): string {
  return accent === Colors.ember || accent === Colors.crimson ? Colors.textPrimary : Colors.bgBase;
}

// Memoized so scrolling (SectionList mounts/unmounts rows as it virtualizes)
// never re-renders a row whose puzzle/solved/onPress didn't change.
const PuzzleRow = memo(function PuzzleRow({
  puzzle,
  solved,
  onPress,
}: {
  puzzle: PuzzleEntry;
  solved: boolean;
  onPress: (puzzle: PuzzleEntry) => void;
}) {
  const motif = MOTIF_STYLE[puzzleMotif(puzzle)];
  const accent = tierAccent(tierOf(puzzle.rating));
  const tags = puzzleTags(puzzle, 2);

  return (
    <Pressable onPress={() => onPress(puzzle)} style={{ marginTop: Spacing.sm }}>
      <RockCard glowColor={Colors.chromeDark} innerGlow={solved ? Colors.cyan : undefined}>
        <View className="flex-row items-center gap-md">
          <View
            className="h-14 w-14 items-center justify-center rounded-md"
            style={{
              backgroundColor: withOpacity(motif.color, 0.12),
              borderWidth: 1,
              borderColor: withOpacity(motif.color, 0.3),
            }}
          >
            <AppIcon name={motif.icon} size={26} color={motif.color} />
          </View>

          <View className="flex-1 gap-xs">
            <Text
              className="font-heading-md text-text-primary"
              numberOfLines={1}
              style={{ fontSize: 15 }}
            >
              {puzzleTitle(puzzle)}
            </Text>

            <View className="flex-row flex-wrap items-center gap-xs">
              <View
                className="rounded-full px-sm"
                style={{
                  paddingVertical: 3,
                  backgroundColor: withOpacity(accent, 0.14),
                  borderWidth: 1,
                  borderColor: withOpacity(accent, 0.4),
                }}
              >
                <Text className="font-heading-md" style={{ fontSize: 11, color: accent }}>
                  {puzzle.rating} ELO
                </Text>
              </View>

              {tags.map((tag) => (
                <View
                  key={tag}
                  className="rounded-full px-sm"
                  style={{ paddingVertical: 3, backgroundColor: withOpacity(Colors.chrome, 0.1) }}
                >
                  <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                    {themeLabel(tag)}
                  </Text>
                </View>
              ))}
            </View>
          </View>

          {solved ? (
            <AppIcon name="check_circle" size={20} color={withOpacity(Colors.cyan, 0.7)} />
          ) : (
            <AppIcon name="chevron_right" size={20} color={Colors.textMuted} />
          )}
        </View>
      </RockCard>
    </Pressable>
  );
});

export default function PuzzlesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gems } = usePlayerProfile();
  const { solved, count, total } = usePuzzleProgress();

  const [tier, setTier] = useState<TierId>('easy');
  const [tacticId, setTacticId] = useState<TacticFilterId>('all');

  // Restore the last-used difficulty (the tactic filter is always transient).
  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(TIER_STORAGE_KEY);
        if (stored && TIER_IDS.has(stored)) setTier(stored as TierId);
      } catch (error) {
        console.log('Failed to read saved puzzle tier', error);
      }
    })();
  }, []);

  // Defensive: pick up solves recorded elsewhere. The in-memory store already
  // notifies subscribers on solve, so this only ever matters across a cold
  // remount; it's one cheap union-merging read.
  useFocusEffect(
    useCallback(() => {
      void loadSolvedPuzzles();
    }, []),
  );

  const selectTier = useCallback((next: TierId) => {
    setTier(next);
    AsyncStorage.setItem(TIER_STORAGE_KEY, next).catch(() => {});
  }, []);

  const handlePuzzlePress = useCallback(
    (puzzle: PuzzleEntry) => {
      router.push({ pathname: '/puzzle-match', params: { puzzleId: puzzle.id, tier, tacticId } });
    },
    [router, tier, tacticId],
  );

  const visible = useMemo(() => selectPuzzles({ tier, tacticId }), [tier, tacticId]);
  const sections = useMemo(
    () => groupByBand(visible).filter((section) => section.data.length > 0),
    [visible],
  );
  // Recomputed each render (a solve re-renders via the progress subscription);
  // the scan is trivial at <=252 entries.
  const nextUnsolved = firstUnsolved({ tier });

  const trainingLabel = count === 0 ? 'Start Training' : nextUnsolved ? 'Continue Training' : 'Tier Complete';

  const renderItem = useCallback(
    ({ item }: { item: PuzzleEntry }) => (
      <PuzzleRow puzzle={item} solved={solved.has(item.id)} onPress={handlePuzzlePress} />
    ),
    [solved, handlePuzzlePress],
  );

  return (
    <View className="flex-1 bg-bg-base">
      <ScreenBackdrop source={ScreenArt.puzzlesBoard} opacity={0.2} />
      <SubPageHeader title="Puzzles" trailing={<CurrencyPill type="gems" value={gems} />} />

      {/* Progress strip */}
      <View style={styles.progressStrip}>
        <ProgressBar progress={total > 0 ? count / total : 0} label={`${count} / ${total} solved`} />
        <RockButton
          label={trainingLabel}
          variant="primary"
          disabled={!nextUnsolved}
          onPress={() => {
            if (nextUnsolved) {
              router.push({
                pathname: '/puzzle-match',
                params: { puzzleId: nextUnsolved.id, tier, tacticId: 'all' },
              });
            }
          }}
        />
      </View>

      {/* Difficulty segmented control */}
      <View style={styles.tierBar}>
        {DIFFICULTY_TIERS.map((difficulty) => {
          const active = difficulty.id === tier;
          return (
            <Pressable
              key={difficulty.id}
              onPress={() => selectTier(difficulty.id)}
              className="flex-1 items-center rounded"
              style={{
                paddingVertical: 7,
                backgroundColor: active ? difficulty.accent : 'transparent',
              }}
            >
              <Text
                className="font-heading-md uppercase"
                numberOfLines={1}
                style={{
                  fontSize: 11,
                  lineHeight: 14,
                  letterSpacing: 0.5,
                  color: active ? activeLabelColor(difficulty.accent) : Colors.textMuted,
                }}
              >
                {difficulty.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Tactic filter chips */}
      <View style={styles.chipRowWrap}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
        >
          {TACTIC_FILTERS.map((filter) => {
            const active = filter.id === tacticId;
            return (
              <Pressable
                key={filter.id}
                onPress={() => setTacticId(filter.id)}
                className="rounded-full"
                style={{
                  paddingHorizontal: 14,
                  height: 32,
                  justifyContent: 'center',
                  backgroundColor: active ? withOpacity(Colors.cyan, 0.18) : withOpacity(Colors.chrome, 0.08),
                  borderWidth: 1,
                  borderColor: active ? Colors.cyan : withOpacity(Colors.chromeDark, 0.3),
                }}
              >
                <Text
                  className="font-heading-md"
                  style={{
                    fontSize: 12,
                    lineHeight: 14,
                    color: active ? Colors.cyan : Colors.textMuted,
                  }}
                >
                  {filter.label}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {sections.length === 0 ? (
        <View className="flex-1 items-center justify-center px-xl">
          <RockCard>
            <View className="items-center gap-md">
              <AppIcon name="extension" size={32} color={Colors.chromeDark} />
              <Text className="text-center font-body-base text-body-base text-text-muted">
                No {tacticLabelOf(tacticId)} puzzles in {tierLabelOf(tier)}.
              </Text>
              <RockButton label="Show All" variant="secondary" onPress={() => setTacticId('all')} />
            </View>
          </RockCard>
        </View>
      ) : (
        <SectionList
          style={styles.list}
          sections={sections}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          renderSectionHeader={({ section }) => (
            <View style={styles.sectionHeader}>
              <SectionLabel label={section.title} />
            </View>
          )}
          contentContainerStyle={[styles.scrollContent, { paddingBottom: 110 + insets.bottom }]}
          showsVerticalScrollIndicator={false}
          stickySectionHeadersEnabled={false}
        />
      )}

      <BottomNav activeTab="play" />
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  progressStrip: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.md,
    gap: Spacing.sm,
  },
  tierBar: {
    flexDirection: 'row',
    gap: 4,
    marginHorizontal: Spacing.lg,
    marginTop: Spacing.md,
    padding: 4,
    borderRadius: 10,
    backgroundColor: withOpacity(Colors.bgPanel, 0.7),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.3),
  },
  chipRowWrap: {
    height: 40,
    marginTop: Spacing.sm,
  },
  chipRow: {
    alignItems: 'center',
    gap: Spacing.xs,
    paddingHorizontal: Spacing.lg,
  },
  list: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.sm,
  },
  sectionHeader: {
    marginTop: Spacing.lg,
    marginBottom: Spacing.sm,
  },
});
// #endregion
