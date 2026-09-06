import { useCallback, useEffect, useState } from 'react';

import {
  getNotifications,
  getUnreadNotificationCount,
  markAllNotificationsRead as markAllNotificationsReadApi,
  markNotificationRead as markNotificationReadApi,
  type NotificationDTO,
} from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { getSocket } from '@/lib/socket';

export type NotificationsStatus = 'loading' | 'ready' | 'guest' | 'error';

// Not a global provider like useFriends -- only two screens need this
// (Control Core's badge, Backstage Alerts' feed), so each calls it
// independently rather than sharing one app-wide socket subscription.
export function useNotifications(options: { countOnly?: boolean } = {}) {
  const { countOnly = false } = options;
  const [status, setStatus] = useState<NotificationsStatus>('loading');
  const [notifications, setNotifications] = useState<NotificationDTO[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const refresh = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) {
      setStatus('guest');
      setNotifications([]);
      setUnreadCount(0);
      return;
    }
    try {
      if (countOnly) {
        const { unreadCount: count } = await getUnreadNotificationCount(token);
        setUnreadCount(count);
      } else {
        const result = await getNotifications(token);
        setNotifications(result.notifications);
        setUnreadCount(result.unreadCount);
      }
      setStatus('ready');
    } catch (error) {
      console.log('Failed to load notifications', error);
      setStatus('error');
    }
  }, [countOnly]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Live updates from insertNotification's emitToUser (see
  // server/src/db/notifications.ts) -- bumps the badge / prepends the feed
  // without waiting for the next manual refresh.
  useEffect(() => {
    const socket = getSocket();
    const onNew = ({ notification }: { notification: NotificationDTO }) => {
      setUnreadCount((prev) => prev + 1);
      if (!countOnly) setNotifications((prev) => [notification, ...prev]);
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [countOnly]);

  const markRead = useCallback(
    async (notificationId: string) => {
      const target = notifications.find((n) => n.id === notificationId);
      // Synthetic (quest/achievement/daily-bonus) items have no server-side
      // row -- nothing to mark, and their id isn't a real uuid the route
      // would accept anyway.
      if (!target || target.synthetic || target.readAt) return;

      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, readAt: new Date().toISOString() } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));

      const token = await getAuthToken();
      if (!token) return;
      try {
        await markNotificationReadApi(token, notificationId);
      } catch (error) {
        console.log('Failed to mark notification read', error);
      }
    },
    [notifications],
  );

  const markAllRead = useCallback(async () => {
    const unreadPersisted = notifications.filter((n) => !n.synthetic && !n.readAt).length;
    setNotifications((prev) => prev.map((n) => (n.synthetic ? n : { ...n, readAt: n.readAt ?? new Date().toISOString() })));
    setUnreadCount((prev) => Math.max(0, prev - unreadPersisted));

    const token = await getAuthToken();
    if (!token) return;
    try {
      await markAllNotificationsReadApi(token);
    } catch (error) {
      console.log('Failed to mark all notifications read', error);
      void refresh();
    }
  }, [notifications, refresh]);

  return { status, notifications, unreadCount, refresh, markRead, markAllRead };
}
