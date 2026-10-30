import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { CurrencyIcon, CurrencyPill, PlayerAvatar, ProgressBar, RockButton, RockCard } from '@/components/ui';
import { BOT_PORTRAITS, BOT_TIER_LABEL, ROSTER } from '@/constants/bots';
import { CHAPTER_BADGES, TOUR_MAP, TOUR_MAP_ASPECT, TOUR_MAP_NODES } from '@/constants/emblems';
import { Colors, Fonts, withOpacity } from '@/constants/theme';
import { getVenue } from '@/constants/venues';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { useTour } from '@/hooks/useTour';
import type { BotDifficulty } from '@/hooks/useChessGame';
import { startBotMatch, type TourChapter } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

const NODE = 58; // chapter badge size on the map

// The Tour: the campaign through the six venues, drawn as one road from the Garage up
// to the World Tour stage. Each stop is a chapter with five gigs (small goals any match
// can advance) and a boss bot; beating the boss unlocks the next stop. Everything shown
// is the server's view (GET /me/tour); starting a boss fight is just an ordinary bot
// match against that boss, which the server recognises by the bot id when the
// finished game is verified.
export default function TourScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status, gems, chips, refresh: refreshProfile } = usePlayerProfile();
  const { tour, error, reload } = useTour();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Roadie Kit opt-in for the next boss fight (each fight asks again), and the purchase in flight.
  const [kitOn, setKitOn] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const panelY = useRef(0);

  // Start on the chapter the player is actually working on.
  useEffect(() => {
    if (!tour || selectedId) return;
    const active = tour.chapters.find((c) => c.unlocked && !c.bossBeaten) ?? tour.chapters[tour.chapters.length - 1];
    setSelectedId(active.id);
  }, [tour, selectedId]);

  async function challenge(botId: string, chapter: TourChapter) {
    const bot = ROSTER.find((b) => b.id === botId);
    if (!bot || launching) return;
    const params = { mode: 'bot', difficulty: bot.difficulty, botName: bot.name, botId: bot.id, botEmoji: bot.emoji, color: 'w', duration: '5m', venueTier: chapter.venue };
    if (!kitOn || !chapter.backstage?.kitOpen) {
      router.push({ pathname: '/match', params });
      return;
    }
    // The kit is bought HERE, when the fight is launched: the server takes the chips and opens
    // the boss session in one step, and the match screen reuses that session.
    setLaunching(true);
    setLaunchError(null);
    try {
      const token = await getAuthToken();
      if (!token) throw new Error('signed-out');
      const started = await startBotMatch(token, bot.id, 'w', true);
      void refreshProfile();
      setKitOn(false);
      router.push({
        pathname: '/match',
        params: { ...params, sessionId: started.sessionId, kitTakeTwos: String(started.kit?.takeTwos ?? 0), kitTips: String(started.kit?.tips ?? 0) },
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      setLaunchError(
        code === 'insufficient-chips'
          ? 'Not enough chips for the Roadie Kit.'
          : code === 'kit-locked'
            ? 'The Roadie Kit is not open yet. Keep fighting.'
            : 'Couldn\'t open the Roadie Kit. Try again, or fight without it.',
      );
      void reload();
    } finally {
      setLaunching(false);
    }
  }

  function select(id: string) {
    setSelectedId(id);
    setKitOn(false);
    setLaunchError(null);
    // Bring the details into view (they sit below the map).
    setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, panelY.current - 8), animated: true }), 60);
  }

  const chaptersDone = tour?.chapters.filter((c) => c.bossBeaten).length ?? 0;
  const selected = tour?.chapters.find((c) => c.id === selectedId);
  const selectedIndex = tour && selected ? tour.chapters.indexOf(selected) : -1;

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="The Tour" trailing={<CurrencyPill type="gems" value={gems} />} />

      {status === 'guest' ? (
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <MaterialCommunityIcons name="map-marker-path" size={56} color={Colors.textMuted} />
          <Text className="text-center font-body-base text-body-base text-text-muted">Sign in to take the Tour. Your gigs and bosses are saved to your account.</Text>
          <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
        </View>
      ) : !tour ? (
        error ? (
          <View className="flex-1 items-center justify-center gap-md">
            <Text className="font-body-base text-body-base text-text-muted">Couldn&apos;t load the Tour.</Text>
            <RockButton label="Retry" variant="primary" onPress={() => void reload()} />
          </View>
        ) : (
          <ActivityIndicator color={Colors.cyan} style={{ marginTop: 48 }} />
        )
      ) : (
        <ScrollView ref={scrollRef} contentContainerClassName="gap-md px-margin-mobile pt-md" contentContainerStyle={{ paddingBottom: 48 + insets.bottom }} showsVerticalScrollIndicator={false}>
          <RockCard variant="surface" glowColor={Colors.gold} contentPadding={14}>
            <View className="gap-sm">
              <View className="flex-row items-center justify-between">
                <Text className="font-heading-md uppercase text-gold" style={{ fontSize: 14, letterSpacing: 1 }}>
                  Road to the World Tour
                </Text>
                <Text className="font-heading-md text-text-primary" style={{ fontSize: 13 }}>
                  {chaptersDone}/{tour.chapters.length} chapters
                </Text>
              </View>
              <ProgressBar progress={tour.gigsTotal ? tour.gigsDone / tour.gigsTotal : 0} height={8} label={`${tour.gigsDone} of ${tour.gigsTotal} gigs played`} />
            </View>
          </RockCard>

          <Pressable onPress={() => router.push('/festival')}>
            <RockCard variant="surface" glowColor={Colors.cyan} contentPadding={12}>
              <View className="flex-row items-center gap-md">
                <MaterialCommunityIcons name="ticket-confirmation" size={26} color={Colors.cyan} />
                <View className="flex-1">
                  <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 14 }}>
                    Festival Run
                  </Text>
                  <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                    Put chips on a run of bot sets. Bank the purse or push on.
                  </Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={22} color={Colors.chromeMid} />
              </View>
            </RockCard>
          </Pressable>

          {/* The map: one painted road, a badge at each chapter's stop. */}
          <View style={{ width: '100%', aspectRatio: TOUR_MAP_ASPECT, borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: withOpacity(Colors.gold, 0.35), boxShadow: `0px 0px 24px ${withOpacity(Colors.gold, 0.18)}` }}>
            <Image source={TOUR_MAP} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" />
            {tour.chapters.map((chapter) => {
              const pos = TOUR_MAP_NODES[chapter.id];
              if (!pos) return null;
              return <MapNode key={chapter.id} chapter={chapter} x={pos.x} y={pos.y} active={chapter.id === selectedId} onPress={() => select(chapter.id)} />;
            })}
          </View>

          {selected ? (
            <View onLayout={(e) => (panelY.current = e.nativeEvent.layout.y)}>
              <ChapterPanel
                chapter={selected}
                previous={selectedIndex > 0 ? tour.chapters[selectedIndex - 1] : null}
                onChallenge={(botId) => void challenge(botId, selected)}
                kitOn={kitOn}
                onToggleKit={() => setKitOn((on) => !on)}
                chips={chips}
                launching={launching}
                launchError={launchError}
              />
            </View>
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

function MapNode({ chapter, x, y, active, onPress }: { chapter: TourChapter; x: number; y: number; active: boolean; onPress: () => void }) {
  const locked = !chapter.unlocked;
  const accent = getVenue(chapter.venue).accentColor;
  const ring = locked ? Colors.chromeDark : chapter.bossBeaten ? Colors.gold : accent;
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={{ position: 'absolute', left: `${x * 100}%`, top: `${y * 100}%`, marginLeft: -NODE / 2, marginTop: -NODE / 2, width: NODE, alignItems: 'center' }}
    >
      <View style={{ width: NODE, height: NODE, borderRadius: NODE / 2, boxShadow: active ? `0px 0px 22px ${withOpacity(ring, 0.95)}` : `0px 0px 10px ${withOpacity(ring, locked ? 0.2 : 0.6)}` }}>
        <Image source={CHAPTER_BADGES[chapter.id]} style={{ width: NODE, height: NODE, opacity: locked ? 0.45 : 1 }} contentFit="contain" cachePolicy="memory-disk" />
        {locked ? (
          <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}>
            <MaterialCommunityIcons name="lock" size={22} color={Colors.textPrimary} />
          </View>
        ) : null}
        {chapter.bossBeaten ? (
          <View style={{ position: 'absolute', top: -2, right: -2, width: 20, height: 20, borderRadius: 10, backgroundColor: Colors.gold, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.bgBase }}>
            <MaterialCommunityIcons name="check-bold" size={13} color={Colors.bgBase} />
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: 3, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 1, backgroundColor: withOpacity(Colors.bgBase, 0.82), borderWidth: 1, borderColor: withOpacity(ring, active ? 0.95 : 0.5) }}>
        <Text style={{ fontFamily: Fonts.heading, fontSize: 9, letterSpacing: 0.6, color: locked ? Colors.chromeMid : Colors.textPrimary }} numberOfLines={1}>
          {chapter.name.replace(/^The /, '').toUpperCase()}
        </Text>
      </View>
    </Pressable>
  );
}

