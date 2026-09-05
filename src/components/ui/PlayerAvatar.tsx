import { LinearGradient } from 'expo-linear-gradient';
import { useEffect } from 'react';
import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';

import { Colors, Fonts, Gradients, withOpacity } from '@/constants/theme';

export type AvatarSize = 'tiny' | 'small' | 'medium' | 'large';

interface PlayerAvatarProps {
  /** A bundled avatar image (e.g. `getAvatarImage(avatarId)`). Wins over `imageUri`/`emoji`. */
  source?: ImageSourcePropType;
  imageUri?: string;
  /** Fallback glyph for non-avatar-set uses (bots, mock friends, "searching…" states). */
  emoji?: string;
  /** Omit to render the avatar with no level badge (e.g. character select). */
  level?: number;
  size?: AvatarSize;
  /** Swaps the fire ring for a cyan "selected" ring, e.g. character select. */
  selected?: boolean;
  /** Continuous ring rotation, e.g. while a spin-wheel result is pending. */
  spinning?: boolean;
}

const SIZE_MAP: Record<AvatarSize, { outer: number; ring: number; emoji: number; badge: number }> = {
  // For tight spots that can't absorb 'small''s footprint (e.g. the in-match
  // player-row card, where the box has to stay close to its old
  // icon-plus-two-lines-of-text height) -- no level badge is ever shown at
  // this size in practice, so its badge value only exists to keep the
  // container-height formula below uniform across sizes.
  tiny: { outer: 32, ring: 2, emoji: 14, badge: 12 },
  small: { outer: 44, ring: 3, emoji: 18, badge: 16 },
  medium: { outer: 68, ring: 4, emoji: 28, badge: 20 },
  large: { outer: 100, ring: 5, emoji: 42, badge: 26 },
};

// expo-linear-gradient only renders linear (not conic) gradients, so the
// "fire ring" is approximated with a diagonal multi-stop sweep plus a
// matching colored glow rather than a literal 360° conic gradient.
export function PlayerAvatar({
  source,
  imageUri,
  emoji,
  level,
  size = 'medium',
  selected = false,
  spinning = false,
}: PlayerAvatarProps) {
  const { outer, ring, emoji: emojiSize, badge } = SIZE_MAP[size];
  const inner = outer - ring * 2;
  const ringColors = selected ? ([Colors.cyan, withOpacity(Colors.cyan, 0.6), Colors.cyan] as const) : Gradients.avatarRing;
  const glowColor = selected ? Colors.cyan : Colors.ember;

  const rotation = useSharedValue(0);
  useEffect(() => {
    if (spinning) {
      rotation.value = withRepeat(withTiming(360, { duration: 4000, easing: Easing.linear }), -1);
    }
  }, [spinning, rotation]);
  const spinStyle = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  return (
    <View style={[styles.container, { width: outer, height: outer + badge / 2 }]}>
      <Animated.View style={spinning ? spinStyle : undefined}>
        <LinearGradient
          colors={ringColors}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.ring,
            {
              width: outer,
              height: outer,
              borderRadius: outer / 2,
              boxShadow: `0px 0px ${outer * 0.35}px ${withOpacity(glowColor, 0.55)}`,
            },
          ]}
        >
          <View
            style={[
              styles.content,
              {
                width: inner,
                height: inner,
                borderRadius: inner / 2,
              },
            ]}
          >
            {source ? (
              <Image source={source} resizeMode="cover" style={{ width: inner, height: inner, borderRadius: inner / 2 }} />
            ) : imageUri ? (
              <Image source={{ uri: imageUri }} style={{ width: inner, height: inner, borderRadius: inner / 2 }} />
            ) : (
              <Text style={{ fontSize: emojiSize }}>{emoji ?? '♟️'}</Text>
            )}
          </View>
        </LinearGradient>
      </Animated.View>

      {level !== undefined ? (
        <View
          style={[
            styles.badge,
            {
              width: badge,
              height: badge,
              borderRadius: badge / 2,
              boxShadow: `0px 0px 6px ${withOpacity(Colors.gold, 0.6)}`,
            },
          ]}
        >
          <Text style={[styles.badgeLabel, { fontSize: badge * 0.55 }]}>{level}</Text>
        </View>
      ) : null}
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  ring: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    backgroundColor: Colors.bgPanel,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  badge: {
    position: 'absolute',
    bottom: 0,
    backgroundColor: Colors.gold,
    borderWidth: 1.5,
    borderColor: Colors.bgBase,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeLabel: {
    fontFamily: Fonts.heading,
    color: Colors.bgBase,
  },
});
// #endregion
