import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, ConfirmModal, CountryFlag, CountryPickerModal, CurrencyPill, PlayerAvatar } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import { getCountryName } from '@/constants/countries';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { deleteAccount, updateProfile } from '@/lib/api';
import { clearAuthToken, getAuthToken } from '@/lib/authStorage';
import { linkGoogleAccount } from '@/lib/authClient';
import { setGuestMode } from '@/lib/guestMode';
import { clearSocketAuth } from '@/lib/socket';

export default function AccountSecurityScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { profile, refresh: refreshPlayerProfile, gems } = usePlayerProfile();
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteVisible, setDeleteVisible] = useState(false);
  const [countryPickerOpen, setCountryPickerOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const methods = profile?.signInMethods ?? [];
  const signInRows = [
    { id: 'password', name: 'Email & password', detail: methods.includes('password') ? (profile?.email ?? '') : 'Not set', linked: methods.includes('password') },
    { id: 'google', name: 'Google', detail: methods.includes('google') ? 'Connected' : 'Not linked', linked: methods.includes('google') },
  ];

  // Opens Google in the browser tab; whether it worked is read back from the profile (cancelled = still unlinked).
  async function handleLinkGoogle() {
    if (linking) return;
    setLinking(true);
    try {
      const token = await getAuthToken();
      if (!token) return;
      await linkGoogleAccount(token);
      await refreshPlayerProfile();
    } catch (error) {
      console.log('Google link failed', error);
      Alert.alert('Could not link Google', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setLinking(false);
    }
  }

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
            <PlayerAvatar avatarId={profile?.avatarId ?? null} size="medium" />
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

        {profile ? (
          <View className="gap-md">
            <Text className="font-section-header text-section-header uppercase text-text-muted">Sign-in Methods</Text>
            <View className="gap-sm">
              {methods.includes('password') ? (
                <View className="flex-row items-center justify-between rounded p-md" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                  <View className="flex-row items-center gap-md">
                    <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                      <AppIcon name="mail" size={20} color={Colors.textMuted} />
                    </View>
                    <View>
                      <Text className="font-body-base text-body-base text-text-primary">Email</Text>
                      <Text className="font-caption text-caption text-text-muted">
                        {profile?.emailVerified ? 'Verified' : profile?.needsEmailVerification ? 'Not verified: online play is locked' : 'Not verified'}
                      </Text>
                    </View>
                  </View>
                  {profile?.emailVerified ? (
                    <AppIcon name="check_circle" size={20} color={Colors.cyan} />
                  ) : (
                    <Pressable
                      className="rounded px-md py-sm"
                      style={{ backgroundColor: Colors.chrome }}
                      onPress={() => router.push({ pathname: '/verify-email', params: { next: '/account-security' } })}
                    >
                      <Text className="font-display-hero" style={{ fontSize: 11, color: Colors.bgBase, textTransform: 'uppercase' }}>
                        Verify Now
                      </Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
              {signInRows.map((row) => (
                <View key={row.id} className="flex-row items-center justify-between rounded p-md" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                  <View className="flex-row items-center gap-md">
                    <View className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
                      <AppIcon name="account_circle" size={20} color={Colors.textMuted} />
                    </View>
                    <View>
                      <Text className="font-body-base text-body-base text-text-primary">{row.name}</Text>
                      {row.detail ? <Text className="font-caption text-caption text-text-muted">{row.detail}</Text> : null}
                    </View>
                  </View>
                  {row.linked ? (
                    <AppIcon name="check_circle" size={20} color={Colors.cyan} />
                  ) : row.id === 'google' ? (
                    <Pressable className="rounded px-md py-sm" style={{ backgroundColor: Colors.chrome, opacity: linking ? 0.6 : 1 }} disabled={linking} onPress={handleLinkGoogle}>
                      <Text className="font-display-hero" style={{ fontSize: 11, color: Colors.bgBase, textTransform: 'uppercase' }}>
                        {linking ? 'Opening...' : 'Link Now'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </View>
          </View>
        ) : null}

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
