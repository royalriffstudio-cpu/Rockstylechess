import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { CurrencyPill, RockButton, RockCard } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';

interface SupportCategory {
  id: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  title: string;
  subtitle: string;
  danger?: boolean;
}

const SUPPORT_CATEGORIES: SupportCategory[] = [
  { id: 'faq', icon: 'help-circle-outline', title: 'FAQ', subtitle: 'The playbook for all common issues.' },
  { id: 'technical', icon: 'console-line', title: 'Technical Issues', subtitle: 'Latency, display, or piece logic glitches.' },
  { id: 'billing', icon: 'receipt-text-outline', title: 'Billing Support', subtitle: 'Gems, subscriptions, and store items.' },
  { id: 'report', icon: 'gavel', title: 'Report a Player', subtitle: 'Fair play and conduct enforcement.', danger: true },
];

export default function RoadieSupportScreen() {
  const insets = useSafeAreaInsets();
  const { gems } = usePlayerProfile();

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Roadie Support" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-3xl gap-xl px-lg py-xl"
        contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View className="items-center gap-sm">
          <Text className="font-section-header text-section-header uppercase tracking-widest text-ember-light">
            Crew Access Only
          </Text>
          <Text className="text-center font-display-hero text-headline-lg uppercase text-text-primary" style={{ fontSize: 22 }}>
            How Can We Rig The Stage?
          </Text>
          <Text className="px-lg text-center font-body-sm text-body-sm text-text-muted">
            Our crew is on standby to ensure your grandmaster performance remains uninterrupted.
          </Text>
        </View>

        <View className="flex-row flex-wrap justify-between gap-y-md">
          {SUPPORT_CATEGORIES.map((category) => (
            <Pressable
              key={category.id}
              style={{ width: '48%' }}
              onPress={() => console.log('Support category pressed', category.title)}
            >
              <RockCard glowColor={category.danger ? Colors.crimson : undefined}>
                <View className="gap-sm">
                  <View
                    className="items-center justify-center rounded-md"
                    style={{
                      width: 48,
                      height: 48,
                      backgroundColor: withOpacity(category.danger ? Colors.crimson : Colors.cyan, 0.1),
                      borderWidth: category.danger ? 1 : 0,
                      borderColor: withOpacity(Colors.crimson, 0.3),
                      boxShadow: `0px 0px 10px ${withOpacity(category.danger ? Colors.crimson : Colors.cyan, 0.25)}`,
                    }}
                  >
                    <MaterialCommunityIcons
                      name={category.icon}
                      size={28}
                      color={category.danger ? Colors.crimson : Colors.cyan}
                    />
                  </View>
                  <Text className="font-heading-md text-heading-md uppercase" style={{ color: Colors.textPrimary, fontSize: 13 }}>
                    {category.title}
                  </Text>
                  <Text className="font-body-sm text-body-sm text-text-muted" style={{ fontSize: 11, lineHeight: 15 }}>
                    {category.subtitle}
                  </Text>
                </View>
              </RockCard>
            </Pressable>
          ))}
        </View>

        <View className="items-center gap-sm">
          <RockButton
            label="Contact Crew"
            variant="primary"
            icon={<MaterialCommunityIcons name="chat" size={20} color={Colors.bgBase} />}
            onPress={() => console.log('Contact Crew pressed')}
          />
          <Text className="text-center font-body-sm text-body-sm italic text-text-muted">
            Estimated response time: &lt; 5 minutes
          </Text>
        </View>

        <View className="items-center gap-md pt-lg">
          <View className="flex-row items-center gap-md">
            <Text
              className="font-section-header text-section-header uppercase text-text-muted"
              onPress={() => console.log('Privacy Policy pressed')}
            >
              Privacy Policy
            </Text>
            <Text style={{ color: withOpacity(Colors.chrome, 0.2) }}>•</Text>
            <Text
              className="font-section-header text-section-header uppercase text-text-muted"
              onPress={() => console.log('Terms of Service pressed')}
            >
              Terms of Service
            </Text>
          </View>
          <Text className="font-section-header text-caption uppercase tracking-widest text-text-muted" style={{ opacity: 0.5 }}>
            Version 4.2.0-Staging
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
