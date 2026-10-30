import { Alert, Pressable, Text, View } from 'react-native';

import { AppIcon, RockButton, RockCard } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { formatChips, getVenue } from '@/constants/venues';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { useRematch, type RematchClosed } from '@/hooks/useRematch';
import { safetyNetTerms } from '@/lib/gear';
import type { WagerSettledPayload } from '@/lib/onlineMatch';

interface RematchPanelProps {
  matchId: string;
  opponentName: string;
  venueTier: string;
  buyIn: number; // 0 = unwagered
  // The server's settlement of the match just played (wagered only). A wagered rematch waits for it so the
  // balance the player sees and the stake they are asked for are final.
  wager: WagerSettledPayload | undefined;
  onStart: () => void;
}

function closedMessage(closed: RematchClosed, name: string): string {
  if (closed.kind === 'declined') return `${name} declined the rematch.`;
  if (closed.kind === 'left') return `${name} left.`;
  if (closed.kind === 'expired') return 'The rematch offer expired.';
  switch (closed.reason) {
    case 'insufficient-chips':
      return `You need ${(closed.required ?? 0).toLocaleString('en-US')} chips for that rematch.`;
    case 'opponent-short':
      return `${name} can't cover the stake right now.`;
    case 'rating-too-low':
      return 'Your rating dropped below this venue, so the rematch is off.';
    case 'opponent-ineligible':
      return `${name} no longer qualifies for this venue.`;
    case 'opponent-left':
      return `${name} left.`;
    case 'already-in-match':
      return 'One of you is already in another match.';
    default:
      return "The rematch couldn't start.";
  }
}

// "Play again" for an online match (bot games rematch from result-placeholder itself). The whole flow is the
// server's (rematch.ts); this is the button, the waiting state and the accept/decline prompt.
export function RematchPanel({ matchId, opponentName, venueTier, buyIn, wager, onStart }: RematchPanelProps) {
  const { chips, profile } = usePlayerProfile();
  const { state, incoming, closed, offer, cancel, accept, decline } = useRematch(matchId, onStart);

  const wagered = buyIn > 0;
  // Your Safety Net choice from the match just played carries over (the server re-charges it).
  const premium = wagered && wager?.insurance ? safetyNetTerms(buyIn).premium : 0;
  const cost = buyIn + premium;
  const venue = getVenue(venueTier);
  const ratingBlocked = wagered && (profile?.rating ?? 0) < venue.minRating;
  const cantAfford = wagered && chips < cost;
  const settling = wagered && !wager;
  const blockedReason = ratingBlocked
    ? `Your rating is below ${venue.name} (${venue.minRating}).`
    : cantAfford
      ? `You need ${cost.toLocaleString('en-US')} chips for this rematch (you have ${chips.toLocaleString('en-US')}).`
      : null;

  function confirmStake(action: () => void, verb: string) {
    if (!wagered) {
      action();
      return;
    }
    Alert.alert(
      `${verb} for ${formatChips(buyIn)}?`,
      `Pay ${buyIn.toLocaleString('en-US')} chips${premium ? ` + ${premium.toLocaleString('en-US')} Safety Net` : ''}. The winner takes ${venue.prize.toLocaleString('en-US')}. You will play the other colour.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: `Pay ${formatChips(cost)}`, onPress: action },
      ],
    );
  }

  if (state === 'closed' && closed) {
    return (
      <Text className="text-center font-body-sm text-caption uppercase tracking-wide text-text-muted">
        {closedMessage(closed, opponentName)}
      </Text>
    );
  }

  if (state === 'incoming' && incoming) {
    const theirBuyIn = incoming.buyIn;
    return (
      <RockCard glowColor={Colors.gold} contentPadding={12}>
        <View className="gap-sm">
          <View className="flex-row items-center gap-sm">
            <AppIcon name="swords" size={18} color={Colors.gold} />
            <Text className="flex-1 font-heading-md uppercase text-text-primary" style={{ fontSize: 14 }} numberOfLines={1}>
              {incoming.from} wants a rematch
            </Text>
          </View>
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
            {theirBuyIn > 0
              ? `${formatChips(theirBuyIn)} buy-in${premium ? ` + ${premium.toLocaleString('en-US')} Safety Net` : ''}, winner takes ${incoming.prize.toLocaleString('en-US')}. Colours swap.`
              : incoming.friendly
                ? 'Friendly match: no rating, no rewards. Colours swap.'
                : 'Same time control. Colours swap.'}
          </Text>
          {blockedReason ? (
            <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.crimson }}>
              {blockedReason}
            </Text>
          ) : null}
          <View className="flex-row gap-sm">
            <View className="flex-1">
              <RockButton label="Decline" variant="secondary" onPress={decline} />
            </View>
            <View className="flex-1">
              <RockButton label="Accept" variant="gold" disabled={!!blockedReason} onPress={() => confirmStake(accept, 'Accept rematch')} />
            </View>
          </View>
        </View>
      </RockCard>
    );
  }

  if (state === 'offering' || state === 'starting') {
    return (
      <View className="gap-xs">
        <RockButton label={state === 'starting' ? 'Starting…' : `Waiting for ${opponentName}…`} variant="gold" disabled onPress={() => {}} />
        {state === 'offering' ? (
          <Pressable onPress={cancel} hitSlop={10}>
            <Text className="text-center font-body-sm text-text-muted" style={{ fontSize: 12, textDecorationLine: 'underline' }}>
              Cancel
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return (
    <View className="gap-xs">
      <RockButton
        label={wagered ? `Rematch · ${formatChips(buyIn)}` : 'Rematch'}
        variant="gold"
        icon={<AppIcon name="swords" size={20} color={Colors.bgBase} />}
        disabled={settling || !!blockedReason}
        onPress={() => confirmStake(offer, 'Offer rematch')}
      />
      {blockedReason ? (
        <Text className="text-center font-body-sm" style={{ fontSize: 11, color: withOpacity(Colors.crimson, 0.9) }}>
          {blockedReason}
        </Text>
      ) : null}
    </View>
  );
}
