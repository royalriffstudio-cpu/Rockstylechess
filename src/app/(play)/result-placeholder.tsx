import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FestivalSetPanel } from '@/components/festival/FestivalSetPanel';
import { PushPrimer } from '@/components/match/PushPrimer';
import { RematchPanel } from '@/components/match/RematchPanel';
import { PlayerProfileSheet } from '@/components/social/PlayerProfileSheet';
import { ShowReport } from '@/components/progression/ShowReport';
import { AppIcon, CurrencyIcon, CurrencyPill, RockButton, RockCard, VenueBackdrop } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { useAdsEnabled } from '@/hooks/useAdsEnabled';
import { useFriends } from '@/hooks/useFriends';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { recordMatchCompleted } from '@/lib/ads/adFrequency';
import { maybeShowInterstitial } from '@/lib/ads/maybeShowInterstitial';
import { buyAnalysisPack, chargeForAnalysis } from '@/lib/api';
import { ANALYSIS_COST, ANALYSIS_PACK, packSavings } from '@/lib/analysisCost';
import { getAuthToken } from '@/lib/authStorage';
import { reportError } from '@/lib/crashReporting';
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
    friendly,
    rematchBot: rematchBotParam,
    rematchMatchId,
    festivalMatchId,
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
    // Friend challenge / private room: unrated, no chips, no Show Report.
    friendly?: string;
    // Bot games: JSON of what is needed to start the same bot again (match.tsx). Absent = no rematch.
    rematchBot?: string;
    // Online games: the finished match's id, which names the server's rematch window (RematchPanel).
    rematchMatchId?: string;
    // Set by match.tsx for a Festival set: the Set Break panel reads the run's update by match id.
    festivalMatchId?: string;
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
  const { chips: currentChips, gems: currentGems, profile: myProfile, refresh: refreshPlayerProfile } = usePlayerProfile();
  // Game Reviews already bought in a Review Pack: spent before any chips/gems.
  const reviewCredits = myProfile?.analysisCredits ?? 0;
  const friends = useFriends();
  // Tap the opponent to see who they are (rating, record, your head-to-head).
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

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
  const isFestivalSet = !!festivalMatchId;
  const isFriendly = friendly === '1';

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

  // Pays for one review (a stored credit, chips or gems) and opens the analysis.
  async function analyzeWith(token: string, currency: 'chips' | 'gems' | 'credit') {
    try {
      await chargeForAnalysis(token, currency);
      refreshPlayerProfile();
      router.push({ pathname: '/replay', params: { source: 'local', mode: 'analysis' } });
    } catch (error) {
      if (error instanceof Error && error.message === 'insufficient-funds') {
        Alert.alert('Not Enough Currency', currency === 'credit' ? 'You have no stored reviews left.' : `You need ${ANALYSIS_COST[currency].toLocaleString()} ${currency} to analyze this game.`);
      } else {
        reportError(error, { area: 'analysis-charge' });
        Alert.alert('Something Went Wrong', 'Please try again.');
      }
    }
  }

  // Buys a Review Pack, then uses its first review on this game (the player pressed Analyze).
  async function buyPackAndAnalyze(token: string, currency: 'chips' | 'gems') {
    try {
      await buyAnalysisPack(token, currency);
      await analyzeWith(token, 'credit');
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      if (code === 'insufficient-funds') Alert.alert('Not Enough Currency', `A ${ANALYSIS_PACK.reviews}-Review Pack costs ${ANALYSIS_PACK[currency].toLocaleString()} ${currency}.`);
      else if (code === 'stock-full') Alert.alert('Reviews Full', `You can hold up to ${ANALYSIS_PACK.maxCredits} stored reviews. Use a few first.`);
      else Alert.alert('Something Went Wrong', 'Please try again.');
    }
  }

  // Rematch (bot games): the same bot, colours swapped, same time control, a fresh verified session.
  // Validated here because it arrives as a route param. No interstitial: the player is asking to keep playing.
  const rematchBot = useMemo(() => {
    if (!rematchBotParam) return null;
    try {
      const r = JSON.parse(rematchBotParam) as Record<string, unknown>;
      const okDifficulty = ['easy', 'medium', 'stockfish-basic', 'stockfish-lite', 'stockfish-strong'].includes(String(r.difficulty));
      if (typeof r.botId !== 'string' || !okDifficulty || (r.color !== 'w' && r.color !== 'b')) return null;
      return {
        botId: r.botId,
        botName: String(r.botName ?? ''),
        botEmoji: String(r.botEmoji ?? ''),
        difficulty: String(r.difficulty),
        color: r.color as 'w' | 'b',
        duration: ['3m', '5m', '10m'].includes(String(r.duration)) ? String(r.duration) : '5m',
        venueTier: String(r.venueTier ?? 'garage'),
      };
    } catch {
      return null;
    }
  }, [rematchBotParam]);

  function handleBotRematch() {
    if (!rematchBot || leavingRef.current) return;
    leavingRef.current = true;
    clearPendingLocalReplay();
    router.replace({
      pathname: '/match',
      params: {
        mode: 'bot',
        difficulty: rematchBot.difficulty,
        botName: rematchBot.botName,
        botId: rematchBot.botId,
        botEmoji: rematchBot.botEmoji,
        color: rematchBot.color === 'w' ? 'b' : 'w',
        duration: rematchBot.duration,
        venueTier: rematchBot.venueTier,
      },
    });
  }

  async function handleAnalyzePress() {
    const token = await getAuthToken();
    if (!token) {
      Alert.alert('Sign In Required', 'Sign in to use Game Analysis.');
      return;
    }
    // Reviews you already bought are used first.
    if (reviewCredits > 0) {
      Alert.alert('Analyze This Game', `Use 1 of your ${reviewCredits} stored reviews on this game? (${reviewCredits - 1} left after.)`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Analyze', onPress: () => void analyzeWith(token, 'credit') },
      ]);
      return;
    }
    const currency: 'chips' | 'gems' = currentChips >= ANALYSIS_COST.chips ? 'chips' : 'gems';
    const price = ANALYSIS_COST[currency];
    // The pack in whichever currency the player can cover (chips first); not offered if neither.
    const packCurrency: 'chips' | 'gems' | null = currentChips >= ANALYSIS_PACK.chips ? 'chips' : currentGems >= ANALYSIS_PACK.gems ? 'gems' : null;
    const pack = packCurrency ? packSavings(packCurrency) : null;
    const buttons = [
      { text: 'Cancel', style: 'cancel' as const },
      ...(packCurrency && pack
        ? [{ text: `Buy ${ANALYSIS_PACK.reviews}-Pack`, onPress: () => void buyPackAndAnalyze(token, packCurrency) }]
        : []),
      { text: 'Analyze', onPress: () => void analyzeWith(token, currency) },
    ];
    Alert.alert(
      'Analyze This Game',
      `Get move-by-move analysis for ${price.toLocaleString()} ${currency}?` +
        (packCurrency && pack
          ? `\n\nOr buy a ${ANALYSIS_PACK.reviews}-Review Pack for ${ANALYSIS_PACK[packCurrency].toLocaleString()} ${packCurrency} (${pack.each.toLocaleString()} each, save ${pack.percent}%) and use the first one on this game.`
          : ''),
      buttons,
    );
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
        <View className="flex-row items-center gap-sm" style={isLocalMatch || isFestivalSet || isFriendly ? { display: 'none' } : undefined}>
          <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.4) }}>
            <CurrencyIcon type="chips" size={26} />
          </View>
          {wagered ? (
            wager ? (
              <Text
                className="font-display-hero"
                style={{
                  fontSize: 28,
                  color: wager.net === 0 ? Colors.chrome : wager.net > 0 ? Colors.gold : Colors.crimson,
                }}
              >
                {wager.net === 0 ? '±0' : wager.net > 0 ? '+' : '-'}
                {wager.net === 0 ? '' : chipsWon.toLocaleString('en-US')}
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

        {isFriendly ? (
          <Text className="text-center font-section-header text-section-header uppercase tracking-wide text-text-muted">
            Friendly match · no rating or rewards
          </Text>
        ) : null}

        {wagered ? (
          <Text className="mt-xs text-center font-caption text-caption text-text-muted">
            {wager
              ? isVoid
                ? 'You left in the first 3 moves. Both buy-ins were returned and nothing counted.'
                : wager.refunded
                  ? `Draw. Your ${wager.buyIn.toLocaleString('en-US')} buy-in was returned.${wager.insurance ? ` The ${wager.insurance.premium.toLocaleString('en-US')} Safety Net premium was spent.` : ''}`
                  : wager.insurance && wager.insurance.refund > 0
                    ? `The Safety Net paid back ${wager.insurance.refund.toLocaleString('en-US')} of your ${wager.buyIn.toLocaleString('en-US')} buy-in · balance ${wager.chipsAfter.toLocaleString('en-US')}`
                    : `Pot ${wager.pot.toLocaleString('en-US')} · 10% house cut${wager.insurance ? ` · ${wager.insurance.premium.toLocaleString('en-US')} Safety Net premium` : ''} · balance ${wager.chipsAfter.toLocaleString('en-US')}`
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

      {festivalMatchId ? <FestivalSetPanel matchId={festivalMatchId} /> : null}

      <View className="w-full gap-md" style={{ maxWidth: 320 }}>
        {rematchBot && !isFestivalSet ? (
          <RockButton
            label={`Rematch · play ${rematchBot.color === 'w' ? 'Black' : 'White'}`}
            variant="gold"
            icon={<AppIcon name="swords" size={20} color={Colors.bgBase} />}
            onPress={handleBotRematch}
          />
        ) : null}
        {rematchMatchId && matchMode === 'online' && !isFestivalSet ? (
          <RematchPanel
            matchId={rematchMatchId}
            opponentName={opponentName ?? 'Opponent'}
            venueTier={venueTier}
            buyIn={buyIn}
            wager={wager}
            onStart={() => {
              leavingRef.current = true;
              clearPendingLocalReplay();
            }}
          />
        ) : null}
        {localReplay && localReplay.mode !== 'online' ? (
          <RockButton label="Replay" variant="primary" icon={<AppIcon name="replay" size={20} color={Colors.bgBase} />} onPress={() => router.push({ pathname: '/replay', params: { source: 'local' } })} />
        ) : null}
        {localReplay ? (
          <View className="gap-xs">
            <RockButton label="Analyze Game" variant="cyan" icon={<AppIcon name="analytics" size={20} color={Colors.bgBase} />} onPress={handleAnalyzePress} />
            {reviewCredits > 0 ? (
              <Text className="text-center font-body-sm text-caption uppercase tracking-wide text-text-muted">
                {reviewCredits} stored review{reviewCredits === 1 ? '' : 's'} · no charge
              </Text>
            ) : (
              <View className="items-center gap-xs">
                <View className="flex-row items-center justify-center gap-xs">
                  <Text className="font-body-sm text-caption uppercase tracking-wide text-text-muted">Costs</Text>
                  <CurrencyPill type="chips" value={ANALYSIS_COST.chips} />
                  <Text className="font-body-sm text-caption uppercase tracking-wide text-text-muted">or</Text>
                  <CurrencyPill type="gems" value={ANALYSIS_COST.gems} />
                </View>
                <Text className="text-center font-body-sm text-caption text-text-muted">
                  {ANALYSIS_PACK.reviews}-pack: {ANALYSIS_PACK.chips.toLocaleString('en-US')} chips · save {packSavings('chips').percent}%
                </Text>
              </View>
            )}
          </View>
        ) : null}
        {opponentUserId ? (
          <Pressable onPress={() => setProfileUserId(opponentUserId)} hitSlop={10}>
            <Text className="text-center font-body-sm text-text-muted" style={{ fontSize: 12, textDecorationLine: 'underline' }}>
              View {opponentName ?? 'opponent'}&apos;s profile
            </Text>
          </Pressable>
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

      <View className="w-full" style={{ maxWidth: 320 }}>
        <PushPrimer />
      </View>

      {isVictory ? (
        <Pressable onPress={() => console.log('Share this win pressed')} hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}>
          <Text className="font-body-sm text-body-sm text-text-muted" style={{ textDecorationLine: 'underline' }}>
            Share this win
          </Text>
        </Pressable>
      ) : null}
      </ScrollView>
      <PlayerProfileSheet userId={profileUserId} fallbackName={opponentName} onClose={() => setProfileUserId(null)} />
    </View>
  );
}
