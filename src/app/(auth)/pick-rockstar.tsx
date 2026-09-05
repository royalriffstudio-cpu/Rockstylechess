import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, BottomNav, CurrencyPill, PlayerAvatar, RockButton, SectionLabel } from '@/components/ui';
import { AVATARS, type AvatarOption } from '@/constants/avatars';
import { Colors, withOpacity } from '@/constants/theme';
import { updateProfile } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

export default function PickRockstarScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [selectedId, setSelectedId] = useState('axe');
  const [stageName, setStageName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  function handleSelect(option: AvatarOption) {
    if (option.locked) {
      console.log('Locked rockstar tapped', option.name, option.gemPrice, 'gems');
      return;
    }
    setSelectedId(option.id);
  }

  async function handleContinue() {
    setIsSubmitting(true);
    try {
      const token = await getAuthToken();
      if (token) {
        await updateProfile(token, { displayName: stageName || undefined, avatarId: selectedId });
      }
    } catch (error) {
      // Non-fatal -- the onboarding flow shouldn't get stuck over a profile
      // update failing; the player can still play, just without a saved
      // stage name/avatar until they update their profile again later.
      console.log('Profile update failed', error);
    } finally {
      setIsSubmitting(false);
      router.replace('/welcome-reward');
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <View
        className="flex-row items-center justify-between px-lg pb-md"
        style={{ paddingTop: insets.top + 16, backgroundColor: withOpacity(Colors.bgPanel, 0.85), borderBottomWidth: 1, borderBottomColor: withOpacity(Colors.gold, 0.15) }}
      >
        <View className="flex-row items-center gap-sm">
          <PlayerAvatar emoji="🎸" size="small" />
          <Text className="font-display-hero text-text-primary" style={{ fontSize: 16, color: Colors.cyan }}>
            RockStyle Chess
          </Text>
        </View>
        <View className="rounded-full px-md py-xs" style={{ borderWidth: 1, borderColor: Colors.chromeDark, backgroundColor: withOpacity(Colors.bgBase, 0.5) }}>
          <Text className="font-section-header" style={{ fontSize: 13, color: Colors.emberLight }}>
            XP: 2400
          </Text>
        </View>
      </View>

      <ScrollView contentContainerClassName="items-center gap-xl px-lg py-xl" contentContainerStyle={{ paddingBottom: 120 + insets.bottom }} showsVerticalScrollIndicator={false}>
        <View className="items-center">
          <Text className="text-center font-display-hero text-display-hero uppercase tracking-widest text-text-primary" style={{ fontSize: 26 }}>
            Pick Your Rockstar
          </Text>
          <Text className="mt-xs font-section-header text-section-header uppercase tracking-widest text-text-muted">Select your stage persona</Text>
        </View>

        <View className="w-full flex-row flex-wrap justify-between gap-y-xl" style={{ maxWidth: 440 }}>
          {AVATARS.map((option) => {
            const isSelected = !option.locked && selectedId === option.id;
            return (
              <Pressable key={option.id} onPress={() => handleSelect(option)} className="items-center gap-xs" style={({ pressed }) => [{ width: '47%' }, { transform: [{ scale: pressed ? 0.96 : 1 }] }]}>
                <View className="items-center justify-center" style={{ width: 100, height: 100 }}>
                  <View style={{ opacity: option.locked ? 0.5 : 1 }}>
                    <PlayerAvatar source={option.image} size="large" selected={isSelected} />
                  </View>
                  {option.locked ? (
                    <View className="items-center justify-center" style={{ position: 'absolute', top: 0, width: 100, height: 100, borderRadius: 50, backgroundColor: withOpacity(Colors.bgBase, 0.35) }}>
                      <MaterialCommunityIcons name="lock" size={26} color={Colors.gold} />
                    </View>
                  ) : null}
                  {isSelected ? (
                    <View style={{ position: 'absolute', top: 4, right: 4 }}>
                      <AppIcon name="check_circle" size={18} color={Colors.cyan} />
                    </View>
                  ) : null}
                </View>

                <Text className="font-section-header" style={{ fontSize: 16, letterSpacing: 1, color: isSelected ? Colors.cyan : Colors.textMuted }}>
                  {option.name}
                </Text>

                {option.locked ? (
                  <CurrencyPill type="gems" value={option.gemPrice ?? 0} />
                ) : isSelected ? (
                  <View className="rounded-full px-sm" style={{ paddingVertical: 2, backgroundColor: withOpacity(Colors.cyan, 0.18), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.45) }}>
                    <Text className="font-section-header" style={{ fontSize: 11, letterSpacing: 1, color: Colors.cyan }}>
                      SELECTED
                    </Text>
                  </View>
                ) : (
                  <Text className="font-section-header" style={{ fontSize: 11, letterSpacing: 1, color: Colors.textMuted }}>
                    STARTER
                  </Text>
                )}
              </Pressable>
            );
          })}

          <View className="items-center gap-xs" style={{ width: '47%' }}>
            <View
              className="items-center justify-center"
              style={{ width: 100, height: 100, borderRadius: 50, borderWidth: 2, borderStyle: 'dashed', borderColor: withOpacity(Colors.chromeDark, 0.6) }}
            >
              <MaterialCommunityIcons name="plus" size={32} color={Colors.chromeMid} />
            </View>
            <Text className="font-section-header" style={{ fontSize: 16, letterSpacing: 1, color: withOpacity(Colors.textMuted, 0.6) }}>
              COMING
            </Text>
            <Text className="font-section-header" style={{ fontSize: 11, letterSpacing: 1, color: Colors.textMuted }}>
              SOON
            </Text>
          </View>
        </View>

        <View className="w-full" style={{ maxWidth: 440 }}>
          <SectionLabel label="Stage Name" />
          <TextInput
            className="mt-md rounded-lg px-lg font-body-base text-text-primary"
            style={{ height: 52, backgroundColor: withOpacity(Colors.bgBase, 0.5), borderWidth: 1.5, borderColor: withOpacity(Colors.chromeDark, 0.4) }}
            placeholder="Enter your stage name"
            placeholderTextColor={Colors.textMuted}
            value={stageName}
            onChangeText={setStageName}
            autoCapitalize="words"
          />
        </View>

        <View className="w-full items-center" style={{ maxWidth: 440 }}>
          <RockButton label={isSubmitting ? 'Loading...' : "Let's Rock"} variant="primary" disabled={isSubmitting} onPress={handleContinue} />
        </View>
      </ScrollView>

      <BottomNav activeTab="play" />
    </View>
  );
}
