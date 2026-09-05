import { router, type Href } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import type { ICONS } from '@/constants/icons';
import { Colors, Gradients, withOpacity } from '@/constants/theme';

export type NavTab = 'home' | 'ranks' | 'play' | 'shop' | 'profile';

interface BottomNavProps {
  activeTab: NavTab;
  /** Optional side-effect hook; navigation itself is handled internally. */
  onTabPress?: (tab: NavTab) => void;
}

type TabDef = { key: NavTab; label: string; icon: keyof typeof ICONS; center?: boolean };

// Icons + order mirror new_ui's BottomNav (Material Symbols ligatures via
// AppIcon). 'play' is the raised center FAB.
const TABS: TabDef[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'ranks', label: 'Ranks', icon: 'leaderboard' },
  { key: 'play', label: 'Play', icon: 'play_arrow', center: true },
  { key: 'shop', label: 'Shop', icon: 'shopping_cart' },
  { key: 'profile', label: 'Profile', icon: 'person' },
];

const TAB_ROUTE: Record<NavTab, Href> = {
  home: '/home',
  ranks: '/world-rankings',
  play: '/play',
  shop: '/shop',
  profile: '/iron-id',
};

/**
 * Fixed 5-tab bar with a raised center "Play" FAB. Styling migrated from
 * new_ui's BottomNav; self-absolute (pinned to the screen bottom, callers
 * don't wrap it) with a real safe-area bottom inset added on top of new_ui's
 * fixed 80px height.
 *
 * Navigation is handled here via `router.dismissTo` (not `push`) so switching
 * top-level sections doesn't stack history -- "back" from any tab walks up
 * toward Home rather than retracing a trail of tab taps. See
 * src/lib/navigation.ts.
 */
export function BottomNav({ activeTab, onTabPress }: BottomNavProps) {
  const insets = useSafeAreaInsets();

  const handleTab = (tab: NavTab) => {
    if (tab !== activeTab) router.dismissTo(TAB_ROUTE[tab]);
    onTabPress?.(tab);
  };

  return (
    <View
      className="absolute bottom-0 left-0 right-0 flex-row items-end justify-around rounded-t-lg bg-bg-panel px-sm"
      style={{
        height: 80 + insets.bottom,
        paddingBottom: insets.bottom + 4,
        borderTopWidth: 1,
        borderTopColor: withOpacity(Colors.chromeDark, 0.5),
        boxShadow: `0px -4px 20px ${withOpacity(Colors.bgBase, 0.8)}`,
      }}
    >
      {TABS.map((tab) => {
        const isActive = activeTab === tab.key;

        if (tab.center) {
          return (
            <Pressable
              key={tab.key}
              onPress={() => handleTab('play')}
              className="items-center justify-center px-xs py-sm"
              style={{ top: -16 }}
              hitSlop={8}
            >
              <LinearGradient
                colors={Gradients.primaryButton}
                style={{ width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}
              >
                <AppIcon name={tab.icon} size={28} color={Colors.textPrimary} />
              </LinearGradient>
              <Text className="font-caption text-caption uppercase text-text-muted">{tab.label}</Text>
            </Pressable>
          );
        }

        return (
          <Pressable
            key={tab.key}
            onPress={() => handleTab(tab.key)}
            className="items-center justify-center rounded-lg px-md py-sm"
            style={isActive ? { backgroundColor: withOpacity(Colors.cyan, 0.1) } : undefined}
            hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
          >
            <AppIcon name={tab.icon} size={24} color={isActive ? Colors.cyan : Colors.chromeMid} />
            <Text
              className="font-caption text-caption uppercase"
              style={{ color: isActive ? Colors.cyan : Colors.chromeMid, marginTop: 4 }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
