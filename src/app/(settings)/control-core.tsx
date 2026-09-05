import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, ConfirmModal, CurrencyPill, EmberParticles, PlayerAvatar, RockCard } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import type { ICONS } from '@/constants/icons';
import { getAvatarImage } from '@/constants/avatars';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { loadMusicPreference, setMusicEnabled } from '@/lib/backgroundMusic';
import { clearAuthToken } from '@/lib/authStorage';
import { clearSocketAuth } from '@/lib/socket';
import { loadSoundFxPreference, setSoundFxEnabled } from '@/lib/soundEffects';

interface GameRow {
  id: string;
  icon: keyof typeof ICONS;
  label: string;
  subtitle: string;
  trailing?: string;
  action: () => void;
}

function SettingsRow({ icon, title, subtitle, trailing, last, onPress }: { icon: keyof typeof ICONS; title: string; subtitle: string; trailing?: string; last?: boolean; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-between p-md" style={!last ? { borderBottomWidth: 1, borderBottomColor: withOpacity(Colors.chromeDark, 0.2) } : undefined}>
      <View className="flex-row items-center gap-md">
        <View className="h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
          <AppIcon name={icon} size={20} color={Colors.cyan} />
        </View>
        <View>
          <Text className="font-heading-md text-heading-md text-text-primary">{title}</Text>
          <Text className="font-body-sm text-body-sm text-text-muted">{subtitle}</Text>
        </View>
      </View>
      <View className="flex-row items-center gap-sm">
        {trailing ? (
          <Text className="font-body-sm text-body-sm text-cyan">{trailing}</Text>
        ) : null}
        <AppIcon name="chevron_right" size={22} color={Colors.textMuted} />
      </View>
    </Pressable>
  );
}

function ToggleRow({ icon, title, subtitle, value, onValueChange, last }: { icon: keyof typeof ICONS; title: string; subtitle: string; value: boolean; onValueChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View className="flex-row items-center justify-between p-md" style={!last ? { borderBottomWidth: 1, borderBottomColor: withOpacity(Colors.chromeDark, 0.2) } : undefined}>
      <View className="flex-row items-center gap-md">
        <View className="h-10 w-10 items-center justify-center rounded-lg" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}>
          <AppIcon name={icon} size={20} color={Colors.ember} />
        </View>
        <View>
          <Text className="font-heading-md text-heading-md text-text-primary">{title}</Text>
          <Text className="font-body-sm text-body-sm text-text-muted">{subtitle}</Text>
        </View>
      </View>
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: withOpacity(Colors.chromeDark, 0.4), true: withOpacity(Colors.ember, 0.6) }}
        thumbColor={value ? Colors.ember : Colors.chrome}
        ios_backgroundColor={withOpacity(Colors.chromeDark, 0.4)}
      />
    </View>
  );
}

