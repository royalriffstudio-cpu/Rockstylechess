import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { CurrencyPill, PlayerAvatar, RockCard } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';

type Accent = 'gold' | 'cyan' | 'crimson' | 'muted';

interface NotificationItem {
  id: string;
  accent: Accent;
  icon: keyof typeof MaterialCommunityIcons.glyphMap;
  emoji?: string;
  title: string;
  body: string;
  time: string;
  actionLabel: string;
  read: boolean;
}

const NOTIFICATIONS: NotificationItem[] = [
  {
    id: 'bounty',
    accent: 'gold',
    icon: 'medal',
    title: "Champion's Bounty",
    body: 'Your performance in the Blitz Arena earned you a Rare Tier chest.',
    time: '2m ago',
    actionLabel: 'Claim',
    read: false,
  },
  {
    id: 'rival',
    accent: 'cyan',
    icon: 'sword-cross',
    emoji: '🦾',
    title: 'Rival Challenge',
    body: 'Vespera_7 has invited you to join their elite chess guild.',
    time: '45m ago',
    actionLabel: 'View',
    read: false,
  },
  {
    id: 'tournament',
    accent: 'crimson',
    icon: 'trophy',
    title: 'Master Tournament',
    body: "The 'Obsidian Cup' begins in 3 hours. Final call for elite entries.",
    time: '2h ago',
    actionLabel: 'View',
    read: false,
  },
  {
    id: 'order',
    accent: 'muted',
    icon: 'cart',
    title: 'Order Confirmed',
    body: "Purchase of 'Liquid Gold' skin was successful.",
    time: '1d ago',
    actionLabel: 'Details',
    read: true,
  },
];

const ACCENT_COLOR: Record<Accent, string> = {
  gold: Colors.gold,
  cyan: Colors.cyan,
  crimson: Colors.crimson,
  muted: Colors.textMuted,
};

export default function BackstageAlertsScreen() {
  const insets = useSafeAreaInsets();
  const { gems } = usePlayerProfile();
  const [readIds, setReadIds] = useState<Set<string>>(
    new Set(NOTIFICATIONS.filter((n) => n.read).map((n) => n.id)),
  );

  const unreadCount = NOTIFICATIONS.filter((n) => !readIds.has(n.id)).length;

  function handleMarkAllRead() {
    console.log('Mark all as read pressed');
    setReadIds(new Set(NOTIFICATIONS.map((n) => n.id)));
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
              {unreadCount > 0 ? `You have ${unreadCount} priority messages` : 'All caught up'}
            </Text>
          </View>
          <Pressable onPress={handleMarkAllRead} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Text className="font-section-header text-section-header uppercase text-cyan">Mark All as Read</Text>
          </Pressable>
        </View>

        <View className="gap-md">
          {NOTIFICATIONS.map((notification) => {
            const isRead = readIds.has(notification.id);
            const accentColor = ACCENT_COLOR[notification.accent];
            return (
              <RockCard key={notification.id} glowColor={isRead ? undefined : accentColor} style={{ opacity: isRead ? 0.65 : 1 }}>
                <View className="flex-row items-start gap-md">
                  <View style={{ position: 'relative' }}>
                    {notification.emoji ? (
                      <PlayerAvatar emoji={notification.emoji} size="small" />
                    ) : (
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
                        <MaterialCommunityIcons name={notification.icon} size={26} color={isRead ? Colors.textMuted : accentColor} />
                      </View>
                    )}
                    {!isRead ? (
                      <View
                        className="absolute -right-1 -top-1 rounded-full px-1.5 py-0.5"
                        style={{ backgroundColor: accentColor }}
                      >
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
                        {notification.title}
                      </Text>
                      <Text className="font-caption text-caption text-text-muted">{notification.time.toUpperCase()}</Text>
                    </View>
                    <Text className="font-body-sm text-body-sm text-text-muted" numberOfLines={1}>
                      {notification.body}
                    </Text>
                  </View>
                </View>

                <View className="mt-md">
                  <Pressable
                    className="items-center rounded py-sm"
                    style={
                      isRead
                        ? { borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }
                        : { backgroundColor: accentColor }
                    }
                    onPress={() => {
                      console.log(`${notification.actionLabel} pressed`, notification.title);
                      setReadIds((prev) => new Set(prev).add(notification.id));
                    }}
                  >
                    <Text
                      className="font-button-label text-button-label uppercase"
                      style={{ color: isRead ? Colors.textMuted : Colors.bgBase }}
                    >
                      {notification.actionLabel}
                    </Text>
                  </Pressable>
                </View>
              </RockCard>
            );
          })}
        </View>

        <View className="items-center py-lg">
          <Text className="font-caption text-caption uppercase tracking-widest text-chrome-dark">End of Alerts</Text>
        </View>
      </ScrollView>
    </View>
  );
}
