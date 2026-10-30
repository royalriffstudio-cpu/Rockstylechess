import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { TierEmblem, TitleEmblem } from '@/components/progression/Emblem';
import { AppIcon } from '@/components/ui/AppIcon';
import { Colors, Fonts, withOpacity } from '@/constants/theme';
import type { ProgressionReport } from '@/lib/api';
import { celebrate } from '@/lib/celebration';
import { LEVEL_TITLES } from '@/lib/progression';
import { xpForLevel } from '@/lib/leveling';

interface ShowReportProps {
  /** The server's report for this match; undefined until it arrives. */
  report: ProgressionReport | undefined;
  /** True once we have waited long enough that it is probably not coming. */
  timedOut: boolean;
}

const TIER_LABEL = { rookie: 'ROOKIE', challenger: 'CHALLENGER', master: 'MASTER', grandmaster: 'GRANDMASTER' } as const;

function useCountUp(target: number, durationMs = 900, delayMs = 250): number {
  const [value, setValue] = useState(0);
  useEffect(() => {
    let frame: ReturnType<typeof setTimeout>;
    const start = Date.now() + delayMs;
    function tick() {
      const progress = Math.min(1, Math.max(0, (Date.now() - start) / durationMs));
      setValue(Math.round(target * (1 - (1 - progress) ** 3)));
      if (progress < 1) frame = setTimeout(tick, 16);
    }
    tick();
    return () => clearTimeout(frame);
  }, [target, durationMs, delayMs]);
  return value;
}

// The Fame bar: fills from where the player WAS to where they are. If a level was
// crossed it fills to the end, snaps to empty and fills the new level, so the
// level-up reads as an event instead of a number silently changing.
function FameBar({ report }: { report: ProgressionReport }) {
  const width = useSharedValue(0);
  const beforeSpan = xpForLevel(report.levelBefore + 1) - xpForLevel(report.levelBefore);
  const startProgress = Math.max(0, Math.min(1, (report.xpBefore - xpForLevel(report.levelBefore)) / Math.max(1, beforeSpan)));
  const endProgress = report.levelProgress.progress;
  const leveled = report.levelAfter > report.levelBefore;

  useEffect(() => {
    width.value = startProgress;
    const fill = (to: number, ms: number) => withTiming(to, { duration: ms, easing: Easing.out(Easing.cubic) });
    width.value = leveled
      ? withDelay(350, withSequence(fill(1, 700), withTiming(0, { duration: 0 }), fill(endProgress, 650)))
      : withDelay(350, fill(endProgress, 900));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.eventId]);

  const fillStyle = useAnimatedStyle(() => ({ width: `${Math.max(0, Math.min(1, width.value)) * 100}%` }));
  return (
    <View style={styles.track}>
      <Animated.View style={[styles.fillWrap, fillStyle]}>
        <LinearGradient colors={[Colors.ember, Colors.gold]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.fill} />
      </Animated.View>
    </View>
  );
}

// Losing to a boss is not nothing: the crowd gets louder. Tells a stuck player how close the
// Roadie Kit is (it is only ever offered from the Tour screen, never here).
function BossAttemptLine({ attempt }: { attempt: NonNullable<NonNullable<ProgressionReport['tour']>['bossAttempt']> }) {
  const text = attempt.freeKitJustEarned
    ? 'THE CROWD HAS YOUR BACK · A FREE ROADIE KIT IS WAITING ON THE TOUR'
    : attempt.kitJustOpened
      ? 'THE CROWD IS LOUD · ROADIE KIT UNLOCKED ON THE TOUR'
      : attempt.toUnlock > 0
        ? `CROWD ENERGY ${attempt.losses} · ${attempt.toUnlock} MORE REAL ATTEMPT${attempt.toUnlock === 1 ? '' : 'S'} TO OPEN THE ROADIE KIT`
        : `CROWD ENERGY ${attempt.losses} · ${attempt.toNextFree} MORE FOR A FREE KIT`;
  return <Text style={[styles.tierUp, { color: Colors.ember }]}>{text}</Text>;
}

