import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { RockButton } from '@/components/ui/RockButton';
import { Colors, Spacing, withOpacity } from '@/constants/theme';
import { VENUES, isVenueLocked } from '@/constants/venues';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { DURATIONS, DURATION_LABELS, type Duration } from '@/lib/onlineMatch';

interface MatchOptionsModalProps {
  visible: boolean;
  color: 'w' | 'b';
  duration: Duration;
  venueId: string;
  onColor: (c: 'w' | 'b') => void;
  onDuration: (d: Duration) => void;
  onVenue: (id: string) => void;
  onClose: () => void;
}

/**
 * Bots-screen "Match Options" popup: pick a side ("Play As" -- drives which
 * color the bot plays and flips the board when Black), a time control (drives
 * the match clock via DURATION_MS), and a venue (recorded + passed through as a
 * route param, which match.tsx resolves into its VenueBackdrop atmosphere +
 * HUD accent -- see (play)/README.md). Backdrop recipe mirrors ConfirmModal.
 */
export function MatchOptionsModal({
  visible,
  color,
  duration,
  venueId,
  onColor,
  onDuration,
  onVenue,
  onClose,
}: MatchOptionsModalProps) {
  const { chips } = usePlayerProfile();

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable
        onPress={onClose}
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: Spacing.lg,
          backgroundColor: withOpacity(Colors.bgBase, 0.8),
        }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 380 }}>
          <View
            className="gap-lg p-lg"
            style={{
              borderRadius: 20,
              backgroundColor: Colors.bgPanel,
              borderWidth: 1,
              borderColor: withOpacity(Colors.cyan, 0.3),
              boxShadow: `0px 10px 25px ${withOpacity(Colors.cyan, 0.3)}`,
            }}
          >
            <Text className="text-center font-display-hero uppercase text-text-primary" style={{ fontSize: 18, letterSpacing: 1 }}>
              Match Options
            </Text>

            <View className="gap-sm">
              <Text className="font-section-header text-section-header uppercase tracking-widest text-text-muted">
                Play As
              </Text>
              <View className="flex-row gap-sm">
                {(['w', 'b'] as const).map((c) => {
                  const active = color === c;
                  return (
                    <Pressable
                      key={c}
                      onPress={() => onColor(c)}
                      className="flex-1 flex-row items-center justify-center gap-2 rounded-lg py-md"
                      style={{
                        backgroundColor: active ? withOpacity(Colors.cyan, 0.12) : withOpacity(Colors.bgBase, 0.5),
                        borderWidth: 1,
                        borderColor: active ? Colors.cyan : withOpacity(Colors.chromeDark, 0.4),
                      }}
                    >
                      <MaterialCommunityIcons
                        name="chess-king"
                        size={16}
                        color={c === 'w' ? Colors.textPrimary : Colors.chromeMid}
                      />
                      <Text
                        className="font-button-label text-button-label"
                        style={{ color: active ? Colors.cyan : Colors.textPrimary }}
                      >
                        {c === 'w' ? 'White' : 'Black'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="gap-sm">
              <Text className="font-section-header text-section-header uppercase tracking-widest text-text-muted">
                Time Control
              </Text>
              <View className="flex-row gap-sm">
                {DURATIONS.map((d) => {
                  const active = duration === d;
                  return (
                    <Pressable
                      key={d}
                      onPress={() => onDuration(d)}
                      className="flex-1 items-center gap-1 rounded-lg py-md"
                      style={{
                        backgroundColor: active ? withOpacity(Colors.cyan, 0.12) : withOpacity(Colors.bgBase, 0.5),
                        borderWidth: 1,
                        borderColor: active ? Colors.cyan : withOpacity(Colors.chromeDark, 0.4),
                      }}
                    >
                      <Text
                        className="font-button-label text-button-label"
                        style={{ color: active ? Colors.cyan : Colors.textPrimary }}
                      >
                        {d}
                      </Text>
                      <Text
                        className="font-caption text-caption uppercase"
                        style={{ color: active ? withOpacity(Colors.cyan, 0.7) : Colors.chromeMid }}
                      >
                        {DURATION_LABELS[d]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View className="gap-sm">
              <Text className="font-section-header text-section-header uppercase tracking-widest text-text-muted">
                Venue
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-sm pb-1">
                {VENUES.map((venue) => {
                  const locked = isVenueLocked(venue, chips);
                  const active = !locked && venueId === venue.id;
                  const tint = locked ? Colors.chromeMid : active ? Colors.cyan : Colors.textMuted;
                  return (
                    <Pressable
                      key={venue.id}
                      onPress={() => {
                        if (!locked) onVenue(venue.id);
                      }}
                      className="items-center justify-center gap-1 rounded-lg"
                      style={{
                        width: 92,
                        height: 76,
                        backgroundColor: active ? withOpacity(Colors.cyan, 0.1) : withOpacity(Colors.bgBase, 0.5),
                        borderWidth: 1,
                        borderColor: active ? Colors.cyan : withOpacity(Colors.chromeDark, 0.35),
                        opacity: locked ? 0.45 : 1,
                      }}
                    >
                      {locked ? (
                        <View style={{ position: 'absolute', top: 5, right: 5 }}>
                          <MaterialCommunityIcons name="lock" size={12} color={Colors.chromeMid} />
                        </View>
                      ) : null}
                      <MaterialCommunityIcons name={venue.icon} size={22} color={tint} />
                      <Text
                        className="font-heading-md uppercase"
                        numberOfLines={1}
                        style={{ fontSize: 10, letterSpacing: 0.3, color: tint }}
                      >
                        {venue.name}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>

            <RockButton label="Done" variant="cyan" onPress={onClose} style={{ width: '100%' }} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
