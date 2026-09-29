import { Linking } from 'react-native';

export const SUPPORT_EMAIL = 'royalriffstudio@gmail.com';

// mailto: is the only Linking scheme this file opens -- see constants/legal.ts
// for the expo-web-browser-based Privacy Policy/Terms of Service links.
export function openSupportEmail(subject: string, body?: string): void {
  const params = new URLSearchParams({ subject });
  if (body) params.set('body', body);
  void Linking.openURL(`mailto:${SUPPORT_EMAIL}?${params.toString()}`);
}
