import { Image } from 'expo-image';
import { usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { TitleEmblem } from '@/components/progression/Emblem';
import { AppIcon } from '@/components/ui/AppIcon';
import { CurrencyIcon } from '@/components/ui/CurrencyIcon';
import { RockButton } from '@/components/ui/RockButton';
import { Colors, Fonts, withOpacity } from '@/constants/theme';
import { CHAPTER_BADGES } from '@/constants/emblems';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import type { ProgressionReport } from '@/lib/api';
import { celebrate } from '@/lib/celebration';
import {
  dismissCelebration,
  ensureProgressionListener,
  loadUnseenCelebrations,
  peekCelebration,
  subscribeCelebrations,
} from '@/lib/progression';

// Never over a live game or a puzzle.
const HOLD_ROUTES = new Set(['/match', '/puzzle-match']);
// On the result screen the Show Report plays first; the big moment follows it.
const RESULT_ROUTE = '/result-placeholder';
const RESULT_DELAY_MS = 2800;

const SPARKS = Array.from({ length: 10 }, (_, i) => i);

function Spark({ index }: { index: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(180 + index * 40, withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) }));
  }, [index, t]);
  const angle = (index / SPARKS.length) * Math.PI * 2;
  const style = useAnimatedStyle(() => ({
    opacity: 1 - t.value,
    transform: [{ translateX: Math.cos(angle) * 120 * t.value }, { translateY: Math.sin(angle) * 120 * t.value }, { scale: 1 - t.value * 0.5 }],
  }));
  return <Animated.View style={[styles.spark, style]} />;
}

type Phase = 'level' | 'title' | 'chapter';

// One report can hold several moments (a level up AND a beaten boss). They play one
// after the other -- each its own card -- so none of them has to squeeze into a small
// phone screen together.
function phasesFor(report: ProgressionReport): Phase[] {
  const phases: Phase[] = [];
  if (report.levelAfter > report.levelBefore) phases.push('level');
  else if (report.titlesUnlocked.length > 0) phases.push('title');
  if (report.tour?.bossBeaten) phases.push('chapter');
  return phases;
}

function RewardPills({ chips, gems }: { chips: number; gems: number }) {
  if (chips <= 0 && gems <= 0) return null;
  return (
    <View style={styles.rewards}>
      {chips > 0 ? (
        <View style={styles.reward}>
          <CurrencyIcon type="chips" size={22} />
          <Text style={styles.rewardText}>+{chips.toLocaleString('en-US')}</Text>
        </View>
      ) : null}
      {gems > 0 ? (
        <View style={styles.reward}>
          <CurrencyIcon type="gems" size={22} />
          <Text style={styles.rewardText}>+{gems.toLocaleString('en-US')}</Text>
        </View>
      ) : null}
    </View>
  );
}

function Celebration({ report, onContinue }: { report: ProgressionReport; onContinue: () => void }) {
  const phases = phasesFor(report);
  const [phaseIndex, setPhaseIndex] = useState(0);
  const phase = phases[phaseIndex] ?? 'level';
  const leveled = phase === 'level';
  const slam = useSharedValue(0);
  const halo = useSharedValue(0);

  useEffect(() => {
    celebrate(phase === 'chapter' ? 'title' : leveled ? 'levelUp' : 'title');
    slam.value = 0;
    slam.value = withSpring(1, { damping: 9, stiffness: 140, mass: 0.8 });
    halo.value = withRepeat(withSequence(withTiming(1, { duration: 1100 }), withTiming(0.35, { duration: 1100 })), -1, false);
    const titleTimer = leveled && report.titlesUnlocked.length > 0 ? setTimeout(() => celebrate('title'), 900) : undefined;
    return () => clearTimeout(titleTimer);
  }, [phase, leveled, report.titlesUnlocked.length, slam, halo]);

  const numberStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, slam.value * 2),
    transform: [{ scale: 2.4 - slam.value * 1.4 }],
  }));
  const haloStyle = useAnimatedStyle(() => ({ opacity: 0.25 + halo.value * 0.45, transform: [{ scale: 0.9 + halo.value * 0.2 }] }));

  const newTitle = report.titlesUnlocked[report.titlesUnlocked.length - 1];
  const boss = report.tour?.bossBeaten;
  const last = phaseIndex >= phases.length - 1;

  return (
    <View style={styles.card}>
      <Animated.View pointerEvents="none" style={[styles.halo, haloStyle]} />
      {SPARKS.map((i) => (
        <Spark key={`${phase}-${i}`} index={i} />
      ))}

      {phase === 'chapter' && boss ? (
        <>
          <Text style={styles.kicker}>CHAPTER COMPLETE</Text>
          <Animated.View style={[{ alignItems: 'center', marginTop: 6 }, numberStyle]}>
            <Image source={CHAPTER_BADGES[boss.chapterId]} style={{ width: 132, height: 132 }} contentFit="contain" />
            <Text style={styles.chapterName}>{boss.chapterName}</Text>
          </Animated.View>
          <Text style={styles.sub}>Boss defeated</Text>
          <RewardPills chips={report.tour?.chips ?? boss.chips} gems={report.tour?.gems ?? boss.gems} />
          <View style={styles.titleCard}>
            <Text style={styles.titleKicker}>NEW TITLE UNLOCKED</Text>
            <Text style={styles.titleName}>{boss.titleName}</Text>
          </View>
          {report.tour?.chapterUnlocked ? <Text style={[styles.sub, { marginTop: 10, color: Colors.cyan }]}>Next up: {report.tour.chapterUnlocked.name}</Text> : null}
        </>
      ) : leveled ? (
        <>
          <Text style={styles.kicker}>LEVEL UP</Text>
          <Animated.Text style={[styles.bigNumber, numberStyle]}>{report.levelAfter}</Animated.Text>
          {report.levelAfter - report.levelBefore > 1 ? <Text style={styles.sub}>Jumped {report.levelAfter - report.levelBefore} levels!</Text> : null}
          <RewardPills chips={report.rewards.chips} gems={report.rewards.gems} />
          {newTitle ? (
            <View style={styles.titleCard}>
              <TitleEmblem titleId={newTitle.id} size={72} />
              <Text style={styles.titleKicker}>NEW TITLE UNLOCKED</Text>
              <Text style={styles.titleName}>{newTitle.name}</Text>
            </View>
          ) : null}
        </>
      ) : (
        <>
          <Text style={styles.kicker}>NEW TITLE</Text>
          {newTitle ? <TitleEmblem titleId={newTitle.id} size={120} /> : <AppIcon name="workspace_premium" size={56} color={Colors.gold} />}
          <RewardPills chips={report.rewards.chips} gems={report.rewards.gems} />
          {newTitle ? (
            <View style={styles.titleCard}>
              <Text style={styles.titleKicker}>YOUR TITLE</Text>
              <Text style={styles.titleName}>{newTitle.name}</Text>
            </View>
          ) : null}
        </>
      )}

      <View style={{ width: '100%', marginTop: 18 }}>
        <RockButton label={last ? 'Keep Rocking' : 'Continue'} variant="gold" onPress={last ? onContinue : () => setPhaseIndex(phaseIndex + 1)} />
      </View>
    </View>
  );
}

