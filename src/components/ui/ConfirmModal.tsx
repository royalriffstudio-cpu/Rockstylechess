import { useEffect } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { AppIcon } from '@/components/ui/AppIcon';
import { RockButton } from '@/components/ui/RockButton';
import type { ICONS } from '@/constants/icons';
import { Colors, Spacing, withOpacity } from '@/constants/theme';

type ConfirmModalVariant = 'danger' | 'neutral';

const VARIANT_ACCENT: Record<ConfirmModalVariant, string> = {
  danger: Colors.crimson,
  neutral: Colors.cyan,
};

const VARIANT_ICON: Record<ConfirmModalVariant, keyof typeof ICONS> = {
  danger: 'warning',
  neutral: 'help',
};

const VARIANT_CONFIRM_BUTTON: Record<ConfirmModalVariant, 'danger' | 'cyan'> = {
  danger: 'danger',
  neutral: 'cyan',
};

interface ConfirmModalProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmModalVariant;
  icon?: keyof typeof ICONS;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Shared confirmation dialog for any destructive/hard-to-undo action
 * (logout, resign, delete account) -- centered card over a dimmed backdrop.
 */
export function ConfirmModal({
  visible,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'neutral',
  icon,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  const accent = VARIANT_ACCENT[variant];
  const resolvedIcon = icon ?? VARIANT_ICON[variant];

  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withTiming(visible ? 1 : 0, { duration: 180, easing: Easing.out(Easing.quad) });
  }, [visible, progress]);
  const cardStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ scale: 0.92 + progress.value * 0.08 }],
  }));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable
        onPress={onCancel}
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.lg, backgroundColor: withOpacity(Colors.bgBase, 0.8) }}
      >
        <Pressable onPress={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 340 }}>
          <Animated.View style={cardStyle}>
            <View
              style={{
                alignItems: 'center',
                borderRadius: 20,
                overflow: 'hidden',
                borderWidth: 1,
                borderColor: withOpacity(accent, 0.3),
                backgroundColor: Colors.bgPanel,
                padding: Spacing.lg,
                boxShadow: `0px 10px 25px ${withOpacity(accent, 0.3)}`,
              }}
            >
              <View
                style={{
                  marginBottom: Spacing.md,
                  height: 56,
                  width: 56,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 28,
                  backgroundColor: withOpacity(accent, 0.1),
                  borderWidth: 1,
                  borderColor: withOpacity(accent, 0.3),
                }}
              >
                <AppIcon name={resolvedIcon} size={26} color={accent} />
              </View>
              <Text style={{ marginBottom: Spacing.xs, textAlign: 'center', fontSize: 18, fontWeight: '600', color: Colors.textPrimary }}>
                {title}
              </Text>
              <Text style={{ marginBottom: Spacing.lg, textAlign: 'center', fontSize: 14, color: Colors.textMuted }}>{message}</Text>
              <View style={{ width: '100%', flexDirection: 'row', gap: Spacing.sm }}>
                <RockButton label={cancelLabel} variant="secondary" onPress={onCancel} style={{ flex: 1 }} />
                <RockButton label={confirmLabel} variant={VARIANT_CONFIRM_BUTTON[variant]} onPress={onConfirm} style={{ flex: 1 }} />
              </View>
            </View>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}
