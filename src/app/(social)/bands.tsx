import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CurrencyPill, EmberParticles, RockButton, RockCard } from '@/components/ui';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, Fonts, Radius, Spacing, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { goUp } from '@/lib/navigation';

interface BrowseBand {
  id: string;
  name: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  memberCount: string;
  status: 'recruiting' | 'pro-tier' | 'full';
}

const BROWSE_BANDS: BrowseBand[] = [
  { id: 'neon-gambit', name: 'NEON GAMBIT', icon: 'account-group', memberCount: '14 Members', status: 'pro-tier' },
  { id: 'riff-masters', name: 'RIFF MASTERS', icon: 'stadium-variant', memberCount: '20/20 Members', status: 'full' },
  { id: 'voltage-drifters', name: 'VOLTAGE DRIFTERS', icon: 'flash', memberCount: '8 Members', status: 'recruiting' },
];

interface LeaderboardRow {
  rank: string;
  name: string;
  xp: string;
  faded?: boolean;
}

const TOP_BANDS: LeaderboardRow[] = [
  { rank: '01', name: 'CHROME VANGUARD', xp: '128,400 SEASON XP' },
  { rank: '02', name: 'THE CHECKMATES', xp: '115,200 SEASON XP' },
  { rank: '03', name: 'ELECTRIC ROOK', xp: '102,000 SEASON XP' },
  { rank: '04', name: 'GHOST PROTOCOL', xp: '98,500 SEASON XP', faded: true },
  { rank: '05', name: 'SILENT STAGE', xp: '94,100 SEASON XP', faded: true },
];

