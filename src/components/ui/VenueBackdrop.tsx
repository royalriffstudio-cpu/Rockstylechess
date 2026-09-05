import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Colors, withOpacity } from '@/constants/theme';
import { getVenue, getVenueIntensity } from '@/constants/venues';
import type { VenueTier } from '@/lib/onlineMatch';

interface VenueBackdropProps {
  venueTier: VenueTier;
}

/**
 * Full-bleed venue photo + scrim + accent color wash, mounted as the first
 * child of a match/results screen's root View (behind all foreground UI).
 * Never touches ChessBoard's own theme/pieceSprites -- the board stays
 * driven purely by the player's equipped Forge cosmetic; this is atmosphere
 * around the board, not on it. See constants/venues.ts's getVenueIntensity
 * for how the escalation across the venue ladder is derived.
 */
export function VenueBackdrop({ venueTier }: VenueBackdropProps) {
  const venue = getVenue(venueTier);
  const intensity = getVenueIntensity(venueTier);

  return (
    <>
      <Image
        source={venue.image}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={300}
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { opacity: intensity.backdropOpacity }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[withOpacity(Colors.bgBase, intensity.scrimTop), withOpacity(Colors.bgBase, 0.85), Colors.bgBase]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[withOpacity(venue.accentColor, intensity.glowOpacity * 0.4), 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0.6 }}
        style={StyleSheet.absoluteFillObject}
      />
      {intensity.shimmer ? <ShimmerSweep color={venue.accentColor} /> : null}
    </>
  );
}

function ShimmerSweep({ color }: { color: string }) {
  const translateX = useSharedValue(-SWEEP_TRAVEL);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { rotate: '20deg' }],
  }));

  useEffect(() => {
    // Fires once on mount, then stays put -- a looping sweep is too
    // distracting to run continuously behind live gameplay.
    translateX.value = withDelay(600, withTiming(SWEEP_TRAVEL, { duration: 2600, easing: Easing.inOut(Easing.ease) }));
  }, [translateX]);

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFillObject, animatedStyle]}>
      <LinearGradient
        colors={['transparent', withOpacity(color, 0.25), 'transparent']}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.sweepBar}
      />
    </Animated.View>
  );
}

const SWEEP_TRAVEL = 500;

const styles = StyleSheet.create({
  sweepBar: {
    position: 'absolute',
    top: -100,
    bottom: -100,
    left: -80,
    width: 160,
  },
});
