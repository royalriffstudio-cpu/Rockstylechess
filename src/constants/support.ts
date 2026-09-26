import { Linking } from 'react-native';

// PLACEHOLDER -- swap for the real support inbox before shipping. Nothing
// currently monitors this address.
export const SUPPORT_EMAIL = 'support@rockstylechess.com';

// mailto: is the only Linking scheme this app opens today -- there's no
// expo-web-browser usage anywhere yet (that plugin is declared in app.json
// purely in anticipation of a future Privacy Policy/Terms link, deferred for
// now), so this is the first external-link affordance in the app.
export function openSupportEmail(subject: string, body?: string): void {
  const params = new URLSearchParams({ subject });
  if (body) params.set('body', body);
  void Linking.openURL(`mailto:${SUPPORT_EMAIL}?${params.toString()}`);
}
