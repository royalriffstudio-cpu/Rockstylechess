import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useMemo, useRef } from 'react';
import { Dimensions, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Colors, Fonts, Radius, Spacing, withOpacity } from '@/constants/theme';
import { useMatchReplay } from '@/hooks/useMatchReplay';
import { ChessBoard, type ChessBoardTheme } from './ChessBoard';
import type { PieceSpriteMap } from './pieceSprites';
import { RockCard } from './RockCard';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.72;
const SHEET_INNER_HEIGHT = SHEET_HEIGHT - Spacing.lg * 2;

interface MoveHistoryPanelProps {
  visible: boolean;
  onClose: () => void;
  // A frozen point-in-time snapshot from useChessGame's getReplayData() --
  // deliberately NOT re-derived live while the panel is open. This is a
  // read-only peek at history, not a view that follows the live game; the
  // real chess.js position, the opponent/bot, and the match clock all keep
  // running untouched underneath regardless of what's shown here.
  pgn: string | null;
  moveElapsedMs: number[] | null;
  boardTheme: ChessBoardTheme;
  pieceSprites: PieceSpriteMap;
  flipped?: boolean;
}

interface MoveListRow {
  moveNumber: number;
  white: { ply: number; san: string } | null;
  black: { ply: number; san: string } | null;
}

