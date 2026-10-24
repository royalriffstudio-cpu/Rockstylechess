import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAwareScrollView, RockButton, RockCard } from '@/components/ui';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { requestPasswordReset, resetPasswordWithCode } from '@/lib/authClient';

const RESEND_SECONDS = 60;
const FIELD_STYLE = { backgroundColor: Colors.bgBase, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) };

// Forgot password, in two steps on one screen: email -> mailed 6-digit code + a new password. The server answers
// the first step the same way whether or not the email has an account, so this screen never says which it is.
export default function ForgotPasswordScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<'email' | 'reset' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  async function sendCode() {
    const address = email.trim().toLowerCase();
    if (!address.includes('@')) {
      setError('Enter the email you signed up with.');
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await requestPasswordReset(address);
      setEmail(address);
      setStep('reset');
      setCooldown(RESEND_SECONDS);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  async function submitReset() {
    if (password.length < 8) {
      setError('Your new password needs at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await resetPasswordWithCode(email, code, password);
      setStep('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <Image source={ScreenArt.signInArena} style={{ position: 'absolute', inset: 0, opacity: 0.5 }} contentFit="cover" cachePolicy="memory-disk" transition={300} />
      <LinearGradient pointerEvents="none" colors={[withOpacity(Colors.bgBase, 0.4), withOpacity(Colors.bgBase, 0.9), Colors.bgBase]} style={{ position: 'absolute', inset: 0 }} />

      <KeyboardAwareScrollView
        className="z-10"
        contentContainerClassName="mx-auto w-full max-w-md grow justify-center gap-xl p-margin-mobile"
        contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View className="items-center gap-sm">
          <Text
            className="text-center font-display-hero text-display-hero uppercase tracking-widest text-cyan"
            style={{ textShadowColor: Colors.cyan, textShadowRadius: 15, textShadowOffset: { width: 0, height: 0 } }}
          >
            {step === 'done' ? 'All Set' : 'Reset Password'}
          </Text>
          <Text className="text-center font-body-base text-body-base text-text-muted">
            {step === 'email' && "Enter your email and we'll send you a code."}
            {step === 'reset' && `If ${email} has an account, a 6-digit code is on its way. Enter it with your new password.`}
            {step === 'done' && 'Your password has been changed. Sign in with the new one.'}
          </Text>
        </View>

        <RockCard variant="surface">
          {step === 'email' ? (
            <View className="gap-md">
              <TextInput
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="Email"
                placeholderTextColor={withOpacity(Colors.chromeDark, 0.7)}
                className="rounded-lg px-md py-sm font-body-base text-text-primary"
                style={FIELD_STYLE}
              />
              {error ? <Text className="text-center font-body-sm text-body-sm text-crimson">{error}</Text> : null}
              <RockButton label={busy ? 'Sending...' : 'Send Code'} variant="primary" disabled={busy} onPress={sendCode} />
            </View>
          ) : null}

          {step === 'reset' ? (
            <View className="gap-md">
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
                placeholder="000000"
                placeholderTextColor={withOpacity(Colors.chromeDark, 0.6)}
                className="rounded-lg px-md py-sm text-center font-display-hero text-text-primary"
                style={[FIELD_STYLE, { fontSize: 26, letterSpacing: 8 }]}
              />
              <TextInput value={password} onChangeText={setPassword} secureTextEntry placeholder="New password" placeholderTextColor={withOpacity(Colors.chromeDark, 0.7)} className="rounded-lg px-md py-sm font-body-base text-text-primary" style={FIELD_STYLE} />
              <TextInput value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry placeholder="Confirm new password" placeholderTextColor={withOpacity(Colors.chromeDark, 0.7)} className="rounded-lg px-md py-sm font-body-base text-text-primary" style={FIELD_STYLE} />
              {error ? <Text className="text-center font-body-sm text-body-sm text-crimson">{error}</Text> : null}
              <RockButton label={busy ? 'Saving...' : 'Change Password'} variant="primary" disabled={busy || code.length !== 6} onPress={submitReset} />
              <Pressable onPress={sendCode} disabled={cooldown > 0 || busy} hitSlop={10}>
                <Text className="text-center font-body-sm text-body-sm" style={{ color: cooldown > 0 ? Colors.textMuted : Colors.cyan }}>
                  {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
                </Text>
              </Pressable>
            </View>
          ) : null}

          {step === 'done' ? <RockButton label="Back to Sign In" variant="gold" onPress={() => router.replace('/sign-in')} /> : null}
        </RockCard>

        {step !== 'done' ? (
          <Pressable onPress={() => router.replace('/sign-in')}>
            <Text className="text-center font-body-sm text-body-sm text-text-muted">
              Remembered it? <Text className="font-semibold text-cyan">Sign In</Text>
            </Text>
          </Pressable>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
