import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { CurrencyPill, RockCard } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { useNotifications } from '@/hooks/useNotifications';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import type { NotificationDTO, NotificationKind } from '@/lib/api';

type Accent = 'gold' | 'cyan' | 'crimson' | 'muted';

const ACCENT_COLOR: Record<Accent, string> = {
  gold: Colors.gold,
  cyan: Colors.cyan,
  crimson: Colors.crimson,
  muted: Colors.textMuted,
};

const TYPE_META: Record<NotificationKind, { icon: keyof typeof MaterialCommunityIcons.glyphMap; accent: Accent; actionLabel: string }> = {
  friend_request_received: { icon: 'account-plus', accent: 'cyan', actionLabel: 'View' },
  friend_request_accepted: { icon: 'account-check', accent: 'cyan', actionLabel: 'View' },
  friend_challenge_received: { icon: 'sword-cross', accent: 'crimson', actionLabel: 'View' },
  match_ended: { icon: 'chess-king', accent: 'gold', actionLabel: 'Replay' },
  quest_claimable: { icon: 'clipboard-check', accent: 'gold', actionLabel: 'Claim' },
  achievement_claimable: { icon: 'trophy-award', accent: 'gold', actionLabel: 'Claim' },
  daily_bonus_claimable: { icon: 'gift', accent: 'gold', actionLabel: 'Claim' },
};

// match_ended's accent tracks the outcome (win/loss/draw), not a fixed color
// per type -- the title text set server-side (persistMatchResult.ts's
// matchNotificationText) is the simplest reliable signal for that.
function accentFor(item: NotificationDTO): Accent {
  if (item.type === 'match_ended') {
    if (item.title === 'Victory!') return 'gold';
    if (item.title === 'Defeat') return 'crimson';
    return 'cyan';
  }
  return TYPE_META[item.type].accent;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function BackstageAlertsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gems } = usePlayerProfile();
  const { status, notifications, unreadCount, markRead, markAllRead } = useNotifications();

  function handlePress(item: NotificationDTO) {
    void markRead(item.id);
    const payload = (item.payload ?? {}) as Record<string, unknown>;
    switch (item.type) {
      case 'friend_request_received':
      case 'friend_request_accepted':
      case 'friend_challenge_received':
        router.push('/friends');
        return;
      case 'match_ended':
        router.push({
          pathname: '/replay',
          params: {
            matchId: String(payload.matchId ?? ''),
            opponentDisplayName: typeof payload.opponentDisplayName === 'string' ? payload.opponentDisplayName : undefined,
            resultType: typeof payload.resultType === 'string' ? payload.resultType : undefined,
            color: typeof payload.color === 'string' ? payload.color : undefined,
            playedAt: typeof payload.playedAt === 'string' ? payload.playedAt : undefined,
          },
        });
        return;
      case 'quest_claimable':
        router.push('/quests');
        return;
      case 'achievement_claimable':
        router.push('/achievements');
        return;
      case 'daily_bonus_claimable':
        router.push('/daily-bonus');
        return;
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Notifications" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-3xl gap-md px-lg py-xl"
        contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <View className="mb-lg flex-row items-end justify-between">
          <View>
            <Text className="font-section-header text-section-header uppercase tracking-widest text-ember-light">
              Backstage Alerts
            </Text>
            <Text className="mt-xs font-body-sm text-body-sm italic text-text-muted">
              {status === 'guest'
                ? 'Sign in to see your alerts'
                : unreadCount > 0
                  ? `You have ${unreadCount} priority messages`
                  : 'All caught up'}
            </Text>
          </View>
          {notifications.some((n) => !n.synthetic && !n.readAt) ? (
            <Pressable onPress={markAllRead} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text className="font-section-header text-section-header uppercase text-cyan">Mark All as Read</Text>
            </Pressable>
          ) : null}
        </View>

        {status === 'loading' ? (
          <View className="items-center py-xl">
            <ActivityIndicator color={Colors.cyan} />
          </View>
        ) : notifications.length === 0 ? (
          <View className="items-center gap-xs py-xl">
            <MaterialCommunityIcons name="bell-check-outline" size={40} color={Colors.textMuted} />
            <Text className="font-heading-md text-heading-md text-text-muted">All caught up</Text>
          </View>
        ) : (
          <View className="gap-md">
            {notifications.map((item) => {
              const isRead = !item.synthetic && item.readAt != null;
              const accentColor = ACCENT_COLOR[accentFor(item)];
              const { icon, actionLabel } = TYPE_META[item.type];
              return (
                <RockCard key={item.id} glowColor={isRead ? undefined : accentColor} style={{ opacity: isRead ? 0.65 : 1 }}>
                  <View className="flex-row items-start gap-md">
                    <View style={{ position: 'relative' }}>
                      <View
                        className="items-center justify-center rounded-md"
                        style={{
                          width: 52,
                          height: 52,
                          backgroundColor: withOpacity(Colors.bgBase, 0.5),
                          borderWidth: 1,
                          borderColor: isRead ? withOpacity(Colors.chromeDark, 0.3) : withOpacity(accentColor, 0.4),
                          boxShadow: isRead ? undefined : `0px 0px 12px ${withOpacity(accentColor, 0.3)}`,
                        }}
                      >
                        <MaterialCommunityIcons name={icon} size={26} color={isRead ? Colors.textMuted : accentColor} />
                      </View>
                      {!isRead ? (
                        <View className="absolute -right-1 -top-1 rounded-full px-1.5 py-0.5" style={{ backgroundColor: accentColor }}>
                          <Text className="font-section-header font-bold" style={{ fontSize: 9, color: Colors.bgBase }}>
                            NEW
                          </Text>
                        </View>
                      ) : null}
                    </View>

                    <View className="flex-1 gap-xs">
                      <View className="flex-row items-start justify-between gap-sm">
                        <Text
                          className="flex-1 font-heading-md text-heading-md uppercase"
                          style={{ color: isRead ? Colors.textMuted : Colors.textPrimary }}
                          numberOfLines={1}
                        >
                          {item.title}
                        </Text>
                        <Text className="font-caption text-caption text-text-muted">
                          {item.synthetic ? 'READY' : relativeTime(item.createdAt).toUpperCase()}
                        </Text>
                      </View>
                      <Text className="font-body-sm text-body-sm text-text-muted" numberOfLines={2}>
                        {item.body}
                      </Text>
                    </View>
                  </View>

                  <View className="mt-md">
                    <Pressable
                      className="items-center rounded py-sm"
                      style={isRead ? { borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) } : { backgroundColor: accentColor }}
                      onPress={() => handlePress(item)}
                    >
                      <Text className="font-button-label text-button-label uppercase" style={{ color: isRead ? Colors.textMuted : Colors.bgBase }}>
                        {actionLabel}
                      </Text>
                    </Pressable>
                  </View>
                </RockCard>
              );
            })}
          </View>
        )}

        <View className="items-center py-lg">
          <Text className="font-caption text-caption uppercase tracking-widest text-chrome-dark">End of Alerts</Text>
        </View>
      </ScrollView>
    </View>
  );
}
