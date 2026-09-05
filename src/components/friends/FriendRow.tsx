import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { PlayerAvatar, RockCard } from '@/components/ui';
import { getAvatarImage } from '@/constants/avatars';
import { Colors, withOpacity } from '@/constants/theme';
import type { FriendPresence } from '@/hooks/useFriends';

const PRESENCE_DOT: Record<FriendPresence, string> = {
  online: Colors.cyan,
  'in-game': Colors.emberLight,
  offline: Colors.chromeDark,
};

const PRESENCE_LABEL: Record<FriendPresence, string> = {
  online: 'Online',
  'in-game': 'In a match',
  offline: 'Offline',
};

interface FriendRowProps {
  displayName: string | null;
  avatarId: string | null;
  rating: number;
  presence?: FriendPresence;
  /** Extra line under the name (overrides the presence label). */
  subtitle?: string;
  right?: ReactNode;
  onPress?: () => void;
}

/** Shared "another player" row -- avatar + presence dot + name + rating, with
 *  a caller-supplied action slot. Used by the Friends screen and the
 *  world-rankings Friends tab. */
export function FriendRow({ displayName, avatarId, rating, presence, subtitle, right, onPress }: FriendRowProps) {
  const body = (
    <RockCard variant="surface" contentPadding={12}>
      <View className="flex-row items-center gap-md">
        <View style={{ position: 'relative' }}>
          <PlayerAvatar source={getAvatarImage(avatarId)} size="small" />
          {presence ? (
            <View
              style={{
                position: 'absolute',
                bottom: -1,
                right: -1,
                width: 12,
                height: 12,
                borderRadius: 6,
                borderWidth: 2,
                borderColor: Colors.bgBase,
                backgroundColor: PRESENCE_DOT[presence],
              }}
            />
          ) : null}
        </View>

        <View className="flex-1">
          <Text className="font-heading-md uppercase text-text-primary" style={{ fontSize: 14 }} numberOfLines={1}>
            {displayName ?? 'Anonymous'}
          </Text>
          <Text className="mt-0.5 font-body-sm" style={{ fontSize: 11, color: Colors.textMuted }} numberOfLines={1}>
            {subtitle ?? (presence ? `${PRESENCE_LABEL[presence]} · ${rating} ELO` : `${rating} ELO`)}
          </Text>
        </View>

        {right ? <View className="items-end">{right}</View> : null}
      </View>
    </RockCard>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? { opacity: 0.85 } : undefined)}>
      {body}
    </Pressable>
  );
}

export { PRESENCE_DOT };

// Small pill button used for the per-row actions (Challenge / Message).
export function RowAction({
  label,
  icon,
  color = Colors.cyan,
  disabled,
  onPress,
}: {
  label: string;
  icon?: ReactNode;
  color?: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      className="flex-row items-center gap-1 rounded-md px-2.5 py-1.5"
      style={{
        backgroundColor: withOpacity(color, disabled ? 0.06 : 0.14),
        borderWidth: 1,
        borderColor: withOpacity(color, disabled ? 0.15 : 0.4),
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {icon ?? null}
      <Text className="font-section-header uppercase" style={{ fontSize: 10, letterSpacing: 0.5, color }}>
        {label}
      </Text>
    </Pressable>
  );
}
