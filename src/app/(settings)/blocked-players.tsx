import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FriendRow, RowAction } from '@/components/friends/FriendRow';
import { SubPageHeader } from '@/components/layout';
import { AppIcon, ConfirmModal } from '@/components/ui';
import { Colors } from '@/constants/theme';
import { getAuthToken } from '@/lib/authStorage';
import { getBlockedUsers, unblockUser, type BlockedUser } from '@/lib/api';

type Status = 'loading' | 'ready' | 'guest' | 'error';

export default function BlockedPlayersScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('loading');
  const [blocked, setBlocked] = useState<BlockedUser[]>([]);
  const [unblockTarget, setUnblockTarget] = useState<BlockedUser | null>(null);

  const load = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) {
      setStatus('guest');
      return;
    }
    setStatus('loading');
    try {
      const { blocked: rows } = await getBlockedUsers(token);
      setBlocked(rows);
      setStatus('ready');
    } catch (error) {
      console.log('Failed to load blocked players', error);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUnblock() {
    if (!unblockTarget) return;
    const target = unblockTarget;
    setUnblockTarget(null);
    const token = await getAuthToken();
    if (!token) return;
    try {
      await unblockUser(token, target.userId);
      setBlocked((prev) => prev.filter((b) => b.userId !== target.userId));
    } catch (error) {
      console.log('Failed to unblock player', error);
    }
  }

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Blocked Players" />
      <ScrollView
        contentContainerClassName="mx-auto w-full max-w-3xl gap-sm px-lg py-xl"
        contentContainerStyle={{ paddingBottom: 48 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        {status === 'loading' ? <ActivityIndicator color={Colors.cyan} style={{ marginTop: 24 }} /> : null}

        {status === 'ready' && blocked.length === 0 ? (
          <Text className="mt-xl text-center font-body-sm text-text-muted">You haven&apos;t blocked anyone.</Text>
        ) : null}

        {blocked.map((b) => (
          <FriendRow
            key={b.userId}
            displayName={b.displayName}
            avatarId={b.avatarId}
            country={b.country}
            rating={b.rating}
            subtitle="Blocked"
            right={
              <RowAction
                label="Unblock"
                icon={<AppIcon name="check_circle" size={12} color={Colors.cyan} />}
                onPress={() => setUnblockTarget(b)}
              />
            }
          />
        ))}
      </ScrollView>

      <ConfirmModal
        visible={unblockTarget !== null}
        variant="neutral"
        title="Unblock Player"
        message={`Unblock ${unblockTarget?.displayName ?? 'this player'}? They'll be able to message and challenge you again.`}
        confirmLabel="Unblock"
        onConfirm={handleUnblock}
        onCancel={() => setUnblockTarget(null)}
      />
    </View>
  );
}
