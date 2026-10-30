import { useRouter } from 'expo-router';
import { Alert } from 'react-native';

import { formatChips, venueRequirement, type Venue, type VenueRequirement } from '@/constants/venues';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { useRewardedAd } from '@/hooks/useRewardedAd';
import { redeemWithRetry } from '@/lib/ads/redeemWithRetry';
import { refillAmount } from '@/lib/adRefill';
import { getAdStatus, redeemVenueRefillAd } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { safetyNetTerms } from '@/lib/gear';
import type { Duration } from '@/lib/onlineMatch';

// Shared by home.tsx and (play)/setup.tsx: decides whether the player can enter a
// venue, explains why not, and puts the buy-in confirmation in front of every
// wagered match. The server enforces all of this again (queue:join / escrow); this
// is the friendly explanation, not the security.
export function useVenueEntry() {
  const router = useRouter();
  const { status, profile, refresh } = usePlayerProfile();
  const { ready: adReady, show: showAd } = useRewardedAd();
  const ctx = { status, chips: profile?.chips ?? 0, rating: profile?.rating ?? 0 };

  function requirementFor(venue: Venue): VenueRequirement | null {
    return venueRequirement(venue, ctx);
  }

  // Out of chips (below the cheapest paid buy-in): watch an ad for the shortfall. The server pays it and
  // enforces the daily cap; this just runs the ad and reports what happened.
  async function watchRefillAd(venue: Venue): Promise<void> {
    if (!adReady) {
      Alert.alert('No ad available', 'Please try again in a moment.');
      return;
    }
    try {
      const result = await showAd();
      if (result === 'unavailable') {
        Alert.alert('No ad available', 'Please try again in a moment.');
        return;
      }
      if (result !== 'earned') return; // closed early: no reward
      const token = await getAuthToken();
      if (!token) return;
      const granted = await redeemWithRetry(() => redeemVenueRefillAd(token));
      void refresh();
      const short = venue.buyIn - granted.chips;
      Alert.alert(
        `+${granted.chipsGranted.toLocaleString('en-US')} chips`,
        short <= 0
          ? `You have ${granted.chips.toLocaleString('en-US')} chips: enough for ${venue.name}.`
          : `You have ${granted.chips.toLocaleString('en-US')} chips. ${venue.name} needs ${short.toLocaleString('en-US')} more${refillAmount(granted.chips) > 0 ? ', and you can watch another ad.' : '.'}`,
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : '';
      Alert.alert(
        'Reward not granted',
        code === 'ad-daily-cap-reached'
          ? "You've used today's refill ads. Play the free Garage to earn more chips, or come back tomorrow."
          : code === 'refill-not-needed'
            ? 'You already have enough chips for the cheapest venue.'
            : code === 'ad-not-verified'
              ? "We couldn't confirm that the ad finished. Please try again."
              : 'Something went wrong. Please try again.',
      );
    }
  }

  async function explain(venue: Venue, requirement: VenueRequirement): Promise<void> {
    if (requirement === 'sign-in') {
      Alert.alert(`${venue.name} is played for chips`, 'Sign in to play for chips. The Garage is always free.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Sign In', onPress: () => router.push('/sign-in') },
      ]);
    } else if (requirement === 'rating') {
      Alert.alert(
        `${venue.name} is locked`,
        `You need a rating of ${venue.minRating} to enter (yours is ${ctx.rating}). Win matches at the lower venues to climb.`,
      );
    } else {
      const offer = refillAmount(ctx.chips);
      // The ad is only for a player who can afford NO paid venue, and only while today's refills last.
      let adsLeft = 0;
      if (offer > 0) {
        try {
          const token = await getAuthToken();
          if (token) adsLeft = (await getAdStatus(token)).placements['venue-refill'].remaining;
        } catch {
          adsLeft = 0;
        }
      }
      Alert.alert(
        `Not enough chips`,
        `${venue.name} costs ${venue.buyIn.toLocaleString('en-US')} chips to enter and you have ${ctx.chips.toLocaleString('en-US')}.` +
          (offer > 0 && adsLeft > 0 ? ` Watch a short ad for +${offer.toLocaleString('en-US')} chips (${adsLeft} left today).` : ''),
        [
          { text: 'Not now', style: 'cancel' },
          ...(offer > 0 && adsLeft > 0 ? [{ text: `Watch ad · +${offer}`, onPress: () => void watchRefillAd(venue) }] : []),
          { text: 'Get Chips', onPress: () => router.push('/shop') },
        ],
      );
    }
  }

  function startMatch(venue: Venue, duration: Duration, insured = false): void {
    router.push({ pathname: '/matchmaking', params: { venueTier: venue.id, duration, ...(insured ? { insured: '1' } : {}) } });
  }

  // "Play Now": free venues go straight in; wagered ones ask first. `insured` = the player ticked the
  // Safety Net (an optional add-on, wagered venues only; the server re-checks the balance).
  function tryPlay(venue: Venue, duration: Duration, insured = false): void {
    const requirement = requirementFor(venue);
    if (requirement) {
      void explain(venue, requirement);
      return;
    }
    if (venue.buyIn <= 0) {
      startMatch(venue, duration);
      return;
    }
    const net = insured ? safetyNetTerms(venue.buyIn) : null;
    if (net && ctx.chips < venue.buyIn + net.premium) {
      Alert.alert(
        'Not enough chips for the Safety Net',
        `${venue.name} costs ${venue.buyIn.toLocaleString('en-US')} chips plus ${net.premium.toLocaleString('en-US')} for the Safety Net, and you have ${ctx.chips.toLocaleString('en-US')}.`,
        [
          { text: 'Not now', style: 'cancel' },
          { text: `Play without it`, onPress: () => startMatch(venue, duration) },
        ],
      );
      return;
    }
    const total = venue.buyIn + (net?.premium ?? 0);
    Alert.alert(
      `Enter ${venue.name}?`,
      `Pay ${venue.buyIn.toLocaleString('en-US')} chips to play. The winner takes ${venue.prize.toLocaleString('en-US')} (10% house cut). A draw returns your buy-in, and so does leaving in the first 3 moves.` +
        (net ? ` Safety Net: ${net.premium.toLocaleString('en-US')} more up front, and if you lose ${net.cover.toLocaleString('en-US')} comes back.` : ''),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Pay ${formatChips(total)} & Play`, onPress: () => startMatch(venue, duration, insured) },
      ],
    );
  }

  return { requirementFor, explain, tryPlay };
}
