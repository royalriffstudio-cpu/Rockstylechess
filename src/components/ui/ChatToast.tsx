import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { ChatMessageWithId } from '@/hooks/useMatchChat';
import { Colors, Fonts, Radius, Spacing, withOpacity } from '@/constants/theme';

const ENTER_MS = 250;
const HOLD_MS = 3000;
const EXIT_MS = 250;
const OFFSCREEN_Y = -40;

interface ChatToastProps {
  message: ChatMessageWithId;
  onDismiss: () => void;
}

// A transient "read it without opening chat" banner for an incoming
// opponent message -- purely additive to the unread badge on the Chat
// button, not a replacement for it. Lifecycle is self-contained (mount ->
// animate in -> hold -> animate out -> onDismiss), matching the
// mount/unmount-owns-the-animation idiom already used by front-row.tsx's
// FloatingEmoji. The parent (match.tsx) keys this by message.id, so a new
// incoming message while one is still showing remounts it -- both the
// animation and this timer restart automatically, giving "latest replaces
// whatever's showing" for free.
export function ChatToast({ message, onDismiss }: ChatToastProps) {
  const insets = useSafeAreaInsets();
  const translateY = useSharedValue(OFFSCREEN_Y);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const timingConfig = { duration: ENTER_MS, easing: Easing.out(Easing.cubic) };
    translateY.value = withTiming(0, timingConfig);
    opacity.value = withTiming(1, timingConfig);

    const exitTimer = setTimeout(() => {
      const exitConfig = { duration: EXIT_MS, easing: Easing.in(Easing.cubic) };
      translateY.value = withTiming(OFFSCREEN_Y, exitConfig);
      opacity.value = withTiming(0, exitConfig);
    }, ENTER_MS + HOLD_MS);

    const dismissTimer = setTimeout(onDismiss, ENTER_MS + HOLD_MS + EXIT_MS);

    return () => {
      clearTimeout(exitTimer);
      clearTimeout(dismissTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.wrap, { top: insets.top + 60 }, animatedStyle]}
    >
      <View style={styles.card}>
        <LinearGradient
          pointerEvents="none"
          colors={[withOpacity(Colors.bgPanel, 0.92), withOpacity(Colors.bgBase, 0.92)]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFillObject}
        />
        <LinearGradient
          pointerEvents="none"
          colors={[withOpacity(Colors.chrome, 0.35), withOpacity(Colors.chrome, 0)]}
          style={styles.topHighlightLine}
        />
        <View style={styles.iconWrap}>
          <MaterialCommunityIcons name="message-text-outline" size={16} color={Colors.crimson} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.sender}>{message.displayName}</Text>
          <Text style={styles.text} numberOfLines={2} ellipsizeMode="tail">
            {message.text}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    zIndex: 10,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1.5,
    borderColor: withOpacity(Colors.crimson, 0.5),
    overflow: 'hidden',
    boxShadow: `0px 8px 20px ${withOpacity(Colors.bgBase, 0.8)}, 0px 0px 20px ${withOpacity(Colors.crimson, 0.35)}`,
  },
  topHighlightLine: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.crimson, 0.16),
    marginTop: 2,
  },
  textWrap: {
    flex: 1,
  },
  sender: {
    fontFamily: Fonts.heading,
    fontSize: 10,
    color: Colors.crimson,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  text: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textPrimary,
    lineHeight: 18,
  },
});
// #endregion
