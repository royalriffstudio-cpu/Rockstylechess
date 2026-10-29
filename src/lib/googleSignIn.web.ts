// Web stub -- the native Google sign-in SDK is not bundled for web (Metro resolves this file instead of
// googleSignIn.ts there). Keep the exports identical to googleSignIn.ts.

export class GoogleCancelledError extends Error {
  constructor() {
    super('cancelled');
  }
}

export async function getGoogleIdToken(): Promise<string> {
  throw new Error('Google sign-in is available in the mobile app.');
}

export async function signOutGoogle(): Promise<void> {}