export default function BandsScreen() {
  const insets = useSafeAreaInsets();
  const { gems } = usePlayerProfile();

  return (
    <View style={styles.root}>
      <Image
        source={ScreenArt.rehearsalGarage}
        contentFit="cover"
        cachePolicy="memory-disk"
        style={styles.backgroundImage}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[withOpacity(Colors.bgBase, 0.6), Colors.bgBase]}
        style={styles.backgroundImage}
      />
      <EmberParticles count={10} />

      <View style={[styles.header, { paddingTop: insets.top + Spacing.sm }]}>
        <Pressable onPress={() => goUp('/bands')} style={styles.backButton}>
          <MaterialCommunityIcons name="chevron-left" size={26} color={Colors.textPrimary} />
        </Pressable>
        <Text style={styles.headerTitle}>Bands</Text>
        <CurrencyPill type="gems" value={gems} />
      </View>

      <ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingBottom: 60 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.sectionLabel}>My Band</Text>
        <RockCard glowColor={Colors.emberLight} style={styles.myBandCard}>
          <View style={styles.myBandRow}>
            <View style={styles.myBandIconCircle}>
              <MaterialCommunityIcons name="music-note" size={40} color={Colors.emberLight} />
            </View>
            <View style={styles.myBandInfo}>
              <Text style={styles.myBandName}>The Obsidian Knights</Text>
              <Text style={styles.myBandMeta}>RANK #14 WORLDWIDE • 18/20 MEMBERS</Text>
              <View style={styles.starsRow}>
                {Array.from({ length: 5 }).map((_, i) => (
                  <MaterialCommunityIcons key={i} name={i < 4 ? 'star' : 'star-outline'} size={14} color={Colors.emberLight} />
                ))}
              </View>
            </View>
          </View>
          <View style={styles.manageButtonWrap}>
            <RockButton label="Manage Band" variant="primary" onPress={() => console.log('Manage Band pressed')} />
          </View>
        </RockCard>

        <Text style={styles.sectionLabel}>Browse Bands</Text>
        <View style={styles.browseList}>
          {BROWSE_BANDS.map((band) => (
            <RockCard key={band.id} style={styles.browseCard}>
              <View style={styles.browseRow}>
                <View style={styles.browseLeft}>
                  <View style={styles.browseIconCircle}>
                    <MaterialCommunityIcons name={band.icon} size={22} color={Colors.textMuted} />
                  </View>
                  <View>
                    <Text style={styles.browseName}>{band.name}</Text>
                    <View style={styles.browseMetaRow}>
                      <Text style={styles.browseMemberCount}>{band.memberCount}</Text>
                      {band.status !== 'full' ? (
                        <>
                          <View style={styles.browseDot} />
                          <Text
                            style={[
                              styles.browseStatus,
                              { color: band.status === 'recruiting' ? Colors.cyan : Colors.emberLight },
                            ]}
                          >
                            {band.status === 'recruiting' ? 'RECRUITING' : 'PRO TIER'}
                          </Text>
                        </>
                      ) : null}
                    </View>
                  </View>
                </View>

                {band.status === 'full' ? (
                  <View style={styles.fullPill}>
                    <Text style={styles.fullPillText}>Full</Text>
                  </View>
                ) : (
                  <Pressable
                    style={styles.joinPill}
                    onPress={() => console.log('Join Band pressed', band.name)}
                  >
                    <Text style={styles.joinPillText}>Join</Text>
                  </Pressable>
                )}
              </View>
            </RockCard>
          ))}
        </View>

        <Text style={styles.sectionLabel}>Global Top 5</Text>
        <RockCard style={styles.leaderboardCard}>
          {TOP_BANDS.map((row, index) => (
            <View
              key={row.rank}
              style={[styles.leaderboardRow, index < TOP_BANDS.length - 1 && styles.leaderboardRowDivider]}
            >
              <Text style={[styles.leaderboardRank, row.faded && styles.leaderboardFaded]}>{row.rank}</Text>
              <View style={styles.leaderboardInfo}>
                <Text style={[styles.leaderboardName, row.faded && styles.leaderboardFaded]}>{row.name}</Text>
                <Text style={styles.leaderboardXp}>{row.xp}</Text>
              </View>
            </View>
          ))}
        </RockCard>

        <View style={styles.bottomSpacer} />
      </ScrollView>
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Colors.bgBase,
  },
  backgroundImage: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.xl,
    paddingBottom: Spacing.md,
    gap: Spacing.sm,
  },
  backButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgPanel, 0.8),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
    flex: 1,
    textAlign: 'center',
  },
  scrollContent: {
    padding: Spacing.lg,
    paddingBottom: 60,
    gap: Spacing.md,
  },
  sectionLabel: {
    fontFamily: Fonts.heading,
    fontSize: 13,
    color: Colors.cyan,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginTop: Spacing.md,
  },
  myBandCard: {},
  myBandRow: {
    flexDirection: 'row',
    gap: Spacing.lg,
    alignItems: 'center',
  },
  myBandIconCircle: {
    width: 84,
    height: 84,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgBase, 0.5),
    borderWidth: 2,
    borderColor: withOpacity(Colors.emberLight, 0.6),
    boxShadow: `0px 0px 20px ${withOpacity(Colors.emberLight, 0.3)}`,
  },
  myBandInfo: {
    flex: 1,
    gap: 4,
  },
  myBandName: {
    fontFamily: Fonts.display,
    fontSize: 20,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
  },
  myBandMeta: {
    fontFamily: Fonts.heading,
    fontSize: 11,
    color: Colors.textMuted,
    letterSpacing: 0.5,
  },
  starsRow: {
    flexDirection: 'row',
    gap: 2,
    marginTop: 4,
  },
  manageButtonWrap: {
    marginTop: Spacing.lg,
  },
  browseList: {
    gap: Spacing.sm,
  },
  browseCard: {},
  browseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  browseLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    flexShrink: 1,
  },
  browseIconCircle: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgBase, 0.4),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.3),
  },
  browseName: {
    fontFamily: Fonts.heading,
    fontSize: 13,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
  },
  browseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 2,
  },
  browseMemberCount: {
    fontFamily: Fonts.body,
    fontSize: 11,
    color: Colors.textMuted,
  },
  browseDot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: Colors.chromeDark,
  },
  browseStatus: {
    fontFamily: Fonts.heading,
    fontSize: 10,
    fontStyle: 'italic',
  },
  fullPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: withOpacity(Colors.chromeDark, 0.2),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  fullPillText: {
    fontFamily: Fonts.heading,
    fontSize: 11,
    color: Colors.textMuted,
    textTransform: 'uppercase',
  },
  joinPill: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.cyan,
    boxShadow: `0px 0px 12px ${withOpacity(Colors.cyan, 0.4)}`,
  },
  joinPillText: {
    fontFamily: Fonts.heading,
    fontSize: 11,
    color: Colors.bgBase,
    textTransform: 'uppercase',
  },
  leaderboardCard: {
    gap: 0,
  },
  leaderboardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  leaderboardRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: withOpacity(Colors.chromeDark, 0.2),
  },
  leaderboardRank: {
    fontFamily: Fonts.display,
    fontSize: 16,
    color: Colors.emberLight,
    width: 28,
  },
  leaderboardInfo: {
    flex: 1,
  },
  leaderboardName: {
    fontFamily: Fonts.heading,
    fontSize: 13,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
  },
  leaderboardXp: {
    fontFamily: Fonts.body,
    fontSize: 10,
    color: Colors.textMuted,
    marginTop: 2,
  },
  leaderboardFaded: {
    opacity: 0.6,
  },
  bottomSpacer: {
    height: 20,
  },
});
// #endregion
