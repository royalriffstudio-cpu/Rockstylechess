import { MaterialCommunityIcons, MaterialIcons } from '@expo/vector-icons';

import { ICONS } from '@/constants/icons';
import { Colors } from '@/constants/theme';

interface AppIconProps {
  name: keyof typeof ICONS;
  size?: number;
  color?: string;
}

export function AppIcon({ name, size = 24, color = Colors.textPrimary }: AppIconProps) {
  const icon = ICONS[name];
  if (!icon) {
    if (__DEV__) {
      console.warn(`AppIcon: no mapping for "${name}"`);
    }
    return <MaterialIcons name="help-outline" size={size} color={color} />;
  }
  if (icon.set === 'community') {
    return <MaterialCommunityIcons name={icon.name as any} size={size} color={color} />;
  }
  return <MaterialIcons name={icon.name as any} size={size} color={color} />;
}
