import { LinearGradient } from 'expo-linear-gradient';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, Fonts, Gradients, Radius, Spacing, withOpacity } from '@/constants/theme';

export type RockButtonVariant = 'primary' | 'reward' | 'gold' | 'cyan' | 'danger' | 'secondary';

interface RockButtonProps {
  label: string;
  /** Shown instead of `label` while `loading` is true. */
  loadingLabel?: string;
  onPress?: () => void;
  variant?: RockButtonVariant;
  icon?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

// `reward` is kept as an alias of `gold` -- same accent, same gradient --
// so existing call sites (Claim & Play, Reset, Upgrade, etc.) keep working
// unchanged; `gold` is the name new screens should reach for.
const VARIANT_GRADIENT: Record<RockButtonVariant, readonly [string, string, ...string[]] | null> = {
  primary: Gradients.primaryButton,
  reward: Gradients.goldButton,
  gold: Gradients.goldButton,
  cyan: Gradients.cyanButton,
  danger: Gradients.dangerButton,
  secondary: null,
};

const VARIANT_ACCENT: Record<RockButtonVariant, string | null> = {
  primary: Colors.ember,
  reward: Colors.gold,
  gold: Colors.gold,
  cyan: Colors.cyan,
  danger: Colors.crimson,
  secondary: null,
};

// Bright chips (gold/cyan) read best with dark text; the ember/crimson and
// danger gradients are dark enough that they need light text to stay legible.
const VARIANT_TEXT_COLOR: Record<RockButtonVariant, string> = {
  primary: Colors.textPrimary,
  reward: Colors.bgBase,
  gold: Colors.bgBase,
  cyan: Colors.bgBase,
  danger: Colors.textPrimary,
  secondary: Colors.textPrimary,
};

export function RockButton({
  label,
  loadingLabel,
  onPress,
  variant = 'primary',
  icon,
  loading = false,
  disabled = false,
  style,
}: RockButtonProps) {
  const gradient = VARIANT_GRADIENT[variant];
  const accent = VARIANT_ACCENT[variant];
  const textColor = VARIANT_TEXT_COLOR[variant];
  const isDisabled = disabled || loading;

  const inner = (
    <>
      {/* Crisp specular highlight along the top edge -- translates the
          source's `inset 0 2px 4px rgba(255,255,255,0.3)`. */}
      <LinearGradient
        pointerEvents="none"
        colors={[withOpacity(Colors.chrome, 0.5), withOpacity(Colors.chrome, 0)]}
        style={styles.gloss}
      />
      <View style={styles.content}>
        {icon}
        <Text style={[styles.label, { color: textColor }]}>{loading && loadingLabel ? loadingLabel : label}</Text>
      </View>
    </>
  );

  return (
    // Outer wrapper owns the radius + clip (Android bleeds a child gradient
    // past a rounded Pressable otherwise) and the colored glow. No width, so
    // it stretches inside a plain column parent and shrinks to its label
    // inside a centered one -- same as the callers already expect.
    <View
      style={[
        styles.wrapper,
        {
          opacity: isDisabled ? 0.5 : 1,
          boxShadow: accent
            ? `0px 4px 12px ${withOpacity(Colors.bgBase, 0.6)}, 0px 0px 18px ${withOpacity(accent, 0.5)}`
            : undefined,
        },
        style,
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={isDisabled}
        style={({ pressed }) => ({ transform: [{ scale: pressed ? 0.97 : 1 }] })}
      >
        {gradient ? (
          <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={styles.fill}>
            {inner}
          </LinearGradient>
        ) : (
          <View style={[styles.fill, { backgroundColor: Colors.chromeDark }]}>{inner}</View>
        )}
      </Pressable>
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  wrapper: {
    borderRadius: Radius.lg,
    overflow: 'hidden',
  },
  // The gradient/solid fill IS the sized box -- padding here, content inside.
  fill: {
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '38%',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.sm,
  },
  label: {
    fontFamily: Fonts.heading,
    fontSize: 16,
    // Pinned -- Oswald reports a tall natural line box on Android, which was
    // inflating every button's height well past its padding.
    lineHeight: 18,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
// #endregion
