import * as WebBrowser from 'expo-web-browser';

// Served from this repo's docs/ folder (privacy-policy.html /
// terms-of-service.html) via GitHub Pages. Requires Pages to be enabled on
// the upstream repo (Settings -> Pages -> source: main /docs) and those
// files pushed -- until then these two URLs 404.
export const PRIVACY_POLICY_URL = 'https://royalriffstudio-cpu.github.io/Rockstylechess/privacy-policy.html';
export const TERMS_OF_SERVICE_URL = 'https://royalriffstudio-cpu.github.io/Rockstylechess/terms-of-service.html';

// Opens an in-app browser tab (SFSafariViewController / Chrome Custom Tab)
// instead of kicking the player out to their default browser app.
// expo-web-browser was already declared in app.json in anticipation of
// exactly this (see support.ts's comment) -- this is its first real call site.
export function openLegalDocument(url: string): void {
  void WebBrowser.openBrowserAsync(url);
}
