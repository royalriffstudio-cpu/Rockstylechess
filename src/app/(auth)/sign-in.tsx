import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EmberParticles, RockButton, RockCard } from '@/components/ui';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { signInWithEmail } from '@/lib/authClient';
import { setAuthToken } from '@/lib/authStorage';
import { reauthenticateSocket } from '@/lib/socket';

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { refresh: refreshPlayerProfile } = usePlayerProfile();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSignIn() {
    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      const { token } = await signInWithEmail(email.trim().toLowerCase(), password);
      await setAuthToken(token);
      reauthenticateSocket(token);
      // See sign-up.tsx's identical call -- picks up the now-signed-in
      // account's real balance instead of the initial 'guest' state.
      refreshPlayerProfile();
      router.replace('/home');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <Image source={ScreenArt.signInArena} style={{ position: 'absolute', inset: 0, opacity: 0.4 }} contentFit="cover" cachePolicy="memory-disk" transition={300} />
      {/* Darkens toward the bottom so the form sits on solid black while the
          arena still reads at the top -- matches new_ui + sign-up.tsx. */}
      <LinearGradient
        pointerEvents="none"
        colors={[withOpacity(Colors.bgBase, 0.8), withOpacity(Colors.bgBase, 0.6), Colors.bgBase]}
        style={{ position: 'absolute', inset: 0 }}
      />
      <EmberParticles count={12} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
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
              Welcome Back
            </Text>
            <Text className="text-center font-body-base text-body-base text-text-muted">Sign back in to the Arena.</Text>
          </View>

          <RockCard variant="surface">
            <View className="gap-lg">
              <View className="gap-md">
                <AuthInput label="Email" placeholder="you@rockstyle.chess" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                <AuthInput
                  label="Password"
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  trailing={
                    <Pressable onPress={() => console.log('Forgot Password pressed')}>
                      <Text className="font-caption text-caption text-cyan">Forgot Password?</Text>
                    </Pressable>
                  }
                />

                {errorMessage ? <Text className="text-center font-body-sm text-body-sm text-crimson">{errorMessage}</Text> : null}

                <RockButton label={isSubmitting ? 'Signing in...' : 'Sign In'} variant="primary" disabled={isSubmitting} onPress={handleSignIn} style={{ marginTop: 4 }} />
              </View>

              <View className="gap-sm">
                <View className="flex-row items-center gap-md">
                  <View className="h-px flex-1 bg-chrome-dark/30" />
                  <Text className="font-caption text-caption uppercase text-chrome-dark">Or continue with</Text>
                  <View className="h-px flex-1 bg-chrome-dark/30" />
                </View>
                <View className="flex-row justify-center gap-md">
                  <SocialButton icon="google" onPress={() => console.log('Continue with Google')} />
                  <SocialButton icon="facebook" onPress={() => console.log('Continue with Facebook')} />
                  <SocialButton icon="apple" onPress={() => console.log('Continue with Apple')} />
                </View>
              </View>
            </View>
          </RockCard>

          <Pressable onPress={() => router.push('/sign-up')}>
            <Text className="text-center font-body-sm text-body-sm text-text-muted">
              New here? <Text className="font-semibold text-cyan">Join the Stage</Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

interface AuthInputProps {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (text: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: 'default' | 'email-address';
  autoCapitalize?: 'none' | 'sentences';
  trailing?: ReactNode;
}

function AuthInput({ label, placeholder, value, onChangeText, secureTextEntry, keyboardType, autoCapitalize, trailing }: AuthInputProps) {
  return (
    <View className="gap-xs">
      <View className="flex-row items-center justify-between">
        <Text className="font-section-header text-section-header uppercase text-text-muted">{label}</Text>
        {trailing}
      </View>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={Colors.chromeDark}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        className="rounded-lg px-md py-sm font-body-base text-text-primary"
        style={{ backgroundColor: Colors.bgBase, borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
      />
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