interface BossProps {
  onChallenge: (botId: string) => void;
  kitOn: boolean;
  onToggleKit: () => void;
  chips: number;
  launching: boolean;
  launchError: string | null;
}

function ChapterPanel({ chapter, previous, onChallenge, kitOn, onToggleKit, chips, launching, launchError }: { chapter: TourChapter; previous: TourChapter | null } & BossProps) {
  const venue = getVenue(chapter.venue);
  const accent = venue.accentColor;
  const locked = !chapter.unlocked;
  const statusText = locked ? 'LOCKED' : chapter.bossBeaten ? 'COMPLETE' : `${chapter.gigsDone}/${chapter.gigs.length} GIGS`;
  const statusColor = locked ? Colors.chromeMid : chapter.bossBeaten ? Colors.gold : accent;

  return (
    <RockCard variant="surface" glowColor={locked ? Colors.chromeDark : accent} contentPadding={14}>
      <View className="gap-md">
        <View className="flex-row items-center gap-md">
          <Image source={CHAPTER_BADGES[chapter.id]} style={{ width: 64, height: 64, opacity: locked ? 0.5 : 1 }} contentFit="contain" cachePolicy="memory-disk" />
          <View className="flex-1">
            <Text className="font-display-hero text-text-primary" style={{ fontSize: 22, textTransform: 'uppercase' }} numberOfLines={1}>
              {chapter.name}
            </Text>
            <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }} numberOfLines={2}>
              {locked && previous ? `Beat ${previous.boss?.name ?? 'the Encore'} to unlock` : chapter.tagline}
            </Text>
          </View>
          <View className="items-end gap-1">
            <View className="rounded-full px-sm" style={{ paddingVertical: 2, backgroundColor: withOpacity(statusColor, 0.14), borderWidth: 1, borderColor: withOpacity(statusColor, 0.6) }}>
              <Text style={{ fontFamily: Fonts.heading, fontSize: 10, letterSpacing: 1, color: statusColor }}>{statusText}</Text>
            </View>
            {chapter.perfect ? <Text style={{ fontSize: 10, color: Colors.gold, fontFamily: Fonts.heading }}>★ PERFECT</Text> : null}
          </View>
        </View>

        <View style={{ opacity: locked ? 0.55 : 1 }} className="gap-md">
          {chapter.gigs.map((gig) => (
            <View key={gig.id} className="gap-1">
              <View className="flex-row items-center justify-between gap-sm">
                <View className="flex-1 flex-row items-center gap-xs">
                  <MaterialCommunityIcons name={gig.completed ? 'check-circle' : 'circle-outline'} size={16} color={gig.completed ? Colors.gold : Colors.textMuted} />
                  <Text className="font-heading-md" style={{ fontSize: 14, color: gig.completed ? Colors.gold : Colors.textPrimary }} numberOfLines={1}>
                    {gig.title}
                  </Text>
                </View>
                <View className="flex-row items-center gap-1">
                  <CurrencyIcon type="chips" size={14} />
                  <Text className="font-heading-md text-text-muted" style={{ fontSize: 12 }}>
                    {gig.chips}
                  </Text>
                </View>
              </View>
              <Text className="font-body-sm text-text-muted" style={{ fontSize: 12, marginLeft: 22 }}>
                {gig.description}
              </Text>
              {gig.completed || locked ? null : (
                <View style={{ marginLeft: 22 }}>
                  <ProgressBar progress={gig.target ? gig.progress / gig.target : 0} height={5} label={`${gig.progress} / ${gig.target}`} />
                </View>
              )}
            </View>
          ))}
        </View>

        <View style={{ height: 1, backgroundColor: withOpacity(Colors.chromeDark, 0.4) }} />
        <BossSection chapter={chapter} accent={accent} locked={locked} onChallenge={onChallenge} kitOn={kitOn} onToggleKit={onToggleKit} chips={chips} launching={launching} launchError={launchError} />
      </View>
    </RockCard>
  );
}

