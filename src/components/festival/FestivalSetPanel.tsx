import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';

import { CurrencyIcon, PlayerAvatar, RockButton, RockCard } from '@/components/ui';
import { BOT_PORTRAITS, BOT_TIER_LABEL } from '@/constants/bots';
import { Colors, Fonts, withOpacity } from '@/constants/theme';
import type { BotDifficulty } from '@/hooks/useChessGame';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { cashOutFestival } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { celebrate } from '@/lib/celebration';
import { reportError } from '@/lib/crashReporting';
import { FESTIVAL_ERROR_COPY, festivalMatchParams, getFestivalUpdate, startFestivalSet, subscribeFestival, type FestivalUpdate } from '@/lib/festival';
import type { QueueMatchedPayload } from '@/lib/onlineMatch';

const fmt = (n: number) => n.toLocaleString('en-US');

// The "Set Break" on the result screen after a Festival set: what the set did to the run
// (the server's `festival:update`, cached in lib/festival.ts) and the one decision the
// player has to make -- bank the purse or play the next, stronger set.
export function FestivalSetPanel({ matchId }: { matchId: string }) {
  const router = useRouter();
  const { refresh } = usePlayerProfile();
  const [update, setUpdate] = useState<FestivalUpdate | undefined>(() => getFestivalUpdate(matchId));
  const [timedOut, setTimedOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cashed, setCashed] = useState<number | null>(null);

  useEffect(() => {
    const cached = getFestivalUpdate(matchId);
    if (cached) setUpdate(cached);
    const unsubscribe = subscribeFestival((next) => {
      if (next.matchId !== matchId) return;
      setUpdate(next);
      refresh();
    });
    const timer = setTimeout(() => {
      setTimedOut(true);
      refresh();
    }, 6000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [matchId, refresh]);

  const run = update?.run;

  // The "Run over" moment: the purse is gone. Once per panel (this screen mounts per finished set), whether the
  // update was already cached or arrives a moment later.
  const lost = update?.kind === 'lost';
  useEffect(() => {
    if (lost) celebrate('runOver');
  }, [lost]);

  function openSet(payload: QueueMatchedPayload) {
    router.replace({ pathname: '/match', params: festivalMatchParams(payload) });
  }

  async function playNext() {
    if (!run || busy) return;
    setBusy(true);
    try {
      const result = await startFestivalSet(run.id, openSet);
      if (!result.ok) Alert.alert('Could not start the set', FESTIVAL_ERROR_COPY[result.reason] ?? FESTIVAL_ERROR_COPY.unavailable);
    } finally {
      setBusy(false);
    }
  }

  async function cashOut() {
    if (!run || busy) return;
    const token = await getAuthToken();
    if (!token) return;
    setBusy(true);
    try {
      const result = await cashOutFestival(token, run.id);
      setCashed(result.payout);
      refresh();
    } catch (error) {
      reportError(error, { area: 'festival-cash-out' });
      Alert.alert('Could not cash out', 'Please try again from the Festival screen.');
    } finally {
      setBusy(false);
    }
  }

  const toFestival = <RockButton label="Back to Festival" variant="primary" onPress={() => router.replace('/festival')} />;

  let accent: string = Colors.cyan;
  let heading = 'Settling the set…';
  let body: string | null = null;
  let actions: React.ReactNode = null;
  const next = run && run.setIndex < run.sets.length ? run.sets[run.setIndex] : null;

  if (cashed !== null) {
    accent = Colors.gold;
    heading = 'Purse banked';
    body = `+${fmt(cashed)} chips added to your balance.`;
    actions = toFestival;
  } else if (!update || !run) {
    if (timedOut) {
      heading = 'Set recorded';
      body = 'We could not confirm the result yet. Open the Festival to see where your run stands.';
      actions = toFestival;
    }
  } else if (update.kind === 'advance' || update.kind === 'replay') {
    accent = update.kind === 'advance' ? Colors.gold : Colors.chrome;
    heading = update.kind === 'advance' ? `Set ${run.setsCleared} cleared` : 'Draw: replay the set';
    body =
      update.kind === 'advance'
        ? `Bank now: ${fmt(run.banked)} chips. Clear the next set to bank ${run.nextPurse !== null ? fmt(run.nextPurse) : 'the full purse'}. Lose it and the purse is gone.`
        : 'A draw replays this set once. A second draw ends the run.';
    actions = (
      <View className="gap-sm">
        <RockButton label={busy ? 'Starting…' : update.kind === 'advance' ? `Next set${next ? `: ${next.name}` : ''}` : 'Replay set'} variant="primary" disabled={busy} onPress={playNext} />
        {run.canCashOut ? <RockButton label={`Cash out ${fmt(run.banked)}`} variant="reward" disabled={busy} onPress={cashOut} /> : null}
      </View>
    );
  } else if (update.kind === 'cleared') {
    accent = Colors.gold;
    heading = 'Run cleared!';
    body = `Full purse paid: +${fmt(update.payout ?? 0)} chips.${update.titleUnlocked ? ` New title: ${update.titleUnlocked.name}.` : ''}`;
    actions = toFestival;
  } else if (update.kind === 'lost') {
    accent = Colors.crimson;
    heading = 'Run over';
    body = `The purse is gone. Your ${fmt(run.entryPaid)} chip entry is spent.`;
    actions = toFestival;
  } else {
    accent = Colors.chrome;
    heading = update.how === 'cashed' ? 'Run interrupted: purse paid' : 'Run interrupted: entry refunded';
    body = update.how === 'cashed' ? `The server restarted mid-set. Your banked ${fmt(update.payout ?? 0)} chips were paid.` : `The server restarted mid-set. Your ${fmt(update.payout ?? 0)} chip entry was returned.`;
    actions = toFestival;
  }

  return (
    <RockCard variant="surface" glowColor={accent} contentPadding={14} style={{ width: '100%', maxWidth: 360 }}>
      <View className="gap-md">
        <View className="flex-row items-center gap-sm">
          <MaterialCommunityIcons name="ticket-confirmation" size={18} color={accent} />
          <Text style={{ fontFamily: Fonts.heading, fontSize: 14, letterSpacing: 1, textTransform: 'uppercase', color: accent }}>{heading}</Text>
        </View>
        {body ? (
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
            {body}
          </Text>
        ) : null}
        {cashed === null && run && (update?.kind === 'advance' || update?.kind === 'replay') && next ? (
          <View className="flex-row items-center gap-md rounded-lg p-sm" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) }}>
            {BOT_PORTRAITS[next.botId] ? <PlayerAvatar source={BOT_PORTRAITS[next.botId]} size="small" /> : <PlayerAvatar emoji={next.emoji} size="small" />}
            <View className="flex-1">
              <Text className="font-heading-md text-text-primary" style={{ fontSize: 14, textTransform: 'uppercase' }}>
                Up next: {next.name}
              </Text>
              <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                {BOT_TIER_LABEL[next.difficulty as BotDifficulty] ?? next.difficulty}
              </Text>
            </View>
            <View className="items-end">
              <CurrencyIcon type="chips" size={14} />
              <Text style={{ fontFamily: Fonts.heading, fontSize: 12, color: Colors.textPrimary }}>{run.nextPurse !== null ? fmt(run.nextPurse) : ''}</Text>
            </View>
          </View>
        ) : null}
        {actions}
      </View>
    </RockCard>
  );
}
