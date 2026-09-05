import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, Fonts, Spacing, withOpacity } from '@/constants/theme';

interface SectionLabelProps {
  label: string;
}

export function SectionLabel({ label }: SectionLabelProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <LinearGradient
        colors={[withOpacity(Colors.gold, 0.55), withOpacity(Colors.gold, 0)]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={styles.line}
      />
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  label: {
    fontFamily: Fonts.heading,
    fontSize: 13,
    letterSpacing: 2,
    textTransform: 'uppercase',
    color: Colors.textMuted,
  },
  line: {
    flex: 1,
    height: 1.5,
    borderRadius: 1,
  },
});
// #endregion
