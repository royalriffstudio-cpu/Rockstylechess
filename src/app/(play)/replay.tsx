import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { StockfishEngine, type StockfishEngineHandle } from '@/components/StockfishEngine';
import { ChessBoard, ProgressBar, RockCard } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import { getPieceSprites } from '@/components/ui/pieceSprites';
import { getBoardTheme } from '@/constants/boardThemes';
import { Colors, withOpacity } from '@/constants/theme';
import { useGameAnalysis } from '@/hooks/useGameAnalysis';
import { useMatchReplay } from '@/hooks/useMatchReplay';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getMatchReplay, type MatchHistoryEntry } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { MOVE_QUALITY_LABEL, type MoveQuality } from '@/lib/gameAnalysis';
import { getPendingLocalReplay, type LocalMatchReplay } from '@/lib/localMatchReplayStore';
import { formatRelativeTime } from '@/lib/time';

const RESULT_LABEL: Record<MatchHistoryEntry['resultType'], string> = {
  checkmate: 'Checkmate',
  stalemate: 'Stalemate',
  draw: 'Draw',
  resignation: 'Resignation',
  forfeit: 'Forfeit',
  timeout: 'Timeout',
};

const QUALITY_COLOR: Record<MoveQuality, string> = {
  best: Colors.cyan,
  good: Colors.gold,
  inaccuracy: Colors.emberLight,
  mistake: Colors.ember,
  blunder: Colors.crimson,
};

// Skull for blunder is a deliberate nod to this app's own rockstar/metal
// bot roster (The Reaper is already 💀) -- not just a generic "error" icon.
const QUALITY_ICON: Record<MoveQuality, keyof typeof MaterialCommunityIcons.glyphMap> = {
  best: 'star-circle',
  good: 'thumb-up',
  inaccuracy: 'help-circle',
  mistake: 'alert-circle',
  blunder: 'skull',
};

// A raw "86.5% accuracy" reads like a model metric, not feedback -- pairing
// it with a plain-language verdict is what actually tells the player how
// their game went.
function accuracyVerdict(accuracy: number): string {
  if (accuracy >= 95) return 'Flawless';
  if (accuracy >= 85) return 'Excellent';
  if (accuracy >= 70) return 'Solid';
  if (accuracy >= 50) return 'Shaky';
  return 'Rough Game';
}

type LoadStatus = 'loading' | 'ready' | 'error';

// Approx height of one move-list row (paddingVertical 6 + ~19px line + 1px
// divider) -- used to keep the active move in view as the replay advances.
const MOVE_ROW_HEIGHT = 32;

interface MoveListRow {
  moveNumber: number;
  white: { ply: number; san: string; quality: MoveQuality | null } | null;
  black: { ply: number; san: string; quality: MoveQuality | null } | null;
}

