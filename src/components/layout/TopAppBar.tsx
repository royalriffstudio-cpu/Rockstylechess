import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon } from '@/components/ui/AppIcon';
import { CurrencyPill } from '@/components/ui/CurrencyPill';
import { PlayerAvatar } from '@/components/ui/PlayerAvatar';
import { getAvatarImage } from '@/constants/avatars';
import { Colors } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';

/** Sticky top bar for the primary-tab screens (Home, Iron ID, World Rankings, Friends). */
export function TopAppBar() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, chips, gems } = usePlayerProfile();

  return (
    <View
      className="w-full flex-row items-center justify-between bg-bg-panel px-margin-mobile py-sm"
      style={{
        paddingTop: insets.top + 8,
        borderBottomWidth: 1,
        borderBottomColor: Colors.chromeDark + '4D',
      }}
    >
      <Pressable onPress={() => router.dismissTo('/iron-id')} className="flex-row items-center gap-sm">
        <PlayerAvatar source={getAvatarImage(profile?.avatarId)} size="small" />
        <View>
          <Text className="font-heading-md text-heading-md leading-none text-text-primary">
            {profile?.displayName ?? 'Guest'}
          </Text>
          <Text className="font-caption text-caption uppercase tracking-widest text-ember">
            Lvl {profile?.level ?? 1}
          </Text>
        </View>
      </Pressable>

      <View className="flex-row items-center gap-md">
        <Pressable onPress={() => router.dismissTo('/shop')}>
          <CurrencyPill type="chips" value={chips} />
        </Pressable>
        <Pressable onPress={() => router.dismissTo('/shop')}>
          <CurrencyPill type="gems" value={gems} />
        </Pressable>
        <Pressable onPress={() => router.push('/backstage-alerts')}>
          <View>
            <AppIcon name="notifications" size={22} color={Colors.textPrimary} />
            <View
              style={{
                position: 'absolute',
                top: -2,
                right: -2,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: Colors.ember,
              }}
            />
          </View>
        </Pressable>
      </View>
    </View>
  );
}
