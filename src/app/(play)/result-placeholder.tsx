import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, BackHandler, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, CurrencyIcon, CurrencyPill, EmberParticles, RockButton, RockCard, VenueBackdrop } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { useFriends } from '@/hooks/useFriends';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { chargeForAnalysis } from '@/lib/api';
import { ANALYSIS_COST } from '@/lib/analysisCost';
import { getAuthToken } from '@/lib/authStorage';
import { clearPendingLocalReplay, getPendingLocalReplay } from '@/lib/localMatchReplayStore';
import { MATCH_CHIP_REWARDS } from '@/lib/matchRewards';
import { isVenueTier } from '@/lib/onlineMatch';

type Outcome = 'win' | 'loss' | 'draw';

// ELO numbers are still sample/decorative -- rating changes aren't part of
// this pass (chips/gems only). Route/filename kept as result-placeholder
// per the original brief ("replaces result-placeholder.tsx, same route").
const OUTCOME_ELO: Record<Outcome, { eloBefore: number; eloAfter: number }> = {
  win: { eloBefore: 710, eloAfter: 726 },
  loss: { eloBefore: 710, eloAfter: 694 },
  draw: { eloBefore: 710, eloAfter: 710 },
};

const REASON_LABEL: Record<string, string> = {
  checkmate: 'by Checkmate',
  stalemate: 'by Stalemate',
  draw: 'by Draw',
  agreement: 'by Agreement',
  resignation: 'by Resignation',
  timeout: 'by Timeout',
};

function useCountUp(target: number, durationMs = 1200) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const start = Date.now();
    let frame: ReturnType<typeof setTimeout>;

    function tick() {
      const elapsed = Date.now() - start;
      const progress = Math.min(1, elapsed / durationMs);
      const eased = 1 - (1 - progress) ** 3;
      setValue(Math.round(target * eased));
      if (progress < 1) {
        frame = setTimeout(tick, 16);
      }
    }
    tick();

    return () => clearTimeout(frame);
  }, [target, durationMs]);

  return value;
}

