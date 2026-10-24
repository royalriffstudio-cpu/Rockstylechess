import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { KeyboardAwareScrollView, RockButton, RockCard } from '@/components/ui';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { ECONOMY } from '@/lib/economy.generated';
import { requestEmailCode, verifyEmailCode } from '@/lib/authClient';

const RESEND_SECONDS = 60;

// Enter the 6-digit code mailed to the account's email. Reached from sign-up (the server already mailed a code:
// `sent=1`), from the "verify your email" prompt and from Account Security (a fresh code is requested on arrival).
// Skippable: an unverified account can still play bots, puzzles and the Tour; online play, friends and the welcome
// bonus unlock once the code is accepted.
export default function VerifyEmailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ email?: string; sent?: string; next?: string }>();
  const { profile, refresh: refreshPlayerProfile } = usePlayerProfile();
  const email = (params.email ?? profile?.email ?? '').toLowerCase();
  const next = (params.next ?? '/home') as Href;

  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(params.sent === '1' ? RESEND_SECONDS : 0);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [cooldown]);

  const sendCode = useCallback(async () => {
    if (!email) return;
    setError(null);
    setInfo(null);
    try {
      await requestEmailCode(email);
      setInfo(`We sent a 6-digit code to ${email}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the code.');
    }
    setCooldown(RESEND_SECONDS);
  }, [email]);

  // Arriving from anywhere but sign-up: nobody has mailed a code yet.
  useEffect(() => {
    if (params.sent === '1') setInfo(`We sent a 6-digit code to ${email || 'your email'}.`);
    else if (email) void sendCode();
    // Once per arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [email]);

  async function handleVerify() {
    if (busy || code.length !== 6) return;
    setError(null);
    setBusy(true);
    try {
      await verifyEmailCode(email, code);
      await refreshPlayerProfile();
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  const bonusJustPaid = done && profile?.welcomeBonusPending === false;

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
            {done ? 'Verified' : 'Check Your Email'}
          </Text>
          <Text className="text-center font-body-base text-body-base text-text-muted">
            {done
              ? bonusJustPaid
                ? `Your email is confirmed and your ${ECONOMY.welcomeChips.toLocaleString('en-US')} welcome chips are in your vault.`
                : 'Your email is confirmed. Online play is unlocked.'
              : `Enter the 6-digit code we sent to ${email || 'your email'}. It expires in 10 minutes.`}
          </Text>
        </View>

        <RockCard variant="surface">
          {done ? (
            <RockButton label="Continue" variant="gold" onPress={() => router.replace(next)} />
          ) : (
            <View className="gap-md">
              <TextInput
                value={code}
                onChangeText={(t) => setCode(t.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                maxLength={6}
                textContentType="oneTimeCode"
                autoComplete="one-time-code"
                placeholder="000000"
                placeholderTextColor={withOpacity(Colors.chromeDark, 0.6)}
                className="rounded-lg px-md py-md text-center font-display-hero text-text-primary"
                style={{ fontSize: 32, letterSpacing: 10, backgroundColor: Colors.bgBase, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
              />
              {info && !error ? <Text className="text-center font-body-sm text-body-sm text-text-muted">{info}</Text> : null}
              {error ? <Text className="text-center font-body-sm text-body-sm text-crimson">{error}</Text> : null}
              <RockButton label={busy ? 'Checking...' : 'Verify'} variant="primary" disabled={busy || code.length !== 6} onPress={handleVerify} />
              <Pressable onPress={() => void sendCode()} disabled={cooldown > 0 || !email} hitSlop={10}>
                <Text className="text-center font-body-sm text-body-sm" style={{ color: cooldown > 0 ? Colors.textMuted : Colors.cyan }}>
                  {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
                </Text>
              </Pressable>
            </View>
          )}
        </RockCard>

        {!done ? (
          <View className="gap-sm">
            <RockButton label="Skip for now" variant="secondary" onPress={() => router.replace(next)} />
            <Text className="text-center font-caption text-caption text-text-muted">
              You can still play bots, puzzles and the Tour. Online matches, friends and your welcome bonus unlock once your email is verified.
            </Text>
          </View>
        ) : null}
      </KeyboardAwareScrollView>
    </View>
  );
}
