import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/theme';

const GLOW_COLORS = {
  cyan: Colors.cyan,
  gold: Colors.gold,
  ember: Colors.ember,
  crimson: Colors.crimson,
} as const;

const INTENSITY = {
  sm: { radius: 10, opacity: 0.3, elevation: 3 },
  md: { radius: 18, opacity: 0.4, elevation: 6 },
  lg: { radius: 25, opacity: 0.6, elevation: 10 },
} as const;

interface GlowBoxProps {
  color: keyof typeof GLOW_COLORS;
  intensity?: keyof typeof INTENSITY;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}

/** Shadow-only wrapper for a colored ambient glow around arbitrary content. */
export function GlowBox({ color, intensity = 'md', style, children }: GlowBoxProps) {
  const hex = GLOW_COLORS[color];
  const { radius, opacity, elevation } = INTENSITY[intensity];
  return (
    <View
      style={[
        {
          shadowColor: hex,
          shadowOpacity: opacity,
          shadowRadius: radius,
          shadowOffset: { width: 0, height: 0 },
          elevation,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