export default function ResultScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const {
    outcome: outcomeParam,
    reason,
    chipsGranted: chipsGrantedParam,
    opponentUserId,
    opponentName,
    venueTier: venueTierParam,
  } = useLocalSearchParams<{
    outcome?: string;
    reason?: string;
    chipsGranted?: string;
    opponentUserId?: string;
    opponentName?: string;
    venueTier?: string;
  }>();
  const venueTier = isVenueTier(venueTierParam) ? venueTierParam : 'garage';
  const outcome: Outcome = outcomeParam === 'loss' || outcomeParam === 'draw' ? outcomeParam : 'win';
  const isVictory = outcome === 'win';
  const isDraw = outcome === 'draw';
  // Set by match.tsx's handleGameOver for bot/local outcomes only (online
  // already has a server-backed replay, reached from Iron ID instead) --
  // read once per mount, not on every render, since Home explicitly clears
  // it and we don't want that clear to also blank the button mid-transition.
  const [localReplay] = useState(() => getPendingLocalReplay());
  const { chips: currentChips, refresh: refreshPlayerProfile } = usePlayerProfile();
  const friends = useFriends();

  // The match is gone from the stack (match.tsx used router.replace to get
  // here), so there's nothing valid to go "back" to -- hardware back goes
  // straight Home, same as the Home button.
  useEffect(() => {
    const onBack = () => {
      clearPendingLocalReplay();
      router.replace('/home');
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [router]);
  const [addFriendState, setAddFriendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const canAddOpponent =
    !!opponentUserId &&
    friends.status === 'ready' &&
    !friends.isFriend(opponentUserId) &&
    !friends.hasOutgoingTo(opponentUserId) &&
    addFriendState !== 'sent';

  async function handleAddOpponent() {
    if (!opponentUserId) return;
    setAddFriendState('sending');
    try {
      await friends.addFriend({ userId: opponentUserId });
      setAddFriendState('sent');
    } catch {
      setAddFriendState('error');
    }
  }

  async function handleAnalyzePress() {
    const token = await getAuthToken();
    if (!token) {
      Alert.alert('Sign In Required', 'Sign in to use Game Analysis.');
      return;
    }
    const currency: 'chips' | 'gems' = currentChips >= ANALYSIS_COST.chips ? 'chips' : 'gems';
    const price = ANALYSIS_COST[currency];
    Alert.alert('Analyze This Game', `Get move-by-move analysis for ${price.toLocaleString()} ${currency}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Analyze',
        onPress: async () => {
          try {
            await chargeForAnalysis(token, currency);
            refreshPlayerProfile();
            router.push({ pathname: '/replay', params: { source: 'local', mode: 'analysis' } });
          } catch (error) {
            if (error instanceof Error && error.message === 'insufficient-funds') {
              Alert.alert('Not Enough Currency', `You need ${price.toLocaleString()} ${currency} to analyze this game.`);
            } else {
              console.log('Failed to charge for analysis', error);
              Alert.alert('Something Went Wrong', 'Please try again.');
            }
          }
        },
      },
    ]);
  }

  const { eloBefore, eloAfter } = OUTCOME_ELO[outcome];
  // match.tsx always passes this (the real, just-granted amount) -- the
  // reward table fallback only covers reaching this screen some other way
  // (e.g. direct navigation during development).
  const parsedChipsGranted = Number(chipsGrantedParam);
  const chips = Number.isFinite(parsedChipsGranted) ? parsedChipsGranted : MATCH_CHIP_REWARDS[outcome];
  const chipsWon = useCountUp(chips);
  const eloDelta = eloAfter - eloBefore;
  const reasonLabel = reason ? REASON_LABEL[reason] : undefined;

  const bannerText = isVictory ? 'Victory' : isDraw ? 'Draw' : 'Defeat';
  const bannerColor = isVictory ? Colors.gold : isDraw ? Colors.chrome : Colors.textMuted;
  const bannerGlow = isVictory ? Colors.cyan : isDraw ? Colors.chrome : Colors.crimson;
  const glowColor = isVictory ? Colors.gold : isDraw ? Colors.chrome : Colors.crimson;

  return (
    <View className="flex-1 items-center justify-center gap-xl bg-bg-base px-xl" style={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
      <VenueBackdrop venueTier={venueTier} />
      <EmberParticles count={10} />

      <View className="items-center gap-1">
        <Text className="font-display-hero text-display-hero uppercase tracking-widest" style={{ color: bannerColor, textShadowColor: withOpacity(bannerGlow, 0.5), textShadowRadius: 24, textShadowOffset: { width: 0, height: 0 } }}>
          {bannerText}
        </Text>
        {reasonLabel ? <Text className="font-section-header text-section-header uppercase tracking-wide text-text-muted">{reasonLabel}</Text> : null}
      </View>

      <RockCard glowColor={glowColor} style={{ width: '100%', maxWidth: 360, alignItems: 'center' }}>
        <View className="flex-row items-center gap-sm">
          <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.4) }}>
            <CurrencyIcon type="chips" size={26} />
          </View>
          <Text className="font-display-hero" style={{ fontSize: 28, color: Colors.gold, textShadowColor: withOpacity(Colors.gold, 0.5), textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } }}>
            +{chipsWon.toLocaleString('en-US')}
          </Text>
        </View>

        <View className="mt-md flex-row items-center gap-sm">
          <Text className="font-heading-md" style={{ fontSize: 16, color: Colors.textPrimary }}>
            {eloBefore}
          </Text>
          <AppIcon name="arrow_forward" size={18} color={Colors.textMuted} />
          <Text className="font-heading-md" style={{ fontSize: 16, color: Colors.textPrimary }}>
            {eloAfter}
          </Text>
          {eloDelta !== 0 ? (
            <View
              className="ml-xs flex-row items-center gap-1 rounded-full px-sm"
              style={{ paddingVertical: 2, backgroundColor: withOpacity(eloDelta > 0 ? Colors.cyan : Colors.crimson, 0.12), borderWidth: 1, borderColor: withOpacity(eloDelta > 0 ? Colors.cyan : Colors.crimson, 0.4) }}
            >
              <AppIcon name={eloDelta > 0 ? 'trending_up' : 'trending_down'} size={12} color={eloDelta > 0 ? Colors.cyan : Colors.crimson} />
              <Text className="font-heading-md text-caption" style={{ color: eloDelta > 0 ? Colors.cyan : Colors.crimson }}>
                {eloDelta > 0 ? '+' : ''}
                {eloDelta}
              </Text>
            </View>
          ) : null}
        </View>
      </RockCard>

      <View className="w-full gap-md" style={{ maxWidth: 320 }}>
        {localReplay && localReplay.mode !== 'online' ? (
          <RockButton label="Replay" variant="primary" icon={<AppIcon name="replay" size={20} color={Colors.bgBase} />} onPress={() => router.push({ pathname: '/replay', params: { source: 'local' } })} />
        ) : null}
        {localReplay ? (
          <View className="gap-xs">
            <RockButton label="Analyze Game" variant="cyan" icon={<AppIcon name="analytics" size={20} color={Colors.bgBase} />} onPress={handleAnalyzePress} />
            <View className="flex-row items-center justify-center gap-xs">
              <Text className="font-body-sm text-caption uppercase tracking-wide text-text-muted">Costs</Text>
              <CurrencyPill type="chips" value={ANALYSIS_COST.chips} />
            </View>
          </View>
        ) : null}
        {canAddOpponent ? (
          <RockButton
            label={addFriendState === 'sending' ? 'Sending…' : addFriendState === 'error' ? 'Try Again' : `Add ${opponentName ?? 'Opponent'}`}
            variant="secondary"
            icon={<AppIcon name="person_add" size={18} color={Colors.textPrimary} />}
            disabled={addFriendState === 'sending'}
            onPress={handleAddOpponent}
          />
        ) : addFriendState === 'sent' || (opponentUserId && friends.hasOutgoingTo(opponentUserId)) ? (
          <View className="flex-row items-center justify-center gap-xs">
            <AppIcon name="check" size={16} color={withOpacity(Colors.cyan, 0.8)} />
            <Text className="font-body-sm text-caption uppercase tracking-wide text-text-muted">Friend request sent</Text>
          </View>
        ) : null}
        <RockButton
          label="Home"
          variant="reward"
          icon={<AppIcon name="home" size={20} color={Colors.bgBase} />}
          onPress={() => {
            console.log('Home pressed from result screen');
            // Explicit "going back" -- the one point the temporary bot/local
            // replay data gets deleted (no-ops harmlessly if there was none).
            clearPendingLocalReplay();
            router.replace('/home');
          }}
        />
      </View>

      {isVictory ? (
        <Pressable onPress={() => console.log('Share this win pressed')} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
          <Text className="font-body-sm text-body-sm text-text-muted" style={{ textDecorationLine: 'underline' }}>
            Share this win
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
