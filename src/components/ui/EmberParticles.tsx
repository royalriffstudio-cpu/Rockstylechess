import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { Colors, withOpacity } from '@/constants/theme';

interface EmberParticlesProps {
  /** Capped low on purpose -- this animates continuously and runs on every
   * screen that mounts it, so keep instance count small for low-end Android. */
  count?: number;
}

const EMBER_COLORS = [Colors.ember, Colors.emberLight, Colors.gold];

interface ParticleConfig {
  id: number;
  durationMs: number;
  delayMs: number;
  driftPx: number;
  /** The non-animated half of the ember's style, built once. */
  style: ViewStyle;
}

function buildParticles(count: number): ParticleConfig[] {
  return Array.from({ length: count }, (_, id) => {
    const size = 3 + Math.random() * 3;
    const color = EMBER_COLORS[id % EMBER_COLORS.length];
    return {
      id,
      durationMs: 4000 + Math.random() * 3000,
      delayMs: Math.random() * 4000,
      driftPx: (Math.random() - 0.5) * 30,
      style: {
        left: `${Math.random() * 100}%`,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        boxShadow: `0px 0px ${size * 2}px ${withOpacity(color, 0.8)}`,
      } as ViewStyle,
    };
  });
}

// Reusable atmospheric layer for any screen that wants a "lit by embers"
// feel. Capped at a small particle count and driven entirely by Reanimated
// worklets on the UI thread. memo'd (both the container and each Ember) so a
// re-render of the host screen doesn't re-run the particle children or
// re-allocate their style objects.
export const EmberParticles = memo(function EmberParticles({ count = 12 }: EmberParticlesProps) {
  const particles = useMemo(() => buildParticles(Math.min(count, 15)), [count]);

  return (
    <View style={styles.container} pointerEvents="none">
      {particles.map((particle) => (
        <Ember key={particle.id} {...particle} />
      ))}
    </View>
  );
});

const Ember = memo(function Ember({ durationMs, delayMs, driftPx, style }: ParticleConfig) {
  const progress = useSharedValue(0);

  useEffect(() => {
    progress.value = withDelay(
      delayMs,
      withRepeat(withTiming(1, { duration: durationMs, easing: Easing.linear }), -1, false),
    );
  }, [progress, delayMs, durationMs]);

  const animatedStyle = useAnimatedStyle(() => {
    const translateY = interpolate(progress.value, [0, 1], [0, -240]);
    const translateX = interpolate(progress.value, [0, 1], [0, driftPx]);
    const opacity = interpolate(progress.value, [0, 0.15, 0.85, 1], [0, 1, 1, 0]);
    return {
      opacity,
      transform: [{ translateY }, { translateX }],
    };
  });

  return <Animated.View style={[styles.ember, style, animatedStyle]} />;
});

// #region Styles
const styles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    overflow: 'hidden',
  },
  ember: {
    position: 'absolute',
    bottom: 0,
  },
});
// #endregion
