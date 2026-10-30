import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton';
import { AppIcon, Checkbox, CurrencyIcon, KeyboardAwareScrollView, RockButton } from '@/components/ui';
import { openLegalDocument, PRIVACY_POLICY_URL, TERMS_OF_SERVICE_URL } from '@/constants/legal';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getMyProfile } from '@/lib/api';
import { EmailProblemError, signUpWithEmail } from '@/lib/authClient';
import { ECONOMY } from '@/lib/economy.generated';
import { setAuthToken } from '@/lib/authStorage';
import { reauthenticateSocket } from '@/lib/socket';

const EMAIL_PROBLEM_TEXT = {
  'invalid-email': "That doesn't look like a valid email address.",
  'email-undeliverable': "We couldn't find a mailbox for that address. Check the spelling after the @.",
  'disposable-email': 'Temporary email addresses can\'t be used. Please use your real email.',
  'email-typo': 'That email looks mistyped.',
} as const;

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh: refreshPlayerProfile } = usePlayerProfile();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  // For a mistyped provider (gmial.com) the server hands back the corrected address to offer.
  const [suggestion, setSuggestion] = useState<string | null>(null);

  async function handleCreateAccount() {
    setSuggestion(null);
    if (!agreedToTerms) {
      setErrorMessage('You must agree to the Terms of Service and Privacy Policy to continue');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage("Passwords don't match");
      return;
    }
    // Cheap first check; the server does the real one (syntax, disposable domains, can the domain receive mail).
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
      setErrorMessage('Enter a valid email address.');
      return;
    }
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const { token } = await signUpWithEmail(email.trim().toLowerCase(), password);
      await setAuthToken(token);
      reauthenticateSocket(token);
      // The shared player-profile context (mounted at the app root) fetched
      // once at launch, before this account existed -- refresh it now so
      // every CurrencyPill reflects the real balance instead of staying in
      // its initial 'guest' state.
      refreshPlayerProfile();
      // A new account whose email is not verified yet is offered the code screen first (skippable); the server
      // already mailed the code at sign-up. Anything unexpected here just continues to onboarding.
      let needsVerification = false;
      try {
        needsVerification = (await getMyProfile(token)).profile.needsEmailVerification === true;
      } catch {
        // fall through to onboarding
      }
      if (needsVerification) {
        router.replace({ pathname: '/verify-email', params: { email: email.trim().toLowerCase(), sent: '1', next: '/pick-rockstar' } });
      } else {
        router.replace('/pick-rockstar');
      }
    } catch (error) {
      if (error instanceof EmailProblemError) {
        setErrorMessage(EMAIL_PROBLEM_TEXT[error.code]);
        setSuggestion(error.suggestion ?? null);
      } else {
        setErrorMessage(error instanceof Error ? error.message : 'Something went wrong');
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <Image source={ScreenArt.signUpArena} style={{ position: 'absolute', inset: 0, opacity: 0.6 }} contentFit="cover" cachePolicy="memory-disk" transition={300} />
      <LinearGradient pointerEvents="none" colors={[withOpacity(Colors.bgBase, 0.4), withOpacity(Colors.bgBase, 0.95)]} style={{ position: 'absolute', inset: 0 }} />

      <KeyboardAwareScrollView
        className="z-10"
        contentContainerClassName="mx-auto w-full max-w-md grow justify-center px-margin-mobile py-xl"
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
          <View className="mb-xl items-center pt-margin-desktop">
            <Text className="mb-sm text-center font-display-hero text-display-hero uppercase tracking-widest text-chrome">Join The Stage</Text>
            <Text className="text-center font-body-sm text-body-sm text-text-muted">Claim your spot in the ultimate high-roller arena.</Text>
          </View>

          <View className="mb-md gap-md rounded-lg p-lg" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.6), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
            <FormField label="Email Address" icon="mail" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <FormField label="Secret Key" icon="lock" value={password} onChangeText={setPassword} secure />
            <FormField label="Confirm Secret Key" icon="lock" value={confirmPassword} onChangeText={setConfirmPassword} secure />

            <View className="flex-row items-start gap-sm px-xs">
              <Checkbox checked={agreedToTerms} onToggle={() => setAgreedToTerms((v) => !v)} style={{ marginTop: 2 }} />
              <Text
                onPress={() => setAgreedToTerms((v) => !v)}
                className="flex-1 font-body-sm text-body-sm text-text-muted"
                style={{ lineHeight: 20 }}
              >
                I agree to the{' '}
                <Text className="font-bold text-cyan" onPress={() => openLegalDocument(TERMS_OF_SERVICE_URL)}>
                  Terms of Service
                </Text>{' '}
                and{' '}
                <Text className="font-bold text-cyan" onPress={() => openLegalDocument(PRIVACY_POLICY_URL)}>
                  Privacy Policy
                </Text>
                .
              </Text>
            </View>

            {errorMessage ? <Text className="text-center font-body-sm text-body-sm text-crimson">{errorMessage}</Text> : null}
            {suggestion ? (
              <Pressable
                onPress={() => {
                  setEmail(suggestion);
                  setSuggestion(null);
                  setErrorMessage(null);
                }}
              >
                <Text className="text-center font-body-sm text-body-sm text-text-muted">
                  Did you mean <Text className="font-bold text-cyan">{suggestion}</Text>? Tap to use it.
                </Text>
              </Pressable>
            ) : null}

            <RockButton
              label={isSubmitting ? 'Creating...' : 'Create Account'}
              icon={<AppIcon name="arrow_forward" size={18} color={Colors.textPrimary} />}
              variant="primary"
              disabled={isSubmitting || !agreedToTerms}
              onPress={handleCreateAccount}
              style={{ marginTop: 4 }}
            />
          </View>

          <LinearGradient
            colors={['#2a220a', Colors.bgPanel]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              marginBottom: 24,
              borderRadius: 15,
              padding: 12,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 12,
              borderWidth: 1,
              borderColor: withOpacity(Colors.gold, 0.3),
              boxShadow: `0px 0px 18px ${withOpacity(Colors.gold, 0.5)}`,
            }}
          >
            <View className="h-12 w-12 items-center justify-center rounded-full" style={{ backgroundColor: Colors.bgPanel }}>
              <CurrencyIcon type="chips" size={22} />
            </View>
            <View>
              <Text className="font-section-header text-section-header uppercase tracking-widest text-gold">Welcome Bonus</Text>
              <Text className="font-heading-md text-heading-md text-text-primary">{ECONOMY.welcomeChips.toLocaleString('en-US')} CHIPS</Text>
              <Text className="font-caption text-caption text-text-muted">FOR NEW ROCKSTARS</Text>
            </View>
          </LinearGradient>

          <View className="items-center gap-md">
            <View className="w-full flex-row items-center gap-sm">
              <View className="h-px flex-1" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.5) }} />
              <Text className="font-caption text-caption uppercase tracking-widest text-chrome-dark">Or Access Via</Text>
              <View className="h-px flex-1" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.5) }} />
            </View>
            <View className="w-full">
              <GoogleSignInButton />
            </View>
            <Pressable onPress={() => router.replace('/sign-in')} className="mt-md">
              <Text className="font-body-sm text-body-sm text-text-muted">
                Already a Rockstar? <Text className="font-bold text-cyan">Sign In</Text>
              </Text>
            </Pressable>
          </View>
      </KeyboardAwareScrollView>
    </View>
  );
}

function FormField({
  label,
  icon,
  value,
  onChangeText,
  secure,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  icon: 'mail' | 'lock';
  value: string;
  onChangeText: (text: string) => void;
  secure?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
}) {
  return (
    <View className="gap-xs">
      <Text className="pl-sm font-section-header text-section-header uppercase tracking-widest text-text-muted">{label}</Text>
      <View className="relative justify-center">
        <View className="absolute left-sm z-10">
          <AppIcon name={icon} size={20} color={Colors.chromeDark} />
        </View>
        <TextInput
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secure}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          className="rounded bg-[#111111] py-md pl-[40px] pr-sm font-body-base text-text-primary"
          style={{ borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
        />
      </View>
    </View>
  );
}

