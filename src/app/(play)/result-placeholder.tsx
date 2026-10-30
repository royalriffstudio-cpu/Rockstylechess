import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ShowReport } from '@/components/progression/ShowReport';
import { AppIcon, CurrencyIcon, CurrencyPill, RockButton, RockCard, VenueBackdrop } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { useAdsEnabled } from '@/hooks/useAdsEnabled';
import { useFriends } from '@/hooks/useFriends';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { recordMatchCompleted } from '@/lib/ads/adFrequency';
import { maybeShowInterstitial } from '@/lib/ads/maybeShowInterstitial';
import { chargeForAnalysis } from '@/lib/api';
import { ANALYSIS_COST } from '@/lib/analysisCost';
import { getAuthToken } from '@/lib/authStorage';
import { clearPendingLocalReplay, getPendingLocalReplay } from '@/lib/localMatchReplayStore';
import { MATCH_CHIP_REWARDS } from '@/lib/matchRewards';
import { isVenueTier, type WagerSettledPayload } from '@/lib/onlineMatch';
import { getReport, subscribeReports } from '@/lib/progression';
import { getWagerResult, subscribeWagerResult } from '@/lib/wagerResult';

type Outcome = 'win' | 'loss' | 'draw';

const REASON_LABEL: Record<string, string> = {
  checkmate: 'by Checkmate',
  stalemate: 'by Stalemate',
  draw: 'by Draw',
  agreement: 'by Agreement',
  resignation: 'by Resignation',
  timeout: 'by Timeout',
  repetition: 'by Repetition',
  fiftyMove: 'by the 50-Move Rule',
  insufficient: 'by Insufficient Material',
  insufficientTimeout: 'Time Out vs. Insufficient Material',
  forfeit: 'by Forfeit',
  serverRestart: 'Server Restarted',
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
    myPoints: myPointsParam,
    oppPoints: oppPointsParam,
    opponentUserId,
    opponentName,
    venueTier: venueTierParam,
    reportKey,
    matchMode,
    noReward,
    wagerMatchId,
    buyIn: buyInParam,
    prize: prizeParam,
  } = useLocalSearchParams<{
    outcome?: string;
    reason?: string;
    chipsGranted?: string;
    myPoints?: string;
    oppPoints?: string;
    opponentUserId?: string;
    opponentName?: string;
    venueTier?: string;
    // Set by match.tsx for a WAGERED online match: the settlement arrives from the
    // server as wager:settled (see lib/wagerResult.ts).
    // Where this match's Show Report comes from (online match id or a bot report key),
    // and which kind of match it was ('local' pass-and-play pays and counts nothing).
    reportKey?: string;
    matchMode?: string;
    // Why a bot match paid nothing (guest, too short, could not be verified, offline).
    noReward?: string;
    wagerMatchId?: string;
    buyIn?: string;
    prize?: string;
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

  // Wagered match: show the server's settlement, not the flat reward. It usually
  // landed before we got here (cached), otherwise it arrives within moments; if it
  // has not after a few seconds say so and refresh the balance instead of hanging.
  const [wager, setWager] = useState<WagerSettledPayload | undefined>(() =>
    wagerMatchId ? getWagerResult(wagerMatchId) : undefined,
  );
  const [wagerTimedOut, setWagerTimedOut] = useState(false);
  useEffect(() => {
    if (!wagerMatchId) return;
    const cached = getWagerResult(wagerMatchId);
    if (cached) setWager(cached);
    const unsubscribe = subscribeWagerResult((payload) => {
      if (payload.matchId !== wagerMatchId) return;
      setWager(payload);
      refreshPlayerProfile();
    });
    const timer = setTimeout(() => {
      setWagerTimedOut(true);
      refreshPlayerProfile();
    }, 4000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [wagerMatchId, refreshPlayerProfile]);
  const wagered = !!wagerMatchId;
  const buyIn = Number(buyInParam) || 0;
  const prize = Number(prizeParam) || 0;
  const isLocalMatch = matchMode === 'local';

  // The Show Report: Fame earned, level bar, real rating change, goals moved. It
  // usually arrives within a moment of the match ending (socket push for online,
  // the HTTP reply for bots); if it has not after 6 s say so instead of hanging.
  const [report, setReport] = useState(() => (reportKey ? getReport(reportKey) : undefined));
  const [reportTimedOut, setReportTimedOut] = useState(false);
  useEffect(() => {
    if (!reportKey) return;
    const cached = getReport(reportKey);
    if (cached) setReport(cached);
    const unsubscribe = subscribeReports((key, next) => {
      if (key === reportKey) setReport(next);
    });
    const timer = setTimeout(() => setReportTimedOut(true), 6000);
    return () => {
      unsubscribe();
      clearTimeout(timer);
    };
  }, [reportKey]);

  const adsEnabled = useAdsEnabled();
  const leavingRef = useRef(false);

  // Counts toward the interstitial pacing (every 3rd finished match).
  useEffect(() => {
    void recordMatchCompleted();
  }, []);

  // The one exit from this screen: the player has seen the result and chosen to
  // leave, which is the natural pause for an interstitial (never mid-game, never
  // between handleGameOver and this screen -- match.tsx's reward claims depend on
  // that timing). Navigation ALWAYS happens, ad or not; leavingRef stops a
  // double tap from queueing two exits while an ad is up.
  const goHome = useCallback(async () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    await maybeShowInterstitial('result-exit', adsEnabled);
    // Explicit "going back" -- the one point the temporary bot/local replay
    // data gets deleted (no-ops harmlessly if there was none).
    clearPendingLocalReplay();
    router.replace('/home');
  }, [adsEnabled, router]);

  // The match is gone from the stack (match.tsx used router.replace to get
  // here), so there's nothing valid to go "back" to -- hardware back goes
  // straight Home, same as the Home button.
  useEffect(() => {
    const onBack = () => {
      void goHome();
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, [goHome]);
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

  // match.tsx always passes this (the real, just-granted amount) -- the
  // reward table fallback only covers reaching this screen some other way
  // (e.g. direct navigation during development).
  // Piece values each side captured (match.tsx). Absent -> no line at all.
  const myPoints = myPointsParam !== undefined ? Number(myPointsParam) : NaN;
  const oppPoints = oppPointsParam !== undefined ? Number(oppPointsParam) : NaN;
  const showPoints = Number.isFinite(myPoints) && Number.isFinite(oppPoints);
  const parsedChipsGranted = Number(chipsGrantedParam);
  const chips = Number.isFinite(parsedChipsGranted) ? parsedChipsGranted : MATCH_CHIP_REWARDS[outcome];
  const chipsWon = useCountUp(wagered ? Math.abs(wager?.net ?? 0) : chips);
  const reasonLabel = reason ? REASON_LABEL[reason] : undefined;

  // A wagered match that was voided (someone left in the first 3 moves) was not a
  // contest at all: the stakes came back and nothing counted.
  const isVoid = wager?.outcome === 'void';
  const bannerText = isVoid ? 'No Contest' : isVictory ? 'Victory' : isDraw ? 'Draw' : 'Defeat';
  const bannerColor = isVoid ? Colors.chrome : isVictory ? Colors.gold : isDraw ? Colors.chrome : Colors.textMuted;
  const bannerGlow = isVoid ? Colors.chrome : isVictory ? Colors.cyan : isDraw ? Colors.chrome : Colors.crimson;
  const glowColor = isVoid ? Colors.chrome : isVictory ? Colors.gold : isDraw ? Colors.chrome : Colors.crimson;

  return (
    <View className="flex-1 bg-bg-base">
      <VenueBackdrop venueTier={venueTier} />
      {/* Scrolls only when the Show Report makes the content taller than a small
          phone; otherwise it stays the same centred column as before. */}
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingHorizontal: 24, paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        showsVerticalScrollIndicator={false}
      >

      <View className="items-center gap-1">
        <Text className="font-display-hero text-display-hero uppercase tracking-widest" style={{ color: bannerColor, textShadowColor: withOpacity(bannerGlow, 0.5), textShadowRadius: 24, textShadowOffset: { width: 0, height: 0 } }}>
          {bannerText}
        </Text>
        {reasonLabel ? <Text className="font-section-header text-section-header uppercase tracking-wide text-text-muted">{reasonLabel}</Text> : null}
      </View>

      <RockCard glowColor={glowColor} style={{ width: '100%', maxWidth: 360, alignItems: 'center' }}>
        <View className="flex-row items-center gap-sm" style={isLocalMatch ? { display: 'none' } : undefined}>
          <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.4) }}>
            <CurrencyIcon type="chips" size={26} />
          </View>
          {wagered ? (
            wager ? (
              <Text
                className="font-display-hero"
                style={{
                  fontSize: 28,
                  color: wager.refunded ? Colors.chrome : wager.net > 0 ? Colors.gold : Colors.crimson,
                }}
              >
                {wager.refunded ? '±0' : wager.net > 0 ? '+' : '-'}
                {wager.refunded ? '' : chipsWon.toLocaleString('en-US')}
              </Text>
            ) : (
              <Text className="font-heading-md" style={{ fontSize: 16, color: Colors.textMuted }}>
                {wagerTimedOut ? 'Stake settled' : 'Settling…'}
              </Text>
            )
          ) : (
            <Text className="font-display-hero" style={{ fontSize: 28, color: Colors.gold, textShadowColor: withOpacity(Colors.gold, 0.5), textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } }}>
              +{chipsWon.toLocaleString('en-US')}
            </Text>
          )}
        </View>

        {wagered ? (
          <Text className="mt-xs text-center font-caption text-caption text-text-muted">
            {wager
              ? isVoid
                ? 'You left in the first 3 moves. Both buy-ins were returned and nothing counted.'
                : wager.refunded
                  ? `Draw. Your ${wager.buyIn.toLocaleString('en-US')} buy-in was returned.`
                  : `Pot ${wager.pot.toLocaleString('en-US')} · 10% house cut · balance ${wager.chipsAfter.toLocaleString('en-US')}`
              : wagerTimedOut
                ? `Your ${buyIn.toLocaleString('en-US')} buy-in is settled — check your balance.`
                : `Buy-in ${buyIn.toLocaleString('en-US')} · winner takes ${prize.toLocaleString('en-US')}`}
          </Text>
        ) : null}

        {/* A voided wager changed no rating, so the (sample) rating row is hidden. */}
        {noReward ? (
          <Text className="mt-sm text-center font-caption text-caption text-text-muted">
            {noReward === 'guest'
              ? 'Sign in to earn chips and Fame from bot matches.'
              : noReward === 'too-short'
                ? 'That game was too short to count for rewards.'
                : noReward === 'offline'
                  ? "We couldn't reach the server, so this game wasn't counted."
                  : "This game couldn't be verified, so it earned nothing."}
          </Text>
        ) : null}
        {/* A voided wager changed nothing, and pass-and-play counts for nothing. */}
        {reportKey && !isVoid && !isLocalMatch ? <ShowReport report={report} timedOut={reportTimedOut} /> : null}

        {showPoints ? (
          <Text className="mt-sm font-caption text-caption text-text-muted">
            Captured {myPoints} pts · Lost {oppPoints} pts
          </Text>
        ) : null}
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
              <Text className="font-body-sm text-caption uppercase tracking-wide text-text-muted">or</Text>
              <CurrencyPill type="gems" value={ANALYSIS_COST.gems} />
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
            void goHome();
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
      </ScrollView>
    </View>
  );
}
