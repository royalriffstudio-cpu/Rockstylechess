import { useEffect } from 'react';
import { Modal, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppIcon, PlayerAvatar, RockButton } from '@/components/ui';
import { getAvatarImage } from '@/constants/avatars';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import { useChallenges } from '@/hooks/useChallenges';

const DURATION_LABEL: Record<string, string> = { '3m': '3 min', '5m': '5 min', '10m': '10 min' };

function ModalCard({ children }: { children: React.ReactNode }) {
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(1, { duration: 180, easing: Easing.out(Easing.quad) });
  }, [progress]);
  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.92 + progress.value * 0.08 }],
  }));
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: Spacing.lg,
        backgroundColor: withOpacity(Colors.bgBase, 0.8),
      }}
    >
      <Animated.View style={[{ width: '100%', maxWidth: 340 }, style]}>
        <View
          style={{
            alignItems: 'center',
            borderRadius: 20,
            borderWidth: 1,
            borderColor: withOpacity(Colors.cyan, 0.3),
            backgroundColor: Colors.bgPanel,
            padding: Spacing.lg,
            boxShadow: `0px 10px 25px ${withOpacity(Colors.cyan, 0.3)}`,
          }}
        >
          {children}
        </View>
      </Animated.View>
    </View>
  );
}

// Rendered once at the app root. Shows the incoming-challenge prompt to the
// challenged player and the outgoing-challenge status (waiting / declined /
// no answer) to the challenger. Navigation into /match on accept is handled
// by useChallenges itself.
export function ChallengeModals() {
  const { incoming, outgoing, respondToChallenge, cancelOutgoing, dismissOutgoing } = useChallenges();

  return (
    <>
      <Modal visible={incoming !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={() => respondToChallenge(false)}>
        {incoming ? (
          <ModalCard>
            <PlayerAvatar source={getAvatarImage(incoming.from.avatarId)} size="large" />
            <Text style={{ marginTop: Spacing.md, textAlign: 'center', fontSize: 18, fontWeight: '600', color: Colors.textPrimary }}>
              {incoming.from.displayName ?? 'A friend'}
            </Text>
            <Text style={{ marginTop: 2, textAlign: 'center', fontSize: 13, color: Colors.textMuted }}>
              challenges you to a match
            </Text>
            <View
              style={{
                marginTop: Spacing.sm,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                borderRadius: 999,
                paddingHorizontal: Spacing.md,
                paddingVertical: 4,
                backgroundColor: withOpacity(Colors.cyan, 0.12),
              }}
            >
              <AppIcon name="schedule" size={14} color={Colors.cyan} />
              <Text style={{ fontSize: 12, color: Colors.cyan, textTransform: 'uppercase', letterSpacing: 1 }}>
                {DURATION_LABEL[incoming.duration] ?? incoming.duration}
              </Text>
            </View>
            <View style={{ marginTop: Spacing.lg, width: '100%', flexDirection: 'row', gap: Spacing.sm }}>
              <RockButton label="Decline" variant="secondary" onPress={() => respondToChallenge(false)} style={{ flex: 1 }} />
              <RockButton label="Accept" variant="cyan" onPress={() => respondToChallenge(true)} style={{ flex: 1 }} />
            </View>
          </ModalCard>
        ) : (
          <View />
        )}
      </Modal>

      <Modal visible={outgoing !== null} transparent animationType="fade" statusBarTranslucent onRequestClose={dismissOutgoing}>
        {outgoing ? (
          <ModalCard>
            <PlayerAvatar source={getAvatarImage(null)} size="large" spinning={outgoing.status === 'pending'} />
            <Text style={{ marginTop: Spacing.md, textAlign: 'center', fontSize: 18, fontWeight: '600', color: Colors.textPrimary }}>
              {outgoing.displayName}
            </Text>
            <Text style={{ marginTop: 4, textAlign: 'center', fontSize: 14, color: Colors.textMuted }}>
              {outgoing.status === 'pending' && 'Waiting for them to accept…'}
              {outgoing.status === 'declined' && 'Declined the challenge.'}
              {outgoing.status === 'expired' && 'No answer.'}
              {outgoing.status === 'error' &&
                (outgoing.errorReason === 'offline'
                  ? 'They just went offline.'
                  : outgoing.errorReason === 'not-friends'
                    ? 'You are no longer friends.'
                    : outgoing.errorReason === 'challenger-left'
                      ? 'The challenge could not be started.'
                      : 'Something went wrong.')}
            </Text>
            <View style={{ marginTop: Spacing.lg, width: '100%' }}>
              {outgoing.status === 'pending' ? (
                <RockButton label="Cancel" variant="secondary" onPress={cancelOutgoing} style={{ width: '100%' }} />
              ) : (
                <RockButton label="OK" variant="secondary" onPress={dismissOutgoing} style={{ width: '100%' }} />
              )}
            </View>
          </ModalCard>
        ) : (
          <View />
        )}
      </Modal>
    </>
  );
}
