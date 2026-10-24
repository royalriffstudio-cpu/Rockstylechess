import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import { registerPushDevice, unregisterPushDevice } from './api';
import { getAuthToken } from './authStorage';
import { getExpoPushToken, getPushPermission } from './pushNotifications';

// Ties this install's Expo push token to the signed-in account on the server. Never throws: push is a
// convenience, and a failed call must not break sign-in, logout or account deletion.

const TOKEN_KEY = 'rockstyle-chess:push-token';
const PRIMED_KEY = 'rockstyle-chess:push-primer-seen';

/** Registers (or re-registers) this device for the signed-in account. Safe to call on every launch. */
export async function registerThisDevice(): Promise<void> {
  try {
    if ((await getPushPermission()) !== 'granted') return;
    const [authToken, pushToken] = await Promise.all([getAuthToken(), getExpoPushToken()]);
    if (!authToken || !pushToken) return;
    await registerPushDevice(authToken, { pushToken, platform: Platform.OS, tzOffsetMin: -new Date().getTimezoneOffset() });
    await AsyncStorage.setItem(TOKEN_KEY, pushToken);
  } catch (error) {
    console.log('Push registration failed', error);
  }
}

/** Call BEFORE clearing the auth token (the request needs it) -- logout and account deletion. */
export async function unregisterThisDevice(): Promise<void> {
  try {
    const [authToken, pushToken] = await Promise.all([getAuthToken(), AsyncStorage.getItem(TOKEN_KEY)]);
    if (authToken && pushToken) await unregisterPushDevice(authToken, pushToken);
    await AsyncStorage.removeItem(TOKEN_KEY);
  } catch (error) {
    console.log('Push unregistration failed', error);
  }
}

/** True once the in-game "turn on notifications?" primer has been shown (whatever the answer was). */
export async function hasSeenPushPrimer(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(PRIMED_KEY)) === 'true';
  } catch {
    return true; // storage broken: never nag
  }
}

export async function markPushPrimerSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(PRIMED_KEY, 'true');
  } catch {
    // ignore
  }
}
