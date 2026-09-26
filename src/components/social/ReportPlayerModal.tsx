import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { RockButton } from '@/components/ui';
import { Colors, Fonts, Radius, Spacing, withOpacity } from '@/constants/theme';
import type { ReportReason } from '@/lib/api';
import { submitReport } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';

interface ReasonOption {
  id: ReportReason;
  label: string;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
}

const REASONS: ReasonOption[] = [
  { id: 'cheating', label: 'Cheating', icon: 'robot-angry-outline' },
  { id: 'harassment', label: 'Harassment or abuse', icon: 'account-alert-outline' },
  { id: 'inappropriate_name', label: 'Inappropriate name', icon: 'badge-account-alert-outline' },
  { id: 'spam', label: 'Spam', icon: 'email-alert-outline' },
  { id: 'other', label: 'Other', icon: 'dots-horizontal-circle-outline' },
];

interface ReportPlayerModalProps {
  visible: boolean;
  onClose: () => void;
  reportedUserId: string;
  reportedDisplayName: string;
  matchId?: string;
}

type Status = 'idle' | 'submitting' | 'done' | 'error';

// Shared by roadie-support.tsx's "Report a Player" flow (report-player.tsx)
// and friends.tsx's per-friend "..." menu -- reportedUserId/displayName are
// already known by the time either caller opens this, so there's no "who"
// picker here, just reason + optional details + submit.
export function ReportPlayerModal({ visible, onClose, reportedUserId, reportedDisplayName, matchId }: ReportPlayerModalProps) {
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  function handleClose() {
    setReason(null);
    setDetails('');
    setStatus('idle');
    onClose();
  }

  async function handleSubmit() {
    if (!reason) return;
    setStatus('submitting');
    try {
      const token = await getAuthToken();
      if (!token) {
        setStatus('error');
        return;
      }
      await submitReport(token, { reportedUserId, reason, details: details.trim() || undefined, matchId });
      setStatus('done');
    } catch (error) {
      console.log('Report submission failed', error);
      setStatus('error');
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={handleClose}>
        <Pressable onPress={(e) => e.stopPropagation()} style={styles.cardWrap}>
          <View style={styles.card}>
            {status === 'done' ? (
              <View style={styles.doneWrap}>
                <MaterialCommunityIcons name="check-circle-outline" size={40} color={Colors.cyan} />
                <Text style={styles.title}>Report submitted</Text>
                <Text style={styles.subtitle}>Our crew will review it. Thanks for helping keep matches fair.</Text>
                <RockButton label="Done" variant="cyan" onPress={handleClose} />
              </View>
            ) : (
              <>
                <View style={styles.header}>
                  <Text style={styles.title}>Report {reportedDisplayName}</Text>
                  <Pressable onPress={handleClose} style={styles.closeButton}>
                    <MaterialCommunityIcons name="close" size={20} color={Colors.textPrimary} />
                  </Pressable>
                </View>

                <Text style={styles.sectionLabel}>Reason</Text>
                <View style={{ gap: Spacing.xs }}>
                  {REASONS.map((option) => {
                    const isSelected = reason === option.id;
                    return (
                      <Pressable
                        key={option.id}
                        onPress={() => setReason(option.id)}
                        style={[styles.reasonRow, isSelected && styles.reasonRowSelected]}
                      >
                        <MaterialCommunityIcons
                          name={option.icon}
                          size={18}
                          color={isSelected ? Colors.crimson : Colors.textMuted}
                        />
                        <Text style={[styles.reasonText, isSelected && styles.reasonTextSelected]}>{option.label}</Text>
                        {isSelected ? <MaterialCommunityIcons name="check" size={16} color={Colors.crimson} /> : null}
                      </Pressable>
                    );
                  })}
                </View>

                <Text style={styles.sectionLabel}>Details (optional)</Text>
                <TextInput
                  value={details}
                  onChangeText={setDetails}
                  placeholder="Anything else that would help us look into this"
                  placeholderTextColor={Colors.textMuted}
                  style={styles.detailsInput}
                  multiline
                  maxLength={500}
                />

                {status === 'error' ? <Text style={styles.errorText}>Something went wrong. Try again.</Text> : null}

                <RockButton
                  label="Submit Report"
                  loadingLabel="Submitting…"
                  variant="danger"
                  disabled={!reason}
                  loading={status === 'submitting'}
                  onPress={handleSubmit}
                />
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// #region Styles
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    backgroundColor: withOpacity(Colors.bgBase, 0.8),
  },
  cardWrap: {
    width: '100%',
    maxWidth: 400,
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: withOpacity(Colors.crimson, 0.3),
    backgroundColor: Colors.bgPanel,
    padding: Spacing.lg,
    gap: Spacing.sm,
    boxShadow: `0px 10px 25px ${withOpacity(Colors.crimson, 0.2)}`,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.xs,
  },
  title: {
    fontFamily: Fonts.display,
    fontSize: 15,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  subtitle: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  sectionLabel: {
    fontFamily: Fonts.heading,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  reasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 10,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.3),
  },
  reasonRowSelected: {
    backgroundColor: withOpacity(Colors.crimson, 0.1),
    borderColor: withOpacity(Colors.crimson, 0.5),
  },
  reasonText: {
    flex: 1,
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  reasonTextSelected: {
    color: Colors.crimson,
    fontWeight: '600',
  },
  detailsInput: {
    minHeight: 60,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    color: Colors.textPrimary,
    fontFamily: Fonts.body,
    fontSize: 13,
    padding: Spacing.sm,
    textAlignVertical: 'top',
  },
  errorText: {
    fontFamily: Fonts.body,
    fontSize: 12,
    color: Colors.crimson,
    textAlign: 'center',
  },
  doneWrap: {
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.md,
  },
});
// #endregion