// The in-match "peek at previous moves" overlay -- same slide-up sheet
// convention as ChatPanel (stays mounted while hidden so the close animation
// can play), but shows a read-only ChessBoard + move list scrubbed via
// useMatchReplay instead of a chat log.
export function MoveHistoryPanel({
  visible,
  onClose,
  pgn,
  moveElapsedMs,
  boardTheme,
  pieceSprites,
  flipped,
}: MoveHistoryPanelProps) {
  const insets = useSafeAreaInsets();
  const replay = useMatchReplay(pgn, moveElapsedMs);
  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    const timingConfig = { duration: 260, easing: Easing.out(Easing.cubic) };
    translateY.value = withTiming(visible ? 0 : SHEET_HEIGHT, timingConfig);
    backdropOpacity.value = withTiming(visible ? 1 : 0, timingConfig);
  }, [visible, translateY, backdropOpacity]);

  // Opens on the LATEST ply, not move 0 -- this is a peek at "how did we get
  // here", not a from-the-start replay. Only fires on the false->true
  // transition (not every render while open) so it never fights the user's
  // own scrubbing. Relies on ordinary effect-ordering: useMatchReplay's own
  // internal reset-to-0 effect (keyed on `plies` identity, declared inside
  // the hook call above) always runs first within the same commit, and this
  // effect runs immediately after -- React batches both setPlyIndex calls
  // into one render, so there's no visible flash of move 0.
  const wasVisibleRef = useRef(visible);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) replay.goTo(replay.totalPlies);
    wasVisibleRef.current = visible;
  }, [visible, replay.totalPlies, replay.goTo]);

  const moveRows = useMemo<MoveListRow[]>(() => {
    const rows: MoveListRow[] = [];
    for (let i = 0; i < replay.plies.length; i += 2) {
      const wPly = replay.plies[i];
      const bPly = replay.plies[i + 1];
      rows.push({
        moveNumber: i / 2 + 1,
        white: wPly ? { ply: i + 1, san: wPly.san } : null,
        black: bPly ? { ply: i + 2, san: bPly.san } : null,
      });
    }
    return rows;
  }, [replay.plies]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  const atLatest = replay.plyIndex >= replay.totalPlies;
  const atStart = replay.plyIndex === 0;

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheetWrap, sheetStyle]}>
        <RockCard glowColor={Colors.cyan}>
          <View style={[styles.sheetInner, { paddingBottom: insets.bottom }]}>
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Move History</Text>
              <Pressable onPress={onClose} style={styles.closeButton}>
                <MaterialCommunityIcons name="chevron-down" size={24} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <View style={styles.boardWrap}>
              <View style={styles.boardBox}>
                <ChessBoard
                  board={replay.board}
                  checkSquare={replay.checkSquare}
                  lastMove={replay.lastMove}
                  turn={replay.turn}
                  animateLastMove={false}
                  lastMoveSound={null}
                  flipped={flipped}
                  theme={boardTheme}
                  pieceSprites={pieceSprites}
                />
              </View>
            </View>

            <Text style={styles.caption}>
              {replay.totalPlies === 0 ? 'No moves yet' : atStart ? 'Start' : `Move ${replay.plyIndex} / ${replay.totalPlies}`}
            </Text>

            <View style={styles.moveListWrap}>
              {moveRows.length > 0 ? (
                <ScrollView showsVerticalScrollIndicator indicatorStyle="white" contentContainerStyle={styles.moveListContent}>
                  {moveRows.map((row) => (
                    <View key={row.moveNumber} style={styles.moveRow}>
                      <Text style={styles.moveNumber}>{row.moveNumber}.</Text>
                      <MoveCell cell={row.white} activePly={replay.plyIndex} onSeek={replay.goTo} />
                      <MoveCell cell={row.black} activePly={replay.plyIndex} onSeek={replay.goTo} />
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <Text style={styles.emptyText}>Make a move to start tracking history.</Text>
              )}
            </View>

            <View style={styles.transportRow}>
              <Pressable
                onPress={replay.prev}
                disabled={atStart}
                style={[styles.transportButton, atStart && styles.transportButtonDisabled]}
              >
                <MaterialCommunityIcons name="skip-previous" size={22} color={Colors.textPrimary} />
              </Pressable>
              <Pressable
                onPress={() => replay.goTo(replay.totalPlies)}
                disabled={atLatest}
                style={[styles.latestButton, atLatest && styles.transportButtonDisabled]}
              >
                <MaterialCommunityIcons name="record-circle" size={14} color={Colors.bgBase} />
                <Text style={styles.latestButtonText}>Latest</Text>
              </Pressable>
              <Pressable
                onPress={replay.next}
                disabled={atLatest}
                style={[styles.transportButton, atLatest && styles.transportButtonDisabled]}
              >
                <MaterialCommunityIcons name="skip-next" size={22} color={Colors.cyan} />
              </Pressable>
            </View>
          </View>
        </RockCard>
      </Animated.View>
    </View>
  );
}

function MoveCell({
  cell,
  activePly,
  onSeek,
}: {
  cell: MoveListRow['white'];
  activePly: number;
  onSeek: (ply: number) => void;
}) {
  if (!cell) return <View style={styles.moveCell} />;
  const isActive = activePly === cell.ply;
  return (
    <Pressable onPress={() => onSeek(cell.ply)} style={styles.moveCell}>
      <Text style={[styles.moveSan, isActive && styles.moveSanActive]}>{cell.san}</Text>
    </Pressable>
  );
}

// #region Styles
const styles = StyleSheet.create({
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withOpacity(Colors.bgBase, 0.55),
  },
  sheetWrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    height: SHEET_HEIGHT,
  },
  sheetInner: {
    height: SHEET_INNER_HEIGHT,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.md,
    marginBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: withOpacity(Colors.chromeDark, 0.3),
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  boardWrap: {
    alignItems: 'center',
  },
  boardBox: {
    width: '100%',
    maxWidth: 260,
  },
  caption: {
    fontFamily: Fonts.heading,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  moveListWrap: {
    flex: 1,
    marginTop: Spacing.sm,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.3),
    backgroundColor: withOpacity(Colors.bgBase, 0.4),
  },
  moveListContent: {
    paddingVertical: 4,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.lg,
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.md,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: withOpacity(Colors.chromeDark, 0.15),
  },
  moveNumber: {
    width: 28,
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textMuted,
  },
  moveCell: {
    flex: 1,
  },
  moveSan: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  moveSanActive: {
    color: Colors.cyan,
    fontWeight: '700',
  },
  transportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.md,
  },
  transportButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgPanel, 0.9),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.5),
  },
  transportButtonDisabled: {
    opacity: 0.4,
  },
  latestButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.cyan,
    boxShadow: `0px 0px 14px ${withOpacity(Colors.cyan, 0.4)}`,
  },
  latestButtonText: {
    fontFamily: Fonts.heading,
    fontSize: 11,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    color: Colors.bgBase,
  },
});
// #endregion