function TourLines({ tour }: { tour: NonNullable<ProgressionReport['tour']> }) {
  return (
    <View style={{ marginTop: 6, gap: 4 }}>
      {tour.gigsCompleted.map((gig) => (
        <View key={gig.id} style={[styles.row]}>
          <View style={[styles.rowLeft, { flexShrink: 1 }]}>
            <AppIcon name="flag" size={14} color={Colors.gold} />
            <Text style={[styles.goal, { color: Colors.gold }]} numberOfLines={1}>
              GIG DONE · {gig.title}
            </Text>
          </View>
          <Text style={[styles.meta, { color: Colors.gold }]}>+{gig.chips}</Text>
        </View>
      ))}
      {tour.gigsProgressed.slice(0, 2).map((gig) => (
        <View key={gig.id} style={styles.row}>
          <View style={[styles.rowLeft, { flexShrink: 1 }]}>
            <AppIcon name="flag" size={14} color={Colors.textMuted} />
            <Text style={styles.goal} numberOfLines={1}>
              {gig.title}
            </Text>
          </View>
          <Text style={styles.meta}>
            {gig.after}/{gig.target}
          </Text>
        </View>
      ))}
      {tour.encore ? (
        <Text style={[styles.tierUp, { color: Colors.ember }]}>
          ENCORE {tour.encore.progress}/{tour.encore.total}
        </Text>
      ) : null}
      {tour.bossAttempt ? <BossAttemptLine attempt={tour.bossAttempt} /> : null}
      {tour.bossBeaten ? (
        <Text style={[styles.tierUp, { color: Colors.gold }]}>BOSS DEFEATED · {tour.bossBeaten.chapterName.toUpperCase()} COMPLETE</Text>
      ) : null}
      {tour.chapterUnlocked ? (
        <Text style={[styles.tierUp, { color: Colors.cyan }]}>NEXT CHAPTER UNLOCKED · {tour.chapterUnlocked.name.toUpperCase()}</Text>
      ) : null}
      {tour.perfect ? <Text style={[styles.tierUp, { color: Colors.gold }]}>★ PERFECT {tour.perfect.chapterName.toUpperCase()} · +{tour.perfect.gems} GEMS</Text> : null}
    </View>
  );
}

function BonusPill({ label, color }: { label: string; color: string }) {
  return (
    <View style={[styles.pill, { backgroundColor: withOpacity(color, 0.14), borderColor: withOpacity(color, 0.5) }]}>
      <Text style={[styles.pillText, { color }]}>{label}</Text>
    </View>
  );
}

