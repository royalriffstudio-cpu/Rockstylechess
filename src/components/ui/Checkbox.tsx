import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { Colors, withOpacity } from '@/constants/theme';

import { AppIcon } from './AppIcon';

interface CheckboxProps {
  checked: boolean;
  onToggle: () => void;
  /** Merged onto the pressable box itself -- e.g. for the top-alignment
   * offset a caller needs when it sits next to multi-line label text. */
  style?: StyleProp<ViewStyle>;
}

// A plain, laid-out-in-flow checkbox -- no absolute positioning, so it can
// never end up "floating" independently of the label text it sits next to.
// Kept separate from the label's Pressable/Text (see how sign-up.tsx uses
// this) so tapping a link inside the label doesn't also toggle this box.
export function Checkbox({ checked, onToggle, style }: CheckboxProps) {
  return (
    <Pressable
      onPress={onToggle}
      hitSlop={10}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      style={[
        {
          height: 22,
          width: 22,
          borderRadius: 5,
          borderWidth: 1.5,
          borderColor: checked ? Colors.ember : withOpacity(Colors.chromeDark, 0.7),
          backgroundColor: checked ? withOpacity(Colors.ember, 0.18) : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      {checked ? <AppIcon name="check" size={15} color={Colors.ember} /> : null}
    </Pressable>
  );
}
