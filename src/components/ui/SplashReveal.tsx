import { Image } from 'expo-image';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { EmberParticles } from '@/components/ui/EmberParticles';
import { Colors, withOpacity } from '@/constants/theme';

const LOGO = require('../../../assets/images/royalRiffStudio_logo.png');
const LOGO_ASPECT_RATIO = 478 / 496;

interface SplashRevealProps {
  /** Called once the exit fade finishes -- the parent unmounts this. */
  onDone: () => void;
}

// Staged reveal shown once the native (OS-level) splash hides, so there's a
// designed moment instead of the app just appearing. Same bg color as the
// native splash and the same logo asset, so the handoff from native splash
// to this overlay is invisible.
export function SplashReveal({ onDone }: SplashRevealProps) {
  const logoOpacity = useSharedValue(0);
  const logoScale = useSharedValue(0.82);
  const overlayOpacity = useSharedValue(1);

  useEffect(() => {
    logoOpacity.value = withTiming(1, { duration: 500, easing: Easing.out(Easing.quad) });
    logoScale.value = withTiming(1, { duration: 650, easing: Easing.out(Easing.back(1.4)) });

    const holdTimer = setTimeout(() => {
      overlayOpacity.value = withTiming(0, { duration: 350, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onDone)();
      });
    }, 1250);

    return () => clearTimeout(holdTimer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const logoStyle = useAnimatedStyle(() => ({
    opacity: logoOpacity.value,
    transform: [{ scale: logoScale.value }],
  }));

  return (
    <Animated.View style={[styles.overlay, overlayStyle]} pointerEvents="none">
      <EmberParticles count={14} />
      <Animated.View style={[styles.logoGroup, logoStyle]}>
        <View style={styles.glow} />
        <Image source={LOGO} style={styles.logo} contentFit="contain" />
      </Animated.View>
    </Animated.View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgBase,
  },
  logoGroup: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  glow: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    boxShadow: `0px 0px 60px ${withOpacity(Colors.gold, 0.5)}, 0px 0px 120px ${withOpacity(Colors.ember, 0.3)}`,
  },
  logo: {
    width: 240,
    aspectRatio: LOGO_ASPECT_RATIO,
  },
});
// #endregion
