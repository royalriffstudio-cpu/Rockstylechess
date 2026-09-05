import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CURRENCY, type CurrencyType } from '@/constants/currency';
import { Colors, Fonts, Radius, Spacing, withOpacity } from '@/constants/theme';

export type { CurrencyType };

interface CurrencyPillProps {
  type: CurrencyType;
  value: number | string;
  onPressAdd?: () => void;
}

export function CurrencyPill({ type, value, onPressAdd }: CurrencyPillProps) {
  const { icon, accent } = CURRENCY[type];
  const displayValue = typeof value === 'number' ? value.toLocaleString('en-US') : value;

  return (
    <View
      style={[
        styles.pill,
        // Without the "+" button the pill is just icon + value, so pad both
        // sides evenly; the tight right pad only makes sense next to the button.
        !onPressAdd && { paddingRight: Spacing.md },
        {
          borderColor: withOpacity(accent, 0.4),
          boxShadow: `0px 2px 8px ${withOpacity(Colors.bgBase, 0.5)}`,
        },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={16} color={accent} style={styles.icon} />
      <Text style={styles.value}>{displayValue}</Text>

      {onPressAdd ? (
        <Pressable
          onPress={onPressAdd}
          style={({ pressed }) => [
            styles.addButton,
            {
              backgroundColor: accent,
              boxShadow: `0px 0px 8px ${withOpacity(accent, 0.6)}`,
              transform: [{ scale: pressed ? 0.92 : 1 }],
            },
          ]}
        >
          <Text style={styles.addLabel}>+</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    // Fixed height so both pills (chips/gems) match regardless of the icon
    // glyph's own metrics or the value's line box.
    height: 32,
    gap: Spacing.xs,
    paddingLeft: Spacing.md,
    paddingRight: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    backgroundColor: withOpacity(Colors.bgPanel, 0.85),
  },
  icon: {
    // Kill the glyph's built-in vertical padding so it centres on the text.
    includeFontPadding: false,
  },
  value: {
    fontFamily: Fonts.heading,
    fontSize: 14,
    lineHeight: 16,
    color: Colors.textPrimary,
    includeFontPadding: false,
    textAlignVertical: 'center',
  },
  addButton: {
    width: 30,
    height: 30,
    borderRadius: Radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: Spacing.xs,
  },
  addLabel: {
    fontFamily: Fonts.heading,
    fontSize: 18,
    lineHeight: 18,
    color: Colors.bgBase,
  },
});
// #endregion
