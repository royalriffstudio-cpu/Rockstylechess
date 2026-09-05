import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing, withOpacity } from '@/constants/theme';

interface ProgressBarProps {
  /** 0 to 1 */
  progress: number;
  height?: number;
  label?: string;
}

export function ProgressBar({ progress, height = 10, label }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, progress));

  return (
    <View>
      <View
        style={[
          styles.track,
          {
            height,
            borderRadius: height / 2,
          },
        ]}
      >
        <LinearGradient
          colors={[Colors.ember, Colors.gold]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={[
            styles.fill,
            {
              width: `${clamped * 100}%`,
              borderRadius: height / 2,
              boxShadow: `0px 0px 6px ${withOpacity(Colors.gold, 0.6)}`,
            },
          ]}
        />
      </View>
      {label ? <Text style={styles.label}>{label}</Text> : null}
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: withOpacity(Colors.chromeDark, 0.25),
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
  },
  label: {
    marginTop: Spacing.xs,
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.textMuted,
  },
});
// #endregion