function BossAvatar({ botId, emoji, size }: { botId: string; emoji: string; size: 'small' | 'medium' }) {
  const portrait = BOT_PORTRAITS[botId];
  return portrait ? <PlayerAvatar source={portrait} size={size} /> : <PlayerAvatar emoji={emoji} size={size} />;
}

function BossSection({ chapter, accent, locked, onChallenge, kitOn, onToggleKit, chips, launching, launchError }: { chapter: TourChapter; accent: string; locked: boolean } & BossProps) {
  const reward = (
    <View className="flex-row flex-wrap items-center gap-sm">
      <View className="flex-row items-center gap-1">
        <CurrencyIcon type="chips" size={14} />
        <Text className="font-heading-md text-text-primary" style={{ fontSize: 12 }}>
          {chapter.reward.chips.toLocaleString('en-US')}
        </Text>
      </View>
      <View className="flex-row items-center gap-1">
        <CurrencyIcon type="gems" size={14} />
        <Text className="font-heading-md text-text-primary" style={{ fontSize: 12 }}>
          {chapter.reward.gems}
        </Text>
      </View>
      <Text className="font-heading-md text-gold" style={{ fontSize: 12 }}>
        Title: {chapter.reward.titleName}
      </Text>
    </View>
  );

  // The World Tour finale: beat all five bosses back to back.
  if (chapter.encore) {
    const progress = chapter.encore.progress;
    const nextBot = chapter.encore.bots[Math.min(progress, chapter.encore.bots.length - 1)];
    return (
      <View className="gap-sm">
        <Text className="font-heading-md uppercase text-gold" style={{ fontSize: 13, letterSpacing: 1 }}>
          The Encore
        </Text>
        <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
          Beat all five bosses in a row. Lose to any boss and the gauntlet starts over.
        </Text>
        <View className="flex-row items-center justify-between">
          {chapter.encore.bots.map((bot, i) => (
            <View key={bot.id} className="items-center gap-1" style={{ opacity: i <= progress ? 1 : 0.45 }}>
              <BossAvatar botId={bot.id} emoji={bot.emoji} size="small" />
              <MaterialCommunityIcons name={i < progress ? 'check-circle' : i === progress ? 'sword' : 'circle-outline'} size={14} color={i < progress ? Colors.gold : i === progress ? accent : Colors.textMuted} />
            </View>
          ))}
        </View>
        {reward}
        {chapter.bossBeaten ? (
          <Text className="font-heading-md text-gold" style={{ fontSize: 13 }}>
            Encore complete. You are a World Tour legend.
          </Text>
        ) : locked ? null : (
          <>
            <Backstage chapter={chapter} kitOn={kitOn} onToggleKit={onToggleKit} chips={chips} error={launchError} />
            <RockButton label={launching ? 'Opening…' : `Next: ${nextBot.name}${kitOn && chapter.backstage?.kitOpen ? ' + Kit' : ''}`} variant="primary" onPress={() => onChallenge(nextBot.id)} disabled={launching} />
          </>
        )}
      </View>
    );
  }

  const boss = chapter.boss;
  if (!boss) return null;
  return (
    <View className="gap-sm">
      <View className="flex-row items-center gap-md">
        <BossAvatar botId={boss.botId} emoji={boss.emoji} size="medium" />
        <View className="flex-1">
          <Text className="font-heading-md uppercase text-gold" style={{ fontSize: 11, letterSpacing: 1.5 }}>
            Boss
          </Text>
          <Text className="font-display-hero text-text-primary" style={{ fontSize: 18, textTransform: 'uppercase' }}>
            {boss.name}
          </Text>
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
            {BOT_TIER_LABEL[boss.difficulty as BotDifficulty] ?? boss.difficulty}
          </Text>
        </View>
      </View>
      {reward}
      {chapter.bossBeaten ? (
        <Text className="font-heading-md text-gold" style={{ fontSize: 13 }}>
          Defeated. Rematch any time from the Bots screen.
        </Text>
      ) : locked ? null : (
        <>
          <Backstage chapter={chapter} kitOn={kitOn} onToggleKit={onToggleKit} chips={chips} error={launchError} />
          <RockButton label={launching ? 'Opening…' : `Challenge ${boss.name}${kitOn && chapter.backstage?.kitOpen ? ' + Kit' : ''}`} variant="primary" onPress={() => onChallenge(boss.botId)} disabled={launching} />
        </>
      )}
    </View>
  );
}