export default function ReplayScreen() {
  const insets = useSafeAreaInsets();
  const { source, matchId, mode, opponentDisplayName, resultType, color, playedAt } = useLocalSearchParams<{
    source?: string;
    matchId?: string;
    // 'analysis' -- set only by the paid "Analyze Game" entry point
    // (result-placeholder.tsx). Plain replay entry points never set this,
    // so analysis is purely a function of how this screen was reached, not
    // something a visitor can switch on for free once already inside.
    mode?: string;
    opponentDisplayName?: string;
    resultType?: MatchHistoryEntry['resultType'];
    color?: 'w' | 'b';
    playedAt?: string;
  }>();
  const { profile } = usePlayerProfile();
  const boardTheme = getBoardTheme(profile?.equippedBoardId);
  const pieceSprites = getPieceSprites(profile?.equippedPieceId);

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [pgn, setPgn] = useState<string | null>(null);
  const [moveElapsedMs, setMoveElapsedMs] = useState<number[] | null>(null);
  // Set only for the bot/local path (source === 'local') -- read from the
  // temporary in-memory store instead of fetched from the server, since
  // these matches never reach it. Drives the info card in place of the
  // route params the online path uses.
  const [localReplay, setLocalReplay] = useState<LocalMatchReplay | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (source === 'local') {
        const local = getPendingLocalReplay();
        setLocalReplay(local);
        setPgn(local?.pgn ?? null);
        setMoveElapsedMs(local?.moveElapsedMs ?? null);
        setStatus('ready');
        return;
      }
      if (!matchId) {
        setStatus('error');
        return;
      }
      const token = await getAuthToken();
      if (!token) {
        setStatus('error');
        return;
      }
      try {
        const result = await getMatchReplay(token, matchId);
        if (cancelled) return;
        setPgn(result.pgn);
        setMoveElapsedMs(result.moveElapsedMs);
        setStatus('ready');
      } catch (error) {
        console.log('Failed to load match replay', error);
        if (!cancelled) setStatus('error');
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [source, matchId]);

  const replay = useMatchReplay(pgn, moveElapsedMs);

  // Separate feature from replay itself, reusing its already-loaded pgn --
  // a fresh StockfishEngine instance scoped to this screen (no relation to
  // match.tsx's own instance, which only ever exists during live bot play).
  // Purely route-param-driven (see the mode param above) -- no in-screen
  // toggle, since this is now a paid action gated at result-placeholder.tsx.
  const analysisMode = mode === 'analysis';
  const analysisEngineRef = useRef<StockfishEngineHandle>(null);
  const analysis = useGameAnalysis(pgn, analysisEngineRef);

  // Keep the active move visible in the (independently scrolling) move list as
  // the replay advances -- prev/next/play all move `plyIndex`.
  const moveListRef = useRef<ScrollView>(null);
  useEffect(() => {
    const rowIndex = replay.plyIndex === 0 ? 0 : Math.floor((replay.plyIndex - 1) / 2);
    moveListRef.current?.scrollTo({ y: Math.max(0, (rowIndex - 2) * MOVE_ROW_HEIGHT), animated: true });
  }, [replay.plyIndex]);

  useEffect(() => {
    if (analysisMode && pgn && analysis.status === 'idle') {
      analysis.start();
    }
    // analysis.start intentionally omitted -- it's a plain (non-memoized)
    // function recreated every render, and the status==='idle' guard above
    // already makes re-invoking it on every render harmless/idempotent, so
    // including it would just be a no-op churn dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisMode, pgn, analysis.status]);

  const currentMoveAnalysis = replay.plyIndex > 0 ? (analysis.result?.moves[replay.plyIndex - 1] ?? null) : null;
  const currentPositionEval = analysis.result?.positions[replay.plyIndex] ?? null;

  // Pairs of (white ply, black ply) for the scrollable move list -- SAN
  // from the replay plies themselves, per-ply quality zipped in from the
  // analysis result when it's available.
  const moveRows = useMemo<MoveListRow[]>(() => {
    const rows: MoveListRow[] = [];
    for (let i = 0; i < replay.plies.length; i += 2) {
      const wPly = replay.plies[i];
      const bPly = replay.plies[i + 1];
      rows.push({
        moveNumber: i / 2 + 1,
        white: wPly ? { ply: i + 1, san: wPly.san, quality: analysis.result?.moves[i]?.quality ?? null } : null,
        black: bPly ? { ply: i + 2, san: bPly.san, quality: analysis.result?.moves[i + 1]?.quality ?? null } : null,
      });
    }
    return rows;
  }, [replay.plies, analysis.result]);

  // "You" beats a bare color whenever we actually know which side the
  // viewer played -- online matches always do (the color route param);
  // bot matches do via the stored playerColor; local pass-and-play has no
  // single "you" (two humans, one device), so it stays White/Black.
  function sideLabel(side: 'w' | 'b'): string {
    if (localReplay) {
      if (localReplay.mode === 'bot' || localReplay.mode === 'online') {
        return side === localReplay.playerColor ? 'You' : localReplay.opponentLabel;
      }
      return side === 'w' ? 'White' : 'Black';
    }
    if (color) return side === color ? 'You' : opponentDisplayName || 'Opponent';
    return side === 'w' ? 'White' : 'Black';
  }

  const showTransport = status === 'ready' && replay.isAvailable;
  const verdict = analysisMode && analysis.status === 'done' && analysis.result ? analysis.result.summary : null;

  // The side the viewer played, when we know it -- the floating verdict
  // card reports on that side specifically (local pass-and-play has no
  // single "you", so it falls back to White).
  const knowsViewer = localReplay
    ? localReplay.mode === 'bot' || localReplay.mode === 'online'
    : Boolean(color);
  const viewerColor: 'w' | 'b' = localReplay
    ? localReplay.mode === 'bot' || localReplay.mode === 'online'
      ? localReplay.playerColor
      : 'w'
    : (color ?? 'w');
  const viewerVerdict = verdict ? verdict[viewerColor] : null;
  const viewerAccuracy = viewerVerdict ? Math.round(viewerVerdict.accuracy) : 0;
  const viewerBlunders = viewerVerdict ? viewerVerdict.counts.blunder : 0;

  return (
    <View className="flex-1 bg-bg-base">
      <StockfishEngine ref={analysisEngineRef} enabled={analysisMode} />

      <SubPageHeader title={analysisMode ? 'Game Analysis' : 'Replay'} />

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 12, paddingBottom: (showTransport ? 210 : 24) + insets.bottom, gap: 12 }}
        showsVerticalScrollIndicator={false}
      >
        {localReplay ? (
          <RockCard>
            <Text className="font-heading-md text-cyan" style={{ fontSize: 14 }}>
              VS. {localReplay.opponentLabel.toUpperCase()}
            </Text>
            <Text className="mt-1 font-body-sm text-text-muted" style={{ fontSize: 12 }}>
              {formatRelativeTime(localReplay.playedAt)} • {RESULT_LABEL[localReplay.resultType]} •{' '}
              {localReplay.outcome === 'win' ? 'Victory' : localReplay.outcome === 'loss' ? 'Defeat' : 'Draw'}
            </Text>
          </RockCard>
        ) : opponentDisplayName ? (
          <RockCard>
            <Text className="font-heading-md text-cyan" style={{ fontSize: 14 }}>
              VS. {opponentDisplayName.toUpperCase()}
            </Text>
            <Text className="mt-1 font-body-sm text-text-muted" style={{ fontSize: 12 }}>
              {playedAt ? `${formatRelativeTime(playedAt)} • ` : ''}
              {resultType ? RESULT_LABEL[resultType] : ''}
              {color ? ` • Played as ${color === 'w' ? 'White' : 'Black'}` : ''}
            </Text>
          </RockCard>
        ) : null}

        {status === 'loading' ? (
          <View className="flex-1 items-center justify-center" style={{ minHeight: 240 }}>
            <ActivityIndicator color={Colors.cyan} size="large" />
          </View>
        ) : status === 'error' || !replay.isAvailable ? (
          <View className="flex-1 items-center justify-center" style={{ minHeight: 240 }}>
            <Text className="px-lg text-center font-body-base text-body-base text-text-muted">
              Replay isn&apos;t available for this match.
            </Text>
          </View>
        ) : (
          <>
            {analysisMode && analysis.status === 'analyzing' ? (
              <RockCard>
                <Text className="font-heading-md text-text-primary" style={{ fontSize: 13 }}>
                  Reviewing your game…
                </Text>
                <View className="mt-sm">
                  <ProgressBar
                    progress={analysis.progress.total ? analysis.progress.done / analysis.progress.total : 0}
                    height={8}
                  />
                </View>
              </RockCard>
            ) : null}

            {analysisMode && analysis.status === 'error' ? (
              <RockCard>
                <Text className="font-heading-md text-text-primary" style={{ fontSize: 13 }}>
                  Couldn&apos;t analyze this game.
                </Text>
              </RockCard>
            ) : null}

            {analysisMode && currentPositionEval ? (
              <View className="gap-1">
                <View className="flex-row items-center justify-between px-0.5">
                  <Text className="font-heading-md text-cyan" style={{ fontSize: 12, letterSpacing: 0.5 }}>
                    White {Math.round(currentPositionEval.whiteWinPercent)}%
                  </Text>
                  <Text className="font-heading-md uppercase text-text-muted" style={{ fontSize: 12, letterSpacing: 0.5 }}>
                    Evaluation
                  </Text>
                </View>
                <View className="h-3 overflow-hidden rounded-full" style={{ backgroundColor: withOpacity(Colors.crimson, 0.55) }}>
                  <View style={{ height: '100%', width: `${currentPositionEval.whiteWinPercent}%`, backgroundColor: Colors.cyan }} />
                </View>
              </View>
            ) : null}

            <View className="items-center py-sm">
              <View style={{ width: '100%', maxWidth: 300 }}>
                <ChessBoard
                  board={replay.board}
                  checkSquare={replay.checkSquare}
                  lastMove={replay.lastMove}
                  turn={replay.turn}
                  animateLastMove
                  lastMoveSound={replay.lastMoveSound}
                  theme={boardTheme}
                  pieceSprites={pieceSprites}
                />
              </View>
            </View>

            {analysisMode && currentMoveAnalysis ? (
              <View
                className="flex-row items-center gap-sm rounded-lg p-sm"
                style={{ borderWidth: 1, borderColor: withOpacity(QUALITY_COLOR[currentMoveAnalysis.quality], 0.5), backgroundColor: withOpacity(Colors.bgPanel, 0.8) }}
              >
                <View
                  className="h-10 w-10 items-center justify-center rounded-full"
                  style={{ backgroundColor: withOpacity(QUALITY_COLOR[currentMoveAnalysis.quality], 0.18) }}
                >
                  <MaterialCommunityIcons
                    name={QUALITY_ICON[currentMoveAnalysis.quality]}
                    size={22}
                    color={QUALITY_COLOR[currentMoveAnalysis.quality]}
                  />
                </View>
                <View className="flex-1 gap-0.5">
                  <Text className="font-heading-md" style={{ fontSize: 14, color: QUALITY_COLOR[currentMoveAnalysis.quality] }}>
                    {currentMoveAnalysis.san} · {MOVE_QUALITY_LABEL[currentMoveAnalysis.quality]}
                  </Text>
                  {currentMoveAnalysis.bestMoveSan ? (
                    <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                      Better was {currentMoveAnalysis.bestMoveSan}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Scrollable move list -- SAN from the replay plies, per-move
                quality colors zipped in when analysis has run. Tapping a
                move seeks the board to that ply. */}
            {moveRows.length > 0 ? (
              <View
                className="overflow-hidden rounded-lg"
                style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
              >
                <View
                  className="flex-row px-md py-sm"
                  style={{ borderBottomWidth: 1, borderBottomColor: withOpacity(Colors.chromeDark, 0.3) }}
                >
                  <Text className="w-8 font-section-header uppercase text-text-muted" style={{ fontSize: 10, letterSpacing: 1 }}>
                    #
                  </Text>
                  <Text className="flex-1 font-section-header uppercase text-text-muted" style={{ fontSize: 10, letterSpacing: 1 }}>
                    White
                  </Text>
                  <Text className="flex-1 font-section-header uppercase text-text-muted" style={{ fontSize: 10, letterSpacing: 1 }}>
                    Black
                  </Text>
                </View>
                <View style={{ maxHeight: 200 }}>
                  <ScrollView
                    ref={moveListRef}
                    nestedScrollEnabled
                    showsVerticalScrollIndicator
                    indicatorStyle="white"
                    contentContainerStyle={{ paddingBottom: 4 }}
                  >
                    {moveRows.map((row) => (
                      <View
                        key={row.moveNumber}
                        className="flex-row items-center px-md"
                        style={{ paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: withOpacity(Colors.chromeDark, 0.15) }}
                      >
                        <Text className="w-8 font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                          {row.moveNumber}.
                        </Text>
                        <MoveCell cell={row.white} activePly={replay.plyIndex} onSeek={replay.goTo} />
                        <MoveCell cell={row.black} activePly={replay.plyIndex} onSeek={replay.goTo} />
                      </View>
                    ))}
                  </ScrollView>
                </View>
              </View>
            ) : null}

            {verdict ? (
              <RockCard glowColor={Colors.gold}>
                <Text className="text-center font-display-hero uppercase text-gold" style={{ fontSize: 14, letterSpacing: 1 }}>
                  Game Report
                </Text>
                {(['w', 'b'] as const).map((c) => {
                  const { accuracy, counts } = verdict[c];
                  return (
                    <View key={c} className="mt-md gap-xs">
                      <View className="flex-row items-center justify-between">
                        <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 13 }}>
                          {sideLabel(c)}
                        </Text>
                        <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                          {accuracyVerdict(accuracy)}
                        </Text>
                      </View>
                      <View className="flex-row items-baseline gap-1.5">
                        <Text className="font-display-hero text-cyan" style={{ fontSize: 28 }}>
                          {Math.round(accuracy)}%
                        </Text>
                        <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                          accuracy
                        </Text>
                      </View>
                      <View className="flex-row flex-wrap gap-xs">
                        {(Object.keys(MOVE_QUALITY_LABEL) as MoveQuality[])
                          .filter((q) => counts[q] > 0)
                          .map((q) => (
                            <View
                              key={q}
                              className="flex-row items-center gap-1 rounded-full px-sm"
                              style={{ paddingVertical: 4, borderWidth: 1, borderColor: withOpacity(QUALITY_COLOR[q], 0.4), backgroundColor: withOpacity(Colors.bgBase, 0.5) }}
                            >
                              <MaterialCommunityIcons name={QUALITY_ICON[q]} size={13} color={QUALITY_COLOR[q]} />
                              <Text className="font-heading-md" style={{ fontSize: 11, color: QUALITY_COLOR[q] }}>
                                {counts[q]}
                              </Text>
                            </View>
                          ))}
                      </View>
                    </View>
                  );
                })}
              </RockCard>
            ) : null}
          </>
        )}
      </ScrollView>

      {showTransport ? (
        <View
          className="absolute bottom-0 left-0 w-full"
          style={{ backgroundColor: withOpacity(Colors.bgBase, 0.96), borderTopWidth: 1, borderTopColor: withOpacity(Colors.chromeDark, 0.3), paddingBottom: insets.bottom + 12 }}
        >
          {verdict ? (
            <View
              className="absolute flex-row items-center justify-between rounded-lg p-3"
              style={{
                left: '5%',
                width: '90%',
                top: -68,
                backgroundColor: Colors.bgPanel,
                borderWidth: 1,
                borderColor: withOpacity(Colors.cyan, 0.35),
                boxShadow: `0px 4px 20px ${withOpacity(Colors.cyan, 0.15)}`,
              }}
            >
              <View>
                <Text className="font-section-header uppercase text-text-muted" style={{ fontSize: 10, letterSpacing: 2 }}>
                  {knowsViewer ? 'Your Verdict' : 'Verdict'}
                </Text>
                <Text className="font-display-hero text-cyan" style={{ fontSize: 22 }}>
                  {viewerAccuracy}% ACCURACY
                </Text>
              </View>
              <View className="items-end pl-4" style={{ borderLeftWidth: 1, borderLeftColor: withOpacity(Colors.chromeDark, 0.3) }}>
                <View className="flex-row items-center gap-1">
                  <MaterialCommunityIcons name="skull" size={16} color={Colors.crimson} />
                  <Text className="font-heading-md" style={{ fontSize: 18, color: Colors.crimson }}>
                    {viewerBlunders}
                  </Text>
                </View>
                <Text className="font-caption uppercase text-text-muted" style={{ fontSize: 10 }}>
                  Blunders
                </Text>
              </View>
            </View>
          ) : null}

          <View className="flex-row items-center justify-center gap-xl px-margin-mobile" style={{ paddingTop: verdict ? 40 : 16, paddingBottom: 8 }}>
            <Pressable
              onPress={replay.prev}
              disabled={replay.plyIndex === 0}
              className="h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.9), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5), opacity: replay.plyIndex === 0 ? 0.4 : 1 }}
            >
              <MaterialCommunityIcons name="skip-previous" size={24} color={Colors.textPrimary} />
            </Pressable>
            <Pressable
              onPress={replay.isPlaying ? replay.pause : replay.play}
              className="h-16 w-16 items-center justify-center rounded-full"
              style={{ backgroundColor: Colors.cyan, boxShadow: `0px 0px 20px ${withOpacity(Colors.cyan, 0.4)}` }}
            >
              <MaterialCommunityIcons name={replay.isPlaying ? 'pause' : 'play'} size={32} color={Colors.bgBase} />
            </Pressable>
            <Pressable
              onPress={replay.next}
              disabled={replay.plyIndex >= replay.totalPlies}
              className="h-12 w-12 items-center justify-center rounded-full"
              style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.9), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5), opacity: replay.plyIndex >= replay.totalPlies ? 0.4 : 1 }}
            >
              <MaterialCommunityIcons name="skip-next" size={24} color={Colors.cyan} />
            </Pressable>
          </View>
          <Text className="text-center font-heading-md uppercase text-text-muted" style={{ fontSize: 11, letterSpacing: 1 }}>
            {replay.plyIndex === 0 ? 'Start' : `Move ${replay.plyIndex} / ${replay.totalPlies}`}
          </Text>
        </View>
      ) : null}
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
  if (!cell) return <View className="flex-1" />;
  const isActive = activePly === cell.ply;
  const quality = cell.quality;
  return (
    <Pressable onPress={() => onSeek(cell.ply)} className="flex-1 flex-row items-center gap-1">
      <Text
        className="font-body-sm"
        style={{ fontSize: 13, color: isActive ? Colors.cyan : Colors.textPrimary, fontWeight: isActive ? '700' : '400' }}
      >
        {cell.san}
      </Text>
      {quality && quality !== 'best' && quality !== 'good' ? (
        <MaterialCommunityIcons name={QUALITY_ICON[quality]} size={12} color={QUALITY_COLOR[quality]} />
      ) : null}
    </Pressable>
  );
}
