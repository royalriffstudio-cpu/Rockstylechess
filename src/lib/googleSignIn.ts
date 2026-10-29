import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';

import { reportError } from '@/lib/crashReporting';

// The ONLY file that imports the native Google sign-in SDK (googleSignIn.web.ts is the web stub -- keep the exports
// identical; same rule as src/lib/ads). It returns a Google ID token; src/lib/authClient.ts hands that to the server,
// which verifies it (signature, audience, expiry) and issues the app's own session. The ID token's audience is the
// WEB OAuth client, which is the server's GOOGLE_CLIENT_ID -- the Android OAuth client (package + SHA-1) is only
// what lets Google confirm this APK is ours.
const WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

/** The player closed the Google chooser. Not an error: the UI shows nothing. */
export class GoogleCancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  // No offline access / refresh token: the server only needs the identity once.
  GoogleSignin.configure({ webClientId: WEB_CLIENT_ID, scopes: ['email', 'profile'] });
  configured = true;
}

// Android's DEVELOPER_ERROR (status 10): the package name / signing SHA-1 is not registered for the Android OAuth client.
const DEVELOPER_ERROR_CODE = '10';

export async function getGoogleIdToken(): Promise<string> {
  if (!WEB_CLIENT_ID) throw new Error("Google sign-in isn't set up in this build.");
  ensureConfigured();
  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    // Signing out first makes Google show the account chooser every time instead of silently reusing the last account.
    await GoogleSignin.signOut().catch(() => {});
    const response = await GoogleSignin.signIn();
    if (response.type === 'cancelled') throw new GoogleCancelledError();
    const idToken = response.data.idToken;
    if (!idToken) throw new Error("Couldn't sign in with Google. Please try again.");
    return idToken;
  } catch (error) {
    if (error instanceof GoogleCancelledError) throw error;
    if (isErrorWithCode(error)) {
      if (error.code === statusCodes.SIGN_IN_CANCELLED) throw new GoogleCancelledError();
      if (error.code === statusCodes.IN_PROGRESS) throw new GoogleCancelledError();
      if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        throw new Error('Google Play services is needed to sign in with Google. Use email and password instead.');
      }
      if (String(error.code) === DEVELOPER_ERROR_CODE) {
        // A configuration mistake on our side (SHA-1 not registered), not something the player can fix.
        reportError(error, { area: 'google-sign-in', problem: 'developer-error' });
        throw new Error("Google sign-in isn't available in this version of the app. Use email and password instead.");
      }
    }
    reportError(error, { area: 'google-sign-in' });
    throw new Error("Couldn't sign in with Google. Check your connection and try again.");
  }
}

/** Forget the Google account on this device (on logout), so the next sign-in starts from the chooser. */
export async function signOutGoogle(): Promise<void> {
  if (!WEB_CLIENT_ID) return;
  ensureConfigured();
  await GoogleSignin.signOut().catch(() => {});
}