// Mounted once at the app root (next to ChallengeModals). Shows the big moments
// from lib/progression.ts's queue -- level up and new title -- from ANY screen,
// including celebrations missed while the app was closed (fetched from the
// server's unseen list). Held back during a live game or puzzle, and delayed on
// the result screen so the Show Report plays first.
export function ProgressionOverlay() {
  const pathname = usePathname();
  const { status, profile } = usePlayerProfile();
  const [head, setHead] = useState<ProgressionReport | undefined>(peekCelebration());
  const [armed, setArmed] = useState(false);

  useEffect(() => subscribeCelebrations(() => setHead(peekCelebration())), []);

  // Live pushes + anything missed while away.
  const userId = status === 'ready' ? profile?.userId : undefined;
  useEffect(() => {
    if (!userId) return;
    ensureProgressionListener();
    void loadUnseenCelebrations();
  }, [userId]);

  // Decide WHEN the head of the queue may appear.
  useEffect(() => {
    setArmed(false);
    if (!head || HOLD_ROUTES.has(pathname)) return;
    const timer = setTimeout(() => setArmed(true), pathname === RESULT_ROUTE ? RESULT_DELAY_MS : 250);
    return () => clearTimeout(timer);
  }, [head, pathname]);

  const visible = armed && !!head && !HOLD_ROUTES.has(pathname);
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={() => void dismissCelebration()}>
      <View style={styles.backdrop}>{head ? <Celebration key={head.eventId} report={head} onContinue={() => void dismissCelebration()} /> : null}</View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: withOpacity(Colors.bgBase, 0.88), alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    padding: 24,
    borderRadius: 20,
    backgroundColor: Colors.bgPanel,
    borderWidth: 1,
    borderColor: withOpacity(Colors.gold, 0.55),
    boxShadow: `0px 0px 40px ${withOpacity(Colors.gold, 0.35)}`,
    overflow: 'visible',
  },
  halo: { position: 'absolute', top: -30, width: 220, height: 220, borderRadius: 110, backgroundColor: withOpacity(Colors.gold, 0.22), boxShadow: `0px 0px 60px ${withOpacity(Colors.gold, 0.5)}` },
  spark: { position: 'absolute', top: 70, width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.gold },
  kicker: { fontSize: 14, letterSpacing: 6, color: Colors.gold, fontFamily: Fonts.heading },
  bigNumber: { fontSize: 112, lineHeight: 124, color: Colors.gold, fontFamily: Fonts.display, textShadowColor: withOpacity(Colors.gold, 0.7), textShadowRadius: 24, textShadowOffset: { width: 0, height: 0 } },
  sub: { fontSize: 12, color: Colors.textMuted, fontFamily: Fonts.body, marginTop: -6 },
  rewards: { flexDirection: 'row', gap: 12, marginTop: 14 },
  reward: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: withOpacity(Colors.bgBase, 0.6), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) },
  rewardText: { fontSize: 16, color: Colors.textPrimary, fontFamily: Fonts.heading },
  titleCard: { marginTop: 14, alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 12, width: '100%', backgroundColor: withOpacity(Colors.gold, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.45) },
  chapterArt: { width: 240, height: 110, borderRadius: 14, overflow: 'hidden', alignItems: 'center', justifyContent: 'flex-end', marginTop: 14, borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.6) },
  chapterScrim: { ...StyleSheet.absoluteFillObject, backgroundColor: withOpacity(Colors.bgBase, 0.45) },
  chapterName: { fontSize: 24, color: Colors.gold, fontFamily: Fonts.display, textTransform: 'uppercase', marginTop: 4 },
  titleKicker: { fontSize: 10, letterSpacing: 3, color: Colors.textMuted, fontFamily: Fonts.heading },
  titleName: { fontSize: 22, color: Colors.gold, fontFamily: Fonts.display, textTransform: 'uppercase', marginTop: 2 },
});
