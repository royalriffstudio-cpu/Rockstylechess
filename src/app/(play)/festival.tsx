import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { CurrencyIcon, CurrencyPill, PlayerAvatar, RockButton, RockCard } from '@/components/ui';
import { BOT_PORTRAITS, BOT_TIER_LABEL } from '@/constants/bots';
import { Colors, Fonts, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { useFestival } from '@/hooks/useFestival';
import type { BotDifficulty } from '@/hooks/useChessGame';
import { cashOutFestival, enterFestival, recoverFestivalRun, type FestivalRunView, type FestivalTierView } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { reportError } from '@/lib/crashReporting';
import { FESTIVAL_ERROR_COPY, festivalMatchParams, rejoinFestivalSet, startFestivalSet } from '@/lib/festival';
import type { QueueMatchedPayload } from '@/lib/onlineMatch';

const fmt = (n: number) => n.toLocaleString('en-US');

// Festival Run: pay an entry, beat a ladder of bots one set at a time, and bank the purse
// between sets or push on. The server plays the bot itself and settles everything (see
// server/src/db/festival.ts), so this screen only shows the server's view and asks it to
// start sets, enter runs and cash out.
export default function FestivalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, chips, refresh } = usePlayerProfile();
  const { festival, error, reload } = useFestival();
  const [busy, setBusy] = useState<string | null>(null);

  function openSet(payload: QueueMatchedPayload) {
    router.push({ pathname: '/match', params: festivalMatchParams(payload) });
  }

  async function startNextSet(runId: string) {
    const result = await startFestivalSet(runId, openSet);
    if (!result.ok) Alert.alert('Could not start the set', FESTIVAL_ERROR_COPY[result.reason] ?? FESTIVAL_ERROR_COPY.unavailable);
  }

  async function enter(tier: FestivalTierView) {
    const token = await getAuthToken();
    if (!token || busy) return;
    setBusy(tier.id);
    try {
      const result = await enterFestival(token, tier.id);
      if (!result.ok) {
        const e = result;
        if (e.error === 'insufficient-chips') {
          Alert.alert('Not enough chips', `${tier.name} costs ${fmt(e.required ?? tier.nextEntry)} chips and you have ${fmt(e.chips ?? chips)}.`, [
            { text: 'Not now', style: 'cancel' },
            { text: 'Get chips', onPress: () => router.push('/shop') },
          ]);
        } else if (e.error === 'locked') {
          Alert.alert('Locked', `Beat the boss of ${e.chapterName ?? tier.unlockChapterName} in the Tour to unlock ${tier.name}.`);
        } else if (e.error === 'daily-limit') {
          Alert.alert('Come back tomorrow', `You have played ${tier.name} the maximum ${e.limit ?? tier.dailyRuns} time(s) today.`);
        } else if (e.error === 'already-active') {
          Alert.alert('Run in progress', 'Finish or cash out your current run first.');
        } else {
          Alert.alert('Festival unavailable', 'We could not enter the run. You were not charged. Try again in a moment.');
        }
        await reload();
        return;
      }
      refresh();
      // Straight into set 1: you paid to play.
      await startNextSet(result.run.id);
      await reload();
    } finally {
      setBusy(null);
    }
  }

  async function cashOut(run: FestivalRunView) {
    const token = await getAuthToken();
    if (!token || busy) return;
    Alert.alert('Cash out?', `Bank ${fmt(run.banked)} chips and end this run.`, [
      { text: 'Keep playing', style: 'cancel' },
      {
        text: `Cash out ${fmt(run.banked)}`,
        onPress: async () => {
          setBusy('cash');
          try {
            await cashOutFestival(token, run.id);
            refresh();
          } catch (e) {
            reportError(e, { area: 'festival-cash-out' });
            Alert.alert('Could not cash out', 'Please try again.');
          } finally {
            await reload();
            setBusy(null);
          }
        },
      },
    ]);
  }

  async function rejoin(run: FestivalRunView) {
    if (busy || !run.matchId) return;
    setBusy('rejoin');
    try {
      const result = await rejoinFestivalSet(run.matchId, openSet);
      if (result.ok) return;
      // The set is not live on the server any more (it restarted): resolve the run.
      const token = await getAuthToken();
      if (!token) return;
      try {
        const recovered = await recoverFestivalRun(token, run.id);
        refresh();
        Alert.alert(
          'That set was interrupted',
          recovered.how === 'refunded' ? `Your entry of ${fmt(run.entryPaid)} chips was returned.` : `Your banked ${fmt(recovered.payout)} chips were paid out.`,
        );
      } catch {
        Alert.alert('Still connecting', 'The set is still live. Check your connection and try again.');
      }
    } finally {
      await reload();
      setBusy(null);
    }
  }

  const active = festival?.activeRun ?? null;

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Festival" trailing={<CurrencyPill type="chips" value={chips} />} />

      {status === 'guest' ? (
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <MaterialCommunityIcons name="ticket-confirmation" size={56} color={Colors.textMuted} />
          <Text className="text-center font-body-base text-body-base text-text-muted">Sign in to play the Festival. Entries and purses are chips on your account.</Text>
          <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
        </View>
      ) : !festival ? (
        error ? (
          <View className="flex-1 items-center justify-center gap-md">
            <Text className="font-body-base text-body-base text-text-muted">Couldn&apos;t load the Festival.</Text>
            <RockButton label="Retry" variant="primary" onPress={() => void reload()} />
          </View>
        ) : (
          <ActivityIndicator color={Colors.cyan} style={{ marginTop: 48 }} />
        )
      ) : (
        <ScrollView contentContainerClassName="gap-md px-margin-mobile pt-md" contentContainerStyle={{ paddingBottom: 48 + insets.bottom }} showsVerticalScrollIndicator={false}>
          <RockCard variant="surface" glowColor={Colors.cyan} contentPadding={14}>
            <View className="gap-xs">
              <Text className="font-heading-md uppercase text-cyan" style={{ fontSize: 14, letterSpacing: 1 }}>
                How a run works
              </Text>
              <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                Pay the entry, then beat the house band one set at a time. Each win grows your purse. Between sets you can bank it or push your luck against a stronger bot. Lose a set and the purse is gone; a draw replays the set once.
              </Text>
            </View>
          </RockCard>

          {active ? <ActiveRunCard run={active} busy={busy} onContinue={() => void startNextSet(active.id).then(reload)} onCashOut={() => void cashOut(active)} onRejoin={() => void rejoin(active)} /> : null}

          {festival.tiers.map((tier) => (
            <TierCard key={tier.id} tier={tier} hasActiveRun={!!active} chips={chips} busy={busy === tier.id} onEnter={() => void enter(tier)} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function BotFace({ botId, emoji, size }: { botId: string; emoji: string; size: 'small' | 'medium' }) {
  const portrait = BOT_PORTRAITS[botId];
  return portrait ? <PlayerAvatar source={portrait} size={size} /> : <PlayerAvatar emoji={emoji} size={size} />;
}

function Chips({ value, color = Colors.textPrimary }: { value: number; color?: string }) {
  return (
    <View className="flex-row items-center gap-1">
      <CurrencyIcon type="chips" size={13} />
      <Text style={{ fontFamily: Fonts.heading, fontSize: 12, color }}>{fmt(value)}</Text>
    </View>
  );
}

function ActiveRunCard({ run, busy, onContinue, onCashOut, onRejoin }: { run: FestivalRunView; busy: string | null; onContinue: () => void; onCashOut: () => void; onRejoin: () => void }) {
  const next = run.sets[run.setIndex];
  const playing = run.phase === 'playing';
  return (
    <RockCard variant="surface" glowColor={Colors.gold} contentPadding={14}>
      <View className="gap-md">
        <View className="flex-row items-center justify-between">
          <Text className="font-heading-md uppercase text-gold" style={{ fontSize: 14, letterSpacing: 1 }}>
            Run in progress
          </Text>
          <Text className="font-heading-md text-text-primary" style={{ fontSize: 13 }}>
            {run.setsCleared}/{run.totalSets} sets cleared
          </Text>
        </View>
        <View className="flex-row items-center justify-between">
          <View className="gap-1">
            <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
              BANKED NOW
            </Text>
            <Chips value={run.banked} color={Colors.gold} />
          </View>
          {run.nextPurse !== null ? (
            <View className="items-end gap-1">
              <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                NEXT SET BANKS
              </Text>
              <Chips value={run.nextPurse} />
            </View>
          ) : null}
        </View>
        {next ? (
          <View className="flex-row items-center gap-md">
            <BotFace botId={next.botId} emoji={next.emoji} size="small" />
            <View className="flex-1">
              <Text className="font-heading-md text-text-primary" style={{ fontSize: 15, textTransform: 'uppercase' }}>
                {playing ? 'Set in progress' : `Set ${run.setIndex + 1}: ${next.name}`}
              </Text>
              <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                {BOT_TIER_LABEL[next.difficulty as BotDifficulty] ?? next.difficulty}
                {run.replaysUsed > 0 ? ' · replay used' : ''}
              </Text>
            </View>
          </View>
        ) : null}
        {playing ? (
          <RockButton label={busy === 'rejoin' ? 'Reconnecting…' : 'Rejoin set'} variant="primary" disabled={!!busy} onPress={onRejoin} />
        ) : (
          <View className="gap-sm">
            <RockButton label={`Play set ${run.setIndex + 1}`} variant="primary" disabled={!!busy} onPress={onContinue} />
            {run.canCashOut ? <RockButton label={`Cash out ${fmt(run.banked)}`} variant="reward" disabled={!!busy} onPress={onCashOut} /> : null}
          </View>
        )}
      </View>
    </RockCard>
  );
}

function TierCard({ tier, hasActiveRun, chips, busy, onEnter }: { tier: FestivalTierView; hasActiveRun: boolean; chips: number; busy: boolean; onEnter: () => void }) {
  const locked = !tier.unlocked;
  const accent = locked ? Colors.chromeDark : Colors.cyan;
  const limitReached = tier.runsToday >= tier.dailyRuns;
  const cantAfford = chips < tier.nextEntry;
  const surcharge = tier.nextEntry > tier.entry;

  let action: { label: string; disabled: boolean; note?: string } = { label: `Enter · ${fmt(tier.nextEntry)} chips`, disabled: false };
  if (locked) action = { label: 'Locked', disabled: true, note: `Beat the boss of ${tier.unlockChapterName} in the Tour to unlock.` };
  else if (hasActiveRun) action = { label: 'Finish your current run', disabled: true };
  else if (limitReached) action = { label: 'Back tomorrow', disabled: true, note: `${tier.runsToday}/${tier.dailyRuns} runs played today.` };
  else if (cantAfford) action = { label: `Need ${fmt(tier.nextEntry)} chips`, disabled: true };

  return (
    <RockCard variant="surface" glowColor={accent} contentPadding={14}>
      <View className="gap-md" style={{ opacity: locked ? 0.7 : 1 }}>
        <View className="flex-row items-center justify-between gap-sm">
          <View className="flex-1">
            <Text className="font-display-hero text-text-primary" style={{ fontSize: 22, textTransform: 'uppercase' }} numberOfLines={1}>
              {tier.name}
            </Text>
            <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }} numberOfLines={1}>
              {tier.tagline}
            </Text>
          </View>
          {tier.cleared ? (
            <View className="flex-row items-center gap-1 rounded-full px-sm" style={{ paddingVertical: 2, backgroundColor: withOpacity(Colors.gold, 0.14), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.6) }}>
              <MaterialCommunityIcons name="check-bold" size={11} color={Colors.gold} />
              <Text style={{ fontFamily: Fonts.heading, fontSize: 10, letterSpacing: 1, color: Colors.gold }}>CLEARED</Text>
            </View>
          ) : locked ? (
            <MaterialCommunityIcons name="lock" size={20} color={Colors.chromeMid} />
          ) : null}
        </View>

        {/* The ladder: who you face in each set and what banking after it pays. */}
        <View className="flex-row items-end justify-between">
          {tier.sets.map((set, i) => (
            <View key={`${set.botId}-${i}`} className="items-center gap-1" style={{ flex: 1 }}>
              <BotFace botId={set.botId} emoji={set.emoji} size="small" />
              <Text style={{ fontFamily: Fonts.heading, fontSize: 9, letterSpacing: 0.5, color: Colors.textMuted }} numberOfLines={1}>
                {set.name.toUpperCase()}
              </Text>
              <Chips value={tier.purse[i]} color={i === tier.sets.length - 1 ? Colors.gold : Colors.textPrimary} />
            </View>
          ))}
        </View>

        <View className="flex-row items-center justify-between">
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
            Title: <Text style={{ color: Colors.gold, fontFamily: Fonts.heading }}>{tier.titleName}</Text>
          </Text>
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
            {tier.runsToday}/{tier.dailyRuns} today
          </Text>
        </View>
        {surcharge && !locked && !limitReached ? (
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
            A repeat run today costs {fmt(tier.nextEntry)} (base {fmt(tier.entry)}).
          </Text>
        ) : null}
        {action.note ? (
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
            {action.note}
          </Text>
        ) : null}
        <RockButton label={busy ? 'Entering…' : action.label} variant={action.disabled ? 'secondary' : 'primary'} disabled={action.disabled || busy} onPress={onEnter} />
      </View>
    </RockCard>
  );
}
