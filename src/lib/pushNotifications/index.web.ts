import type { PushPermission, PushTapData } from './types';

// Web stub -- expo-notifications' native token/permission APIs have no web equivalent we use, and the native
// module must stay out of the web bundle. Metro resolves this file instead of index.ts on web. Keep the
// exports identical to index.ts.

export type { PushPermission, PushTapData } from './types';

export async function initPush(): Promise<void> {}
export async function getPushPermission(): Promise<PushPermission> {
  return 'unavailable';
}
export async function requestPushPermission(): Promise<PushPermission> {
  return 'unavailable';
}
export function openPushSettings(): void {}
export async function getExpoPushToken(): Promise<string | null> {
  return null;
}
export function subscribeToPushTaps(_onTap: (data: PushTapData) => void): () => void {
  return () => {};
}
