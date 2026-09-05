import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ChessBoard, EmberParticles, RockButton, RockCard } from '@/components/ui';
import { getPieceSprites } from '@/components/ui/pieceSprites';
import { getBoardTheme } from '@/constants/boardThemes';
import { Colors, Fonts, Spacing, withOpacity } from '@/constants/theme';
import { useChessGame } from '@/hooks/useChessGame';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { reportPuzzleSolvedForQuests } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { goUp } from '@/lib/navigation';
import { PUZZLES } from '@/lib/puzzleCatalog';
import { nextPuzzle, puzzleTags, puzzleTitle, themeLabel } from '@/lib/puzzleMeta';
import { markPuzzleSolved } from '@/lib/puzzleProgress';

export default function PuzzleMatchScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { puzzleId, tier, tacticId } = useLocalSearchParams<{
    puzzleId?: string;
    tier?: string;
    tacticId?: string;
  }>();
  const entry = PUZZLES.find((p) => p.id === puzzleId);
  const { profile } = usePlayerProfile();
  const boardTheme = getBoardTheme(profile?.equippedBoardId);
  const pieceSprites = getPieceSprites(profile?.equippedPieceId);

  // Hooks must run unconditionally -- passed a placeholder puzzle when the
  // param doesn't resolve so useChessGame stays happy; the render below
  // shows a "not found" state instead of using any of this hook's output.
  const game = useChessGame({
    mode: 'puzzle',
    puzzle: entry ? { puzzleId: entry.id, fen: entry.fen, moves: entry.moves } : undefined,
  });

  // Fire-once per puzzle (same pattern as useChessGame.ts's gameOverFiredRef)
  // -- resetPuzzle()/retrying after a failed attempt must never re-report a
  // solve that already landed.
  const reportedSolvedRef = useRef(false);
  useEffect(() => {
    if (game.puzzleStatus !== 'solved' || reportedSolvedRef.current) return;
    reportedSolvedRef.current = true;
    // Local, auth-independent -- guests get progress tracking too.
    if (entry) void markPuzzleSolved(entry.id);
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      try {
        await reportPuzzleSolvedForQuests(token);
      } catch (error) {
        console.log('Failed to report puzzle solve for quests', error);
      }
    })();
  }, [game.puzzleStatus, entry]);

  if (!entry) {
    return (
      <View style={[styles.root, styles.notFoundRoot]}>
        <Text style={styles.notFoundText}>Puzzle not found</Text>
        <View style={styles.notFoundButton}>
          <RockButton label="Back to Puzzles" variant="primary" onPress={() => goUp('/puzzle-match')} />
        </View>
      </View>
    );
  }

  // entry.fen's turn field is whoever plays the auto-played SETUP move
  // (moves[0]) -- the solver is the other color.
  const solverColor = entry.fen.split(' ')[1] === 'b' ? 'White' : 'Black';
  const statusText =
    game.puzzleStatus === 'solved'
      ? 'Solved!'
      : game.puzzleStatus === 'failed'
        ? 'Not quite — try again'
        : `Find the best move for ${solverColor}`;
  const statusColor =
    game.puzzleStatus === 'solved' ? Colors.gold : game.puzzleStatus === 'failed' ? Colors.crimson : Colors.cyan;

  const handleNextPuzzle = () => {
    const next = nextPuzzle(entry.id, { tier, tacticId });
    if (next && next.id !== entry.id) {
      router.replace({ pathname: '/puzzle-match', params: { puzzleId: next.id, tier, tacticId } });
    } else {
      goUp('/puzzle-match');
    }
  };

  return (
    <View style={styles.root}>
      <EmberParticles count={8} />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => goUp('/puzzle-match')} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Puzzle</Text>
        <View style={styles.backButton} />
      </View>

      <View style={[styles.middle, { paddingBottom: insets.bottom + Spacing.lg }]}>
        <RockCard glowColor={statusColor} style={styles.infoCard}>
          <Text style={styles.cardTitle}>{puzzleTitle(entry)}</Text>
          <View style={styles.infoRow}>
            <View style={styles.ratingPill}>
              <MaterialCommunityIcons name="puzzle" size={14} color={Colors.cyan} />
              <Text style={styles.ratingPillText}>{entry.rating}</Text>
            </View>
            <View style={styles.themeRow}>
              {puzzleTags(entry, 3).map((theme) => (
                <View key={theme} style={styles.themeTag}>
                  <Text style={styles.themeTagText}>{themeLabel(theme)}</Text>
                </View>
              ))}
            </View>
          </View>
          <Text style={[styles.statusText, { color: statusColor }]}>{statusText}</Text>
        </RockCard>

        <ChessBoard
          board={game.board}
          selectedSquare={game.selectedSquare}
          legalTargets={game.legalTargets}
          checkSquare={game.checkSquare}
          lastMove={game.lastMove}
          turn={game.turn}
          animateLastMove={game.lastMoveSource !== null && game.lastMoveSource !== 'human'}
          lastMoveSound={game.lastMoveSound}
          onSquarePress={(square) => game.handleSquarePress(square as Parameters<typeof game.handleSquarePress>[0])}
          theme={boardTheme}
          pieceSprites={pieceSprites}
        />

        <View style={styles.actionRow}>
          {game.puzzleStatus === 'solved' ? (
            <>
              <View style={styles.actionButton}>
                <RockButton label="Back to Puzzles" variant="secondary" onPress={() => goUp('/puzzle-match')} />
              </View>
              <View style={styles.actionButton}>
                <RockButton label="Next Puzzle" variant="primary" onPress={handleNextPuzzle} />
              </View>
            </>
          ) : (
            <>
              <View style={styles.actionButton}>
                <RockButton
                  label="Hint"
                  variant="primary"
                  onPress={() => game.hintSquare && game.handleSquarePress(game.hintSquare)}
                />
              </View>
              <View style={styles.actionButton}>
                <RockButton label="Give Up" variant="danger" onPress={game.resetPuzzle} />
              </View>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  notFoundRoot: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.lg,
  },
  notFoundText: {
    fontFamily: Fonts.display,
    fontSize: 18,
    color: Colors.textPrimary,
  },
  notFoundButton: {
    minWidth: 200,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgPanel, 0.8),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 15,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
    flex: 1,
    textAlign: 'center',
  },
  middle: {
    flex: 1,
    paddingHorizontal: Spacing.md,
    justifyContent: 'space-between',
  },
  infoCard: {
    gap: Spacing.sm,
  },
  cardTitle: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    color: Colors.textPrimary,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  ratingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: withOpacity(Colors.cyan, 0.14),
    borderWidth: 1,
    borderColor: withOpacity(Colors.cyan, 0.4),
  },
  ratingPillText: {
    fontFamily: Fonts.heading,
    fontSize: 12,
    color: Colors.cyan,
  },
  themeRow: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  themeTag: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: withOpacity(Colors.chrome, 0.1),
  },
  themeTagText: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'capitalize',
  },
  statusText: {
    fontFamily: Fonts.heading,
    fontSize: 14,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  actionRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  actionButton: {
    flex: 1,
  },
});
// #endregion
