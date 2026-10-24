import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';

import { RockButton } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getMyProfile } from '@/lib/api';
import { signInWithGoogle } from '@/lib/authClient';
import { setAuthToken } from '@/lib/authStorage';
import { setGuestMode } from '@/lib/guestMode';
import { reauthenticateSocket } from '@/lib/socket';

// "Continue with Google", shared by sign-in and sign-up so both behave the same: Google is just another way to get
// the same bearer-token session email/password gives. A brand-new Google account has no stage name yet, so it goes
// through the same onboarding as an email sign-up (pick-rockstar); a returning one goes straight home.
export function GoogleSignInButton() {
  const router = useRouter();
  const { refresh: refreshPlayerProfile } = usePlayerProfile();
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handlePress() {
    if (busy) return;
    setErrorMessage(null);
    setBusy(true);
    try {
      const { token } = await signInWithGoogle();
      await setAuthToken(token);
      reauthenticateSocket(token);
      void setGuestMode(false);
      let needsOnboarding = false;
      try {
        const { profile } = await getMyProfile(token);
        needsOnboarding = !profile.displayName;
      } catch {
        // Profile fetch failed after a good sign-in: land home, the profile provider retries on its own.
      }
      refreshPlayerProfile();
      router.replace(needsOnboarding ? '/pick-rockstar' : '/home');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="gap-sm">
      <RockButton
        label={busy ? 'Opening Google...' : 'Continue with Google'}
        variant="secondary"
        disabled={busy}
        icon={<MaterialCommunityIcons name="google" size={20} color={Colors.textPrimary} />}
        onPress={handlePress}
      />
      {errorMessage ? <Text className="text-center font-body-sm text-body-sm text-crimson">{errorMessage}</Text> : null}
    </View>
  );
}