export default function ControlCoreScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [musicOn, setMusicOn] = useState(true);
  const [soundFxOn, setSoundFxOn] = useState(true);
  const [logoutVisible, setLogoutVisible] = useState(false);
  const { profile, refresh: refreshPlayerProfile, gems } = usePlayerProfile();

  useEffect(() => {
    loadSoundFxPreference().then(setSoundFxOn);
    loadMusicPreference().then(setMusicOn);
  }, []);

  function handleSoundFxChange(value: boolean) {
    setSoundFxOn(value);
    setSoundFxEnabled(value);
  }

  function handleMusicChange(value: boolean) {
    setMusicOn(value);
    setMusicEnabled(value);
  }

  async function handleLogout() {
    setLogoutVisible(false);
    await clearAuthToken();
    clearSocketAuth();
    // Resets the shared profile context back to its guest state (no token
    // -> refresh() resolves to status: 'guest'), so a next sign-in/sign-up
    // doesn't briefly show the previous account's stale balance.
    refreshPlayerProfile();
    router.replace('/sign-up');
  }

  const gameRows: GameRow[] = [
    { id: 'notifications', icon: 'notifications', label: 'Notifications', subtitle: 'Match, reward, and social alerts', action: () => router.push('/backstage-alerts') },
    { id: 'language', icon: 'menu_book', label: 'Language', subtitle: 'Display language', trailing: 'English', action: () => console.log('Language pressed') },
    { id: 'terms', icon: 'style', label: 'Terms of Service', subtitle: 'Legal & privacy', action: () => console.log('Terms of Service pressed') },
    { id: 'support', icon: 'support_agent', label: 'Help & Support', subtitle: 'Get help from the crew', action: () => router.push('/roadie-support') },
  ];

  return (
    <View className="flex-1 bg-bg-base">
      <EmberParticles count={10} />
      <SubPageHeader title="Control Core" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView contentContainerClassName="gap-xl px-margin-mobile py-xl" contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}>
        <View className="gap-sm">
          <Text className="px-xs font-section-header text-section-header uppercase tracking-widest text-text-muted">Account Identity</Text>
          <RockCard variant="surface" contentPadding={0}>
            <View className="flex-row items-center justify-between p-md">
              <View className="flex-row items-center gap-md">
                <PlayerAvatar source={getAvatarImage(profile?.avatarId)} size="medium" />
                <View>
                  <Text className="font-heading-md text-heading-md text-text-primary">{profile?.displayName ?? 'Rockstar'}</Text>
                  <Text className="font-body-sm text-body-sm text-gold">Level {profile?.level ?? 1}</Text>
                </View>
              </View>
              <Pressable onPress={() => router.push('/account-security')} className="rounded-full px-md py-sm" style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.3) }}>
                <Text className="font-button-label text-button-label text-text-primary">Edit Profile</Text>
              </Pressable>
            </View>
          </RockCard>
        </View>

        <View className="gap-sm">
          <Text className="px-xs font-section-header text-section-header uppercase tracking-widest text-text-muted">Audio Environment</Text>
          <RockCard variant="surface" contentPadding={0}>
            <ToggleRow icon="music_note" title="Mainstage Music" subtitle="Ambient stage themes" value={musicOn} onValueChange={handleMusicChange} />
            <ToggleRow icon="volume_up" title="Sound FX" subtitle="Piece moves & alerts" value={soundFxOn} onValueChange={handleSoundFxChange} last />
          </RockCard>
        </View>

        <View className="gap-sm">
          <Text className="px-xs font-section-header text-section-header uppercase tracking-widest text-text-muted">Game</Text>
          <RockCard variant="surface" contentPadding={0}>
            {gameRows.map((row, index) => (
              <SettingsRow key={row.id} icon={row.icon} title={row.label} subtitle={row.subtitle} trailing={row.trailing} last={index === gameRows.length - 1} onPress={row.action} />
            ))}
          </RockCard>
        </View>

        <View className="mt-md gap-sm">
          <Text className="px-xs font-section-header text-section-header uppercase tracking-widest text-crimson">Danger Zone</Text>
          <Pressable
            onPress={() => setLogoutVisible(true)}
            className="flex-row items-center justify-center gap-sm rounded-full py-md"
            style={{ backgroundColor: withOpacity(Colors.crimson, 0.8), borderWidth: 1, borderColor: withOpacity(Colors.crimson, 0.5), boxShadow: `0px 0px 12px ${withOpacity(Colors.crimson, 0.25)}` }}
          >
            <AppIcon name="logout" size={18} color={Colors.textPrimary} />
            <Text className="font-button-label text-button-label uppercase tracking-wide text-text-primary">Logout</Text>
          </Pressable>
          <Text className="text-center font-body-sm text-body-sm text-text-muted" style={{ opacity: 0.5 }}>
            App Version 2.4.0-STAGE-CORE
          </Text>
        </View>
      </ScrollView>

      <ConfirmModal
        visible={logoutVisible}
        variant="danger"
        icon="logout"
        title="Log Out?"
        message="You'll need to sign back in to access your Rockstar profile, chips, and gems."
        confirmLabel="Logout"
        onCancel={() => setLogoutVisible(false)}
        onConfirm={handleLogout}
      />
    </View>
  );
}