// Backstage: Crowd Energy and the Roadie Kit for a boss the player is stuck on. Crowd Energy
// is earned only by real attempts (the server ignores an early resign); the kit is an
// optional, limited help for ONE boss game and costs chips unless the crowd hands it over.
function Backstage({ chapter, kitOn, onToggleKit, chips, error }: { chapter: TourChapter; kitOn: boolean; onToggleKit: () => void; chips: number; error: string | null }) {
  const b = chapter.backstage;
  if (!b) return null;
  // Nothing to show until the player has actually tried: the first fight should feel like a fight.
  if (b.losses === 0) return null;

  const pips = b.kitOpen ? b.crowdFreeEvery : b.kitUnlockLosses;
  const filled = b.kitOpen ? b.losses % b.crowdFreeEvery : b.losses;
  const free = b.freeKit;
  const canAfford = free || chips >= b.price;
  const kitLine = `Take Two ×${b.kit.takeTwos} · Roadie's Tip ×${b.kit.tips}`;

  return (
    <View className="gap-sm rounded-lg" style={{ padding: 10, backgroundColor: withOpacity(Colors.ember, 0.08), borderWidth: 1, borderColor: withOpacity(Colors.ember, 0.4) }}>
      <View className="flex-row items-center justify-between">
        <Text className="font-heading-md uppercase" style={{ fontSize: 12, letterSpacing: 1.2, color: Colors.ember }}>
          Crowd Energy
        </Text>
        <View className="flex-row items-center gap-1">
          {Array.from({ length: pips }, (_, i) => (
            <View
              key={i}
              style={{
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: i < filled ? Colors.ember : 'transparent',
                borderWidth: 1,
                borderColor: i < filled ? Colors.ember : withOpacity(Colors.ember, 0.5),
              }}
            />
          ))}
        </View>
      </View>

      {!b.kitOpen ? (
        <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
          The crowd feeds on real attempts, not quick exits. {b.kitUnlockLosses - b.losses} more and the Roadie Kit opens backstage.
        </Text>
      ) : (
        <>
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
            {free ? 'The crowd has your back: a Roadie Kit is on the house.' : `${b.toNextFree} more real attempt${b.toNextFree === 1 ? '' : 's'} and the crowd hands you a free kit.`}
          </Text>
          <Pressable
            onPress={canAfford ? onToggleKit : undefined}
            className="flex-row items-center gap-md rounded-lg"
            style={{ padding: 10, opacity: canAfford ? 1 : 0.55, backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: kitOn ? Colors.gold : withOpacity(Colors.chromeDark, 0.6) }}
          >
            <MaterialCommunityIcons name={kitOn ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'} size={22} color={kitOn ? Colors.gold : Colors.textMuted} />
            <View className="flex-1">
              <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 13 }}>
                Roadie Kit
              </Text>
              <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                {kitLine}
              </Text>
              <Text className="font-body-sm text-text-muted" style={{ fontSize: 11 }}>
                One boss game. You still have to win it, and no gigs count while the kit is in play.
              </Text>
            </View>
            {free ? (
              <Text className="font-heading-md text-gold" style={{ fontSize: 13 }}>
                FREE
              </Text>
            ) : (
              <View className="flex-row items-center gap-1">
                <CurrencyIcon type="chips" size={14} />
                <Text className="font-heading-md text-text-primary" style={{ fontSize: 13 }}>
                  {b.price}
                </Text>
              </View>
            )}
          </Pressable>
          {!canAfford ? (
            <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.crimson }}>
              {b.price - chips} more chips for the Roadie Kit. Win a few games, or keep fighting for the free one.
            </Text>
          ) : null}
        </>
      )}
      {error ? (
        <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.crimson }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
