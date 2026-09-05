import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, CurrencyIcon, EmberParticles, RockButton } from '@/components/ui';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { signUpWithEmail } from '@/lib/authClient';
import { setAuthToken } from '@/lib/authStorage';
import { reauthenticateSocket } from '@/lib/socket';

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh: refreshPlayerProfile } = usePlayerProfile();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleCreateAccount() {
    if (password !== confirmPassword) {
      setErrorMessage("Passwords don't match");
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
      router.replace('/pick-rockstar');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <Image source={ScreenArt.signUpArena} style={{ position: 'absolute', inset: 0, opacity: 0.6 }} contentFit="cover" cachePolicy="memory-disk" transition={300} />
      <LinearGradient pointerEvents="none" colors={[withOpacity(Colors.bgBase, 0.4), withOpacity(Colors.bgBase, 0.95)]} style={{ position: 'absolute', inset: 0 }} />
      <EmberParticles count={12} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
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
            <FormField label="Email Address" icon="mail" placeholder="you@rockstar.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
            <FormField label="Secret Key" icon="lock" placeholder="••••••••" value={password} onChangeText={setPassword} secure />
            <FormField label="Confirm Secret Key" icon="lock" placeholder="••••••••" value={confirmPassword} onChangeText={setConfirmPassword} secure />

            {errorMessage ? <Text className="text-center font-body-sm text-body-sm text-crimson">{errorMessage}</Text> : null}

            <RockButton
              label={isSubmitting ? 'Creating...' : 'Create Account'}
              icon={<AppIcon name="arrow_forward" size={18} color={Colors.textPrimary} />}
              variant="primary"
              disabled={isSubmitting}
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
              <Text className="font-heading-md text-heading-md text-text-primary">10,000 CHIPS</Text>
              <Text className="font-caption text-caption text-text-muted">FOR NEW ROCKSTARS</Text>
            </View>
          </LinearGradient>

          <View className="items-center gap-md">
            <View className="w-full flex-row items-center gap-sm">
              <View className="h-px flex-1" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.5) }} />
              <Text className="font-caption text-caption uppercase tracking-widest text-chrome-dark">Or Access Via</Text>
              <View className="h-px flex-1" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.5) }} />
            </View>
            <View className="flex-row gap-md">
              <SocialButton icon="google" onPress={() => console.log('Continue with Google')} />
              <SocialButton icon="facebook" onPress={() => console.log('Continue with Facebook')} />
              <SocialButton icon="apple" onPress={() => console.log('Continue with Apple')} />
            </View>
            <Pressable onPress={() => router.push('/sign-in')} className="mt-md">
              <Text className="font-body-sm text-body-sm text-text-muted">
                Already a Rockstar? <Text className="font-bold text-cyan">Sign In</Text>
              </Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FormField({
  label,
  icon,
  placeholder,
  value,
  onChangeText,
  secure,
  keyboardType,
  autoCapitalize,
}: {
  label: string;
  icon: 'mail' | 'lock';
  placeholder: string;
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
          placeholder={placeholder}
          placeholderTextColor={Colors.chromeDark}
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

function SocialButton({ icon, onPress }: { icon: keyof typeof MaterialCommunityIcons.glyphMap; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="h-14 w-14 items-center justify-center rounded-full"
      style={({ pressed }) => [
        { backgroundColor: withOpacity(Colors.chromeDark, 0.3), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) },
        { transform: [{ scale: pressed ? 0.9 : 1 }] },
      ]}
    >
      <MaterialCommunityIcons name={icon} size={22} color={Colors.textMuted} />
    </Pressable>
  );
}
