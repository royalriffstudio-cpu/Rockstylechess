import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, ConfirmModal, CountryFlag, CountryPickerModal, CurrencyPill, PlayerAvatar } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import { getAvatarImage } from '@/constants/avatars';
import { getCountryName } from '@/constants/countries';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { deleteAccount, updateProfile } from '@/lib/api';
import { clearAuthToken, getAuthToken } from '@/lib/authStorage';
import { setGuestMode } from '@/lib/guestMode';
import { clearSocketAuth } from '@/lib/socket';

type LinkedStatus = 'connected' | 'not-linked';

interface LinkedAccount {
  id: string;
  name: string;
  icon: 'account_circle';
  detail: string;
  status: LinkedStatus;
}

const LINKED_ACCOUNTS: LinkedAccount[] = [
  { id: 'google', name: 'Google', icon: 'account_circle', detail: 'gm.player@gmail.com', status: 'connected' },
  { id: 'facebook', name: 'Facebook', icon: 'account_circle', detail: 'Not Linked', status: 'not-linked' },
  { id: 'apple', name: 'Apple ID', icon: 'account_circle', detail: 'Not Linked', status: 'not-linked' },
];

export default function AccountSecurityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, refresh: refreshPlayerProfile, gems } = usePlayerProfile();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);

  async function handleCountrySelect(code: string) {
    const token = await getAuthToken();
    if (!token) return;
    try {
      await updateProfile(token, { country: code });
      refreshPlayerProfile();
    } catch (error) {
      console.log('Country update failed', error);
      Alert.alert('Something went wrong', 'Could not update your country. Please try again.');
    }
  }

  async function confirmDelete() {
    setDeleteVisible(false);
    setIsDeleting(true);
    try {
      const token = await getAuthToken();
      if (!token) {
        // Not signed in (e.g. still a guest) -- nothing server-side to
        // delete, just bail back to the previous screen.
        router.back();
        return;
      }
      await deleteAccount(token);
      await clearAuthToken();
      await setGuestMode(false);
      clearSocketAuth();
      // Same as control-core.tsx's logout -- resets the shared profile
      // context back to its guest state.
      refreshPlayerProfile();
      router.replace('/sign-in');
    } catch (error) {
      console.log('Delete account failed', error);
      Alert.alert('Something went wrong', 'Could not delete your account. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Account Security" trailing={<CurrencyPill type="gems" value={gems} />} />
      <ScrollView contentContainerClassName="mx-auto w-full max-w-md gap-xl px-margin-mobile py-xl" contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}>
        <View className="overflow-hidden rounded-lg p-md" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.5) }}>
          <View className="mx-md my-md flex-row items-center gap-lg">
            <PlayerAvatar source={getAvatarImage(profile?.avatarId)} size="medium" />
            <View>
              <Text className="font-heading-md text-heading-md tracking-wide text-text-primary">{profile?.displayName ?? 'Rockstar'}</Text>
              <View className="mt-1 flex-row items-center gap-xs">
                <AppIcon name="verified" size={14} color={Colors.cyan} />
                <Text className="font-caption text-caption uppercase tracking-wider text-cyan">Status: Verified</Text>
              </View>
            </View>
          </View>
        </View>

        <View className="gap-md">
          <Text className="font-section-header text-section-header uppercase text-text-muted">Country</Text>
          <Pressable
            onPress={() => setCountryPickerOpen(true)}
            className="flex-row items-center justify-between rounded p-md"
            style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
          >
            <View className="flex-row items-center gap-md">
              <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                {profile?.country ? (
                  <CountryFlag code={profile.country} size={18} />
                ) : (
                  <AppIcon name="flag" size={18} color={Colors.textMuted} />
                )}
              </View>
              <View>
                <Text className="font-body-base text-body-base text-text-primary">
                  {getCountryName(profile?.country) ?? 'Not set'}
                </Text>
                <Text className="font-caption text-caption text-text-muted">Shown next to your name</Text>
              </View>
            </View>
            <AppIcon name="chevron_right" size={22} color={Colors.chromeDark} />
          </Pressable>
        </View>

        <View className="gap-md">
          <Text className="font-section-header text-section-header uppercase text-text-muted">External Services</Text>
          <View className="gap-sm">
            {LINKED_ACCOUNTS.map((account) => (
              <View key={account.id} className="flex-row items-center justify-between rounded p-md" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                <View className="flex-row items-center gap-md">
                  <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                    <AppIcon name={account.icon} size={20} color={Colors.textMuted} />
                  </View>
                  <View>
                    <Text className="font-body-base text-body-base text-text-primary">{account.name}</Text>
                    <Text className="font-caption text-caption text-text-muted">{account.detail}</Text>
                  </View>
                </View>
                {account.status === 'connected' ? (
                  <AppIcon name="check_circle" size={20} color={Colors.cyan} />
                ) : (
                  <Pressable
                    className="rounded px-md py-sm"
                    style={{ backgroundColor: Colors.chrome }}
                    onPress={() => console.log('Link account pressed', account.name)}
                  >
                    <Text className="font-display-hero" style={{ fontSize: 11, color: Colors.bgBase, textTransform: 'uppercase' }}>
                      Link Now
                    </Text>
                  </Pressable>
                )}
              </View>
            ))}
          </View>
        </View>

        <View className="gap-md">
          <Text className="font-section-header text-section-header uppercase text-text-muted">Privacy</Text>
          <Pressable
            onPress={() => router.push('/blocked-players')}
            className="flex-row items-center justify-between rounded p-md"
            style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
          >
            <View className="flex-row items-center gap-md">
              <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                <AppIcon name="account_circle" size={18} color={Colors.textMuted} />
              </View>
              <Text className="font-body-base text-body-base text-text-primary">Blocked Players</Text>
            </View>
            <AppIcon name="chevron_right" size={22} color={Colors.chromeDark} />
          </Pressable>
        </View>

        <View className="pt-xl" style={{ borderTopWidth: 1, borderTopColor: withOpacity(Colors.crimson, 0.2) }}>
          <Pressable
            onPress={() => setDeleteVisible(true)}
            disabled={isDeleting}
            className="flex-row items-center justify-between rounded p-md"
            style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.crimson, 0.5), opacity: isDeleting ? 0.6 : 1 }}
          >
            <View className="flex-row items-center gap-md">
              <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.crimson, 0.1), borderWidth: 1, borderColor: withOpacity(Colors.crimson, 0.3) }}>
                <AppIcon name="warning" size={20} color={Colors.crimson} />
              </View>
              <View>
                <Text className="font-heading-md text-heading-md text-crimson">{isDeleting ? 'Deleting...' : 'Delete Account'}</Text>
                <Text className="font-caption text-caption text-text-muted">This action is permanent.</Text>
              </View>
            </View>
            <AppIcon name="chevron_right" size={22} color={Colors.chromeDark} />
          </Pressable>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={deleteVisible}
        variant="danger"
        icon="warning"
        title="Delete Account?"
        message="This is permanent. All ranks, currency, and digital assets will be forfeited immediately."
        confirmLabel="Delete"
        onCancel={() => setDeleteVisible(false)}
        onConfirm={confirmDelete}
      />

      <CountryPickerModal
        visible={countryPickerOpen}
        selectedCode={profile?.country}
        onSelect={handleCountrySelect}
        onClose={() => setCountryPickerOpen(false)}
      />
    </View>
  );
}
