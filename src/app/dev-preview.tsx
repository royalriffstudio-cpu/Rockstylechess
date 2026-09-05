import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  BottomNav,
  CurrencyPill,
  PlayerAvatar,
  ProgressBar,
  RockButton,
  RockCard,
  SectionLabel,
  type NavTab,
} from '@/components/ui';
import { Colors, Fonts, Spacing } from '@/constants/theme';

// Temporary screen to review every shared component in one place before
// any real screens are built on top of them. Safe to delete once approved.
export default function DevPreviewScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<NavTab>('home');

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.title}>Component Preview</Text>

        <SectionLabel label="Rock Button" />
        <View style={styles.row}>
          <RockButton
            label="Play"
            variant="primary"
            icon={<MaterialCommunityIcons name="play" size={18} color={Colors.bgBase} />}
            onPress={() => {}}
          />
          <RockButton
            label="Claim"
            variant="reward"
            icon={<MaterialCommunityIcons name="gift" size={18} color={Colors.bgBase} />}
            onPress={() => {}}
          />
        </View>
        <View style={styles.row}>
          <RockButton
            label="Resign"
            variant="danger"
            icon={<MaterialCommunityIcons name="flag" size={18} color={Colors.textPrimary} />}
            onPress={() => {}}
          />
          <RockButton label="Disabled" variant="primary" disabled onPress={() => {}} />
        </View>

        <SectionLabel label="Rock Card" />
        <RockCard style={styles.cardSpacing}>
          <Text style={styles.cardTitle}>The Pit</Text>
          <Text style={styles.cardBody}>Standard venue. No highlight glow.</Text>
        </RockCard>
        <RockCard glowColor={Colors.cyan} style={styles.cardSpacing}>
          <Text style={styles.cardTitle}>Main Stage</Text>
          <Text style={styles.cardBody}>Active venue — glowColor=cyan.</Text>
        </RockCard>

        <SectionLabel label="Currency Pill" />
        <View style={styles.row}>
          <CurrencyPill type="chips" value={12} onPressAdd={() => {}} />
          <CurrencyPill type="gems" value={326} />
        </View>

        <SectionLabel label="Player Avatar" />
        <View style={[styles.row, styles.avatarRow]}>
          <PlayerAvatar emoji="🤘" level={4} size="small" />
          <PlayerAvatar emoji="🎸" level={12} size="medium" />
          <PlayerAvatar emoji="👑" level={27} size="large" />
        </View>

        <SectionLabel label="Progress Bar" />
        <View style={styles.cardSpacing}>
          <ProgressBar progress={0.35} label="1,240 / 3,500 XP" />
        </View>
        <View style={styles.cardSpacing}>
          <ProgressBar progress={0.8} height={14} label="Streak 4/5" />
        </View>

        <SectionLabel label="Bottom Nav" />
        <Text style={styles.cardBody}>Pinned below — tap a tab to test active state.</Text>

        <View style={[styles.bottomSpacer, { height: 90 + insets.bottom }]} />
      </ScrollView>

      <View style={styles.navWrap}>
        <BottomNav activeTab={activeTab} onTabPress={setActiveTab} />
      </View>
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  content: {
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 28,
    color: Colors.textPrimary,
    marginBottom: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  avatarRow: {
    alignItems: 'flex-end',
  },
  cardSpacing: {
    marginTop: Spacing.md,
    marginBottom: Spacing.sm,
  },
  cardTitle: {
    fontFamily: Fonts.heading,
    fontSize: 16,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  cardBody: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
  },
  bottomSpacer: {
    height: 90,
  },
  navWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
});
// #endregion
