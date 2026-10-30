import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

import { Colors } from '@/constants/theme';

import type { PushPermission, PushTapData } from './types';

// The ONLY file that imports expo-notifications (index.web.ts is the web stub, exports must stay identical) --
// importing it anywhere else would pull the native module into the web bundle, same rule as src/lib/ads.

export type { PushPermission, PushTapData } from './types';

// Channel ids match server/src/push.ts's CHANNEL map: players can silence one kind in system settings.
const CHANNELS: { id: string; name: string; importance: Notifications.AndroidImportance }[] = [
  { id: 'social', name: 'Friends & messages', importance: Notifications.AndroidImportance.HIGH },
  { id: 'invites', name: 'Match invites', importance: Notifications.AndroidImportance.MAX },
  { id: 'results', name: 'Match results', importance: Notifications.AndroidImportance.DEFAULT },
  { id: 'daily', name: 'Daily rewards', importance: Notifications.AndroidImportance.DEFAULT },
];

let initialised = false;

/** Idempotent. Foreground notifications are never drawn (the app already shows that event in-game). */
export async function initPush(): Promise<void> {
  if (initialised) return;
  initialised = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
  if (Platform.OS === 'android') {
    await Promise.all(
      CHANNELS.map((c) =>
        Notifications.setNotificationChannelAsync(c.id, {
          name: c.name,
          importance: c.importance,
          lightColor: Colors.ember,
          vibrationPattern: [0, 200, 100, 200],
        }),
      ),
    );
  }
}

function toPermission(status: Notifications.PermissionStatus): PushPermission {
  if (status === Notifications.PermissionStatus.GRANTED) return 'granted';
  if (status === Notifications.PermissionStatus.DENIED) return 'denied';
  return 'undetermined';
}

export async function getPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable';
  const { status } = await Notifications.getPermissionsAsync();
  return toPermission(status);
}

/** Shows the system prompt when it can (Android 13+/iOS); otherwise returns the current state unchanged. */
export async function requestPushPermission(): Promise<PushPermission> {
  if (!Device.isDevice) return 'unavailable';
  await initPush(); // Android only shows the prompt once a channel exists
  const { status } = await Notifications.requestPermissionsAsync();
  return toPermission(status);
}

export function openPushSettings(): void {
  void Linking.openSettings();
}

/** The Expo push token for this install, or null (emulator, no EAS project id yet, or the request failed). */
export async function getExpoPushToken(): Promise<string | null> {
  try {
    if (!Device.isDevice) return null;
    const projectId: string | undefined = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    if (!projectId) {
      console.warn('Push disabled: no EAS project id in app.json (run `npx eas-cli init`).');
      return null;
    }
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (error) {
    console.log('Could not get a push token', error);
    return null;
  }
}

/**
 * Calls `onTap` for a notification the player tapped, including the one that cold-started the app.
 * Returns the unsubscribe function.
 */
export function subscribeToPushTaps(onTap: (data: PushTapData) => void): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const data = response?.notification.request.content.data;
    if (data && typeof data === 'object') onTap(data as PushTapData);
  };
  const last = Notifications.getLastNotificationResponse();
  if (last) {
    handle(last);
    Notifications.clearLastNotificationResponse();
  }
  const sub = Notifications.addNotificationResponseReceivedListener(handle);
  return () => sub.remove();
}