export function ShowReport({ report, timedOut }: ShowReportProps) {
  const fameCount = useCountUp(report?.fame.gained ?? 0);

  const eventId = report?.eventId;
  const gainedFame = report?.fame.gained ?? 0;
  useEffect(() => {
    if (eventId && gainedFame > 0) celebrate('reward');
  }, [eventId, gainedFame]);

  if (!report) {
    return (
      <Text style={styles.waiting}>{timedOut ? 'Your Fame will update shortly.' : 'Counting the crowd…'}</Text>
    );
  }

  const leveled = report.levelAfter > report.levelBefore;
  const nextTitle = LEVEL_TITLES.find((t) => t.minLevel > report.levelAfter);
  const nextLevelFame = xpForLevel(report.levelAfter + 1) - report.xpAfter;
  const title = report.equippedTitle?.name;
  const tierUp = report.rating && report.rating.tierAfter !== report.rating.tierBefore;
  const goals = report.goals.slice(0, 3);

  return (
    <View style={styles.root}>
      <View style={styles.rule} />

      {/* Fame earned + its bonuses */}
      <View style={styles.row}>
        <View style={styles.rowLeft}>
          <AppIcon name="stars" size={16} color={Colors.gold} />
          <Text style={styles.label}>FAME</Text>
        </View>
        <Text style={[styles.fame, report.fame.gained === 0 && { color: Colors.textMuted }]}>+{fameCount.toLocaleString('en-US')}</Text>
      </View>
      {report.fame.openingNight || report.fame.hotStreak > 1 || report.fame.capped || report.fame.ampBonus > 0 || report.fame.luckyPickSaved > 0 ? (
        <View style={styles.pills}>
          {report.fame.openingNight ? <BonusPill label="OPENING NIGHT ×2" color={Colors.cyan} /> : null}
          {report.fame.hotStreak > 1 ? <BonusPill label={`HOT STREAK ×${report.fame.hotStreak}`} color={Colors.ember} /> : null}
          {report.fame.ampBonus > 0 ? (
            <BonusPill
              label={`AMP BOOST +${Math.round(report.fame.ampBonus * 100)}% · ${report.fame.ampWinsLeft} WIN${report.fame.ampWinsLeft === 1 ? '' : 'S'} LEFT`}
              color={Colors.gold}
            />
          ) : null}
          {report.fame.luckyPickSaved > 0 ? <BonusPill label={`LUCKY PICK SAVED YOUR ${report.fame.luckyPickSaved}-WIN STREAK`} color={Colors.gold} /> : null}
          {report.fame.capped ? <BonusPill label="DAILY BOT FAME CAP" color={Colors.chromeMid} /> : null}
        </View>
      ) : null}

      {/* Level + bar */}
      <View style={[styles.row, { marginTop: 8 }]}>
        <View style={[styles.rowLeft, { flexShrink: 1 }]}>
          <TitleEmblem titleId={report.equippedTitle?.id} size={22} />
          <Text style={[styles.level, leveled && { color: Colors.gold }]} numberOfLines={1}>
            {leveled ? `LEVEL UP! ${report.levelAfter}` : `LVL ${report.levelAfter}`}
            {title ? `  ·  ${title}` : ''}
          </Text>
        </View>
        <Text style={styles.meta}>
          {report.levelProgress.xpIntoLevel.toLocaleString('en-US')} / {report.levelProgress.xpForNextLevel.toLocaleString('en-US')}
        </Text>
      </View>
      <FameBar report={report} />

      {/* Real rating change (online only) */}
      {report.rating ? (
        <View style={[styles.row, { marginTop: 8 }]}>
          <View style={styles.rowLeft}>
            <AppIcon name={report.rating.delta >= 0 ? 'trending_up' : 'trending_down'} size={15} color={report.rating.delta >= 0 ? Colors.cyan : Colors.crimson} />
            <Text style={styles.label}>RATING</Text>
          </View>
          <Text style={styles.meta}>
            {report.rating.before} → <Text style={{ color: Colors.textPrimary }}>{report.rating.after}</Text>{' '}
            <Text style={{ color: report.rating.delta >= 0 ? Colors.cyan : Colors.crimson }}>
              ({report.rating.delta >= 0 ? '+' : ''}
              {report.rating.delta})
            </Text>
          </Text>
        </View>
      ) : null}
      {tierUp && report.rating ? (
        <View style={styles.tierRow}>
          <TierEmblem tier={report.rating.tierAfter} size={36} />
          <Text style={[styles.tierUp, { color: report.rating.delta > 0 ? Colors.gold : Colors.chromeMid }]}>
            {report.rating.delta > 0 ? `NEW TIER: ${TIER_LABEL[report.rating.tierAfter]}` : `Dropped to ${TIER_LABEL[report.rating.tierAfter]}`}
          </Text>
        </View>
      ) : null}

      {/* Goals this match moved */}
      {goals.map((goal) => (
        <View key={goal.id} style={[styles.row, { marginTop: 6 }]}>
          <View style={[styles.rowLeft, { flexShrink: 1 }]}>
            <AppIcon name={goal.completed ? 'check_circle' : 'flag'} size={14} color={goal.completed ? Colors.gold : Colors.textMuted} />
            <Text style={[styles.goal, goal.completed && { color: Colors.gold }]} numberOfLines={1}>
              {goal.title}
            </Text>
          </View>
          <Text style={[styles.meta, goal.completed && { color: Colors.gold }]}>
            {goal.after}/{goal.target}
          </Text>
        </View>
      ))}

      {/* The Tour: gigs this match completed or moved, boss and chapter news */}
      {report.tour ? <TourLines tour={report.tour} /> : null}

      {/* What to do next */}
      <Text style={styles.next}>
        {nextLevelFame > 0 ? `${nextLevelFame.toLocaleString('en-US')} Fame to Level ${report.levelAfter + 1}` : ''}
        {nextTitle && nextTitle.minLevel - report.levelAfter <= 3 ? `  ·  ${nextTitle.name} at Level ${nextTitle.minLevel}` : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { width: '100%', marginTop: 12 },
  rule: { height: 1, backgroundColor: withOpacity(Colors.chromeDark, 0.4), marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 11, letterSpacing: 1.5, color: Colors.textMuted, fontFamily: Fonts.heading },
  fame: { fontSize: 22, color: Colors.gold, fontFamily: Fonts.display },
  level: { fontSize: 13, letterSpacing: 0.5, color: Colors.textPrimary, fontFamily: Fonts.heading, flexShrink: 1 },
  meta: { fontSize: 12, color: Colors.textMuted, fontFamily: Fonts.body },
  goal: { fontSize: 12, color: Colors.textPrimary, fontFamily: Fonts.body, flexShrink: 1 },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  pillText: { fontSize: 9, letterSpacing: 0.8, fontFamily: Fonts.heading },
  track: { height: 8, borderRadius: 4, backgroundColor: withOpacity(Colors.chromeDark, 0.3), overflow: 'hidden', marginTop: 6 },
  fillWrap: { height: '100%' },
  fill: { flex: 1, borderRadius: 4 },
  tierRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 },
  tierUp: { fontSize: 12, letterSpacing: 1.2, textAlign: 'center', fontFamily: Fonts.heading },
  next: { fontSize: 11, color: Colors.textMuted, marginTop: 10, textAlign: 'center', fontFamily: Fonts.body },
  waiting: { fontSize: 11, color: Colors.textMuted, marginTop: 10, textAlign: 'center', fontFamily: Fonts.body },
});
