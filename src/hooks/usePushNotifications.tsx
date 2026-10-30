import { useRouter, usePathname } from 'expo-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { hrefForNotification } from '@/lib/notificationRoutes';
import {
  getPushPermission,
  initPush,
  requestPushPermission,
  subscribeToPushTaps,
  type PushPermission,
  type PushTapData,
} from '@/lib/pushNotifications';
import { registerThisDevice } from '@/lib/pushRegistration';
import { getSocket } from '@/lib/socket';

import { usePlayerProfile } from './usePlayerProfile';

// Screens where a tapped notification must wait: a live game (or the search for one) must never be navigated
// away from by a banner. The tap is kept and applied the moment the player leaves.
const HOLD_ROUTES = new Set(['/match', '/puzzle-match', '/matchmaking']);

interface PushContextValue {
  permission: PushPermission;
  /** Shows the system prompt (if still possible), registers the device, and returns the resulting state. */
  enable: () => Promise<PushPermission>;
  /** Re-reads the OS state, e.g. after the player came back from system settings. */
  refreshPermission: () => Promise<void>;
}

const PushContext = createContext<PushContextValue | null>(null);

export function PushNotificationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { status } = usePlayerProfile();
  const [permission, setPermission] = useState<PushPermission>('unavailable');
  const pendingTap = useRef<PushTapData | null>(null);

  const refreshPermission = useCallback(async () => {
    setPermission(await getPushPermission());
  }, []);

  useEffect(() => {
    void initPush().then(refreshPermission);
  }, [refreshPermission]);

  // Coming back from system settings (the player may have just allowed notifications).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  // Every launch while signed in and allowed: (re)register. The server upsert also handles token rotation and a
  // different account signing in on this phone.
  useEffect(() => {
    if (status === 'ready' && permission === 'granted') void registerThisDevice();
  }, [status, permission]);

  // Tell the server whether the app is on screen so it can hold pushes back (server/src/push.ts). Re-sent on
  // every (re)connect, because a reconnect is a new socket server-side.
  useEffect(() => {
    if (status !== 'ready') return;
    const socket = getSocket();
    const send = (state: string = AppState.currentState) => socket.emit('app:state', { foreground: state === 'active' });
    const onConnect = () => send();
    socket.on('connect', onConnect);
    if (socket.connected) send();
    const sub = AppState.addEventListener('change', send);
    return () => {
      socket.off('connect', onConnect);
      sub.remove();
    };
  }, [status]);

  // Tap handling: wait for the profile to settle (signed-in screens need it) and for the player to be off
  // the game screens, then navigate.
  const flushTap = useCallback(() => {
    const data = pendingTap.current;
    if (!data || status === 'loading' || status === 'guest') return;
    if (HOLD_ROUTES.has(pathname)) return;
    pendingTap.current = null;
    const href = hrefForNotification(String(data.kind ?? ''), data);
    if (href) router.push(href);
  }, [pathname, router, status]);

  useEffect(() => {
    return subscribeToPushTaps((data) => {
      pendingTap.current = data;
      flushTap();
    });
    // Subscribe once; later taps and route changes go through flushTap via the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    flushTap();
  }, [flushTap]);

  const enable = useCallback(async () => {
    const next = await requestPushPermission();
    setPermission(next);
    if (next === 'granted') await registerThisDevice();
    return next;
  }, []);

  const value = useMemo(() => ({ permission, enable, refreshPermission }), [permission, enable, refreshPermission]);
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>;
}

export function usePushNotifications(): PushContextValue {
  const ctx = useContext(PushContext);
  if (!ctx) throw new Error('usePushNotifications must be used inside PushNotificationsProvider');
  return ctx;
}
