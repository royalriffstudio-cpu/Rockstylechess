import { usePathname } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { Colors } from '@/constants/theme';
import { goUp } from '@/lib/navigation';

interface SubPageHeaderProps {
  title: string;
  trailing?: ReactNode;
  onBack?: () => void;
}

/** Circular back button + centered title + optional trailing slot, shared across sub-pages. */
export function SubPageHeader({ title, trailing, onBack }: SubPageHeaderProps) {
  const pathname = usePathname();
  const insets = useSafeAreaInsets();

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    // "Back" means "up one level toward the main menu", not "pop whatever the
    // last screen happened to be" -- see src/lib/navigation.ts.
    goUp(pathname);
  };

  return (
    <View
      className="w-full flex-row items-center bg-bg-panel px-margin-mobile py-sm"
      style={{
        paddingTop: insets.top + 8,
        borderBottomWidth: 1,
        borderBottomColor: Colors.chromeDark + '4D',
      }}
    >
      <Pressable
        onPress={handleBack}
        className="h-10 w-10 items-center justify-center rounded-full"
        style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: Colors.chromeDark + '80' }}
      >
        <AppIcon name="arrow_back" size={22} color={Colors.textPrimary} />
      </Pressable>

      <View className="flex-1" />
      {trailing ?? <View style={{ width: 40 }} />}

      {/* Absolutely centred so an asymmetric trailing slot (e.g. two currency
          pills) can't shove the title off-centre. Sits behind the buttons;
          `left`/`right` keep it clear of the back button. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 60, right: 60, top: insets.top + 8, bottom: 8, alignItems: 'center', justifyContent: 'center' }}
      >
        <Text
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          className="text-center font-headline-lg uppercase text-text-primary"
          style={{ fontSize: 22, letterSpacing: 1 }}
        >
          {title}
        </Text>
      </View>
    </View>
  );
}
