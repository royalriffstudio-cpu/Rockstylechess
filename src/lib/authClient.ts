import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

// Baked into the client bundle at build time -- matches api.ts/socket.ts's
// own EXPO_PUBLIC_SERVER_URL fallback so all three point at the same server.
const SERVER_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'http://localhost:4000';

// expoClient's `storage` option must be *synchronous* (getItem returns
// `string | null` directly, not a Promise) -- expo-secure-store's sync
// getItem/setItem satisfy that on native. On web the SecureStore module
// throws on every method (no Keychain/Keystore equivalent there), so this
// falls back to localStorage, which is also synchronous -- same web/native
// split authStorage.ts uses for the actual bearer token below.
const syncStorage = {
  getItem: (key: string): string | null =>
    Platform.OS === 'web' ? window.localStorage.getItem(key) : SecureStore.getItem(key),
  setItem: (key: string, value: string): void => {
    if (Platform.OS === 'web') window.localStorage.setItem(key, value);
    else SecureStore.setItem(key, value);
  },
};

export const authClient = createAuthClient({
  baseURL: SERVER_URL,
  plugins: [
    expoClient({
      scheme: 'rockstylechess',
      storagePrefix: 'rockstylechess',
      storage: syncStorage,
    }),
    // Email codes: verify an address, reset a forgotten password (server/src/betterAuth.ts emailOTP).
    emailOTPClient(),
  ],
});

// The app doesn't use authClient's own cookie-backed session state (it
// already has a working token flow via authStorage.ts/api.ts/socket.ts) --
// this just extracts the portable bearer token betterAuth.ts's bearer()
// plugin puts on the response, via the same onSuccess hook the plugin's
// docs use, so callers can feed it into that existing flow unchanged.
function extractToken(headers: Headers): string | null {
  return headers.get('set-auth-token');
}

// The server refuses a sign-up whose email cannot be real (server/src/emailPolicy.ts). The screen turns the code into
// friendly copy, and for a typo offers the corrected address.
export type EmailProblemCode = 'invalid-email' | 'email-undeliverable' | 'disposable-email' | 'email-typo';
const EMAIL_PROBLEM_CODES: readonly string[] = ['invalid-email', 'email-undeliverable', 'disposable-email', 'email-typo'];

export class EmailProblemError extends Error {
  constructor(
    public readonly code: EmailProblemCode,
    public readonly suggestion?: string,
  ) {
    super(code);
  }
}

function emailProblemFrom(error: { code?: string; suggestion?: unknown }): EmailProblemError | null {
  if (!error.code || !EMAIL_PROBLEM_CODES.includes(error.code)) return null;
  return new EmailProblemError(error.code as EmailProblemCode, typeof error.suggestion === 'string' ? error.suggestion : undefined);
}

export async function signUpWithEmail(email: string, password: string): Promise<{ token: string }> {
  // The real display name is collected one screen later by pick-rockstar.tsx
  // (playerProfiles.displayName) -- this is just a placeholder to satisfy
  // better-auth's required `name` field on the user record.
  const name = email.split('@')[0] || email;
  let token: string | null = null;
  const { error } = await authClient.signUp.email(
    { email, password, name },
    { onSuccess: (ctx) => { token = extractToken(ctx.response.headers); } },
  );
  if (error) throw emailProblemFrom(error) ?? new Error(error.message ?? 'Something went wrong');
  if (!token) throw new Error('Something went wrong');
  return { token };
}

export async function signInWithEmail(email: string, password: string): Promise<{ token: string }> {
  let token: string | null = null;
  const { error } = await authClient.signIn.email(
    { email, password },
    { onSuccess: (ctx) => { token = extractToken(ctx.response.headers); } },
  );
  if (error || !token) throw new Error(error?.message ?? 'Something went wrong');
  return { token };
}

// --- Google (browser flow) -----------------------------------------------------------------------------
// Opens Google in a Chrome Custom Tab through expoClient; on return it holds the session as a cookie. The rest of
// the app (api.ts, socket.ts, authStorage.ts) works on a bearer token instead, and the bearer plugin accepts the
// signed session cookie value as one, so that value is lifted out here and the cookie is dropped again -- one
// source of truth, and logout only has to clear authStorage.
const COOKIE_STORAGE_KEY = 'rockstylechess_cookie'; // `${storagePrefix}_cookie`, see expoClient

function takeSessionToken(): string | null {
  const cookie = authClient.getCookie();
  const token = cookie.match(/session_token=([^;]+)/)?.[1] ?? null;
  syncStorage.setItem(COOKIE_STORAGE_KEY, '{}');
  return token;
}

export async function signInWithGoogle(): Promise<{ token: string }> {
  if (Platform.OS === 'web') throw new Error('Google sign-in is available in the mobile app.');
  syncStorage.setItem(COOKIE_STORAGE_KEY, '{}'); // never send a stale cookie into a fresh sign-in
  const { error } = await authClient.signIn.social({ provider: 'google', callbackURL: '/' });
  if (error) throw new Error("Google sign-in isn't available right now. Please try again later.");
  const token = takeSessionToken();
  // No session after the tab closed: cancelled, refused, or the email already belongs to a password account.
  if (!token) {
    throw new Error(
      "Couldn't sign in with Google. If you already have an account with this email, sign in with your password and link Google in Account Security.",
    );
  }
  return { token };
}

/** Link Google to the account behind `token` (signed in with a password). Resolves once the tab has closed; re-read the profile for the result. */
export async function linkGoogleAccount(token: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('Linking Google is available in the mobile app.');
  syncStorage.setItem(COOKIE_STORAGE_KEY, '{}');
  const { error } = await authClient.linkSocial(
    { provider: 'google', callbackURL: '/' },
    { headers: { Authorization: `Bearer ${token}` } },
  );
  syncStorage.setItem(COOKIE_STORAGE_KEY, '{}');
  if (error) throw new Error("Couldn't start Google linking. Please try again later.");
}

// --- Email codes (verify + password reset) -------------------------------------------------------------

function describeCodeError(error: { code?: string; status?: number; message?: string }): string {
  if (error.status === 429) return 'Too many tries. Wait a minute and try again.';
  switch (error.code) {
    case 'INVALID_OTP':
      return "That code isn't right. Check it and try again.";
    case 'OTP_EXPIRED':
      return 'That code has expired. Request a new one.';
    case 'TOO_MANY_ATTEMPTS':
      return 'Too many wrong tries. Request a new code.';
    default:
      return error.status === 404 ? "This isn't available yet." : (error.message ?? 'Something went wrong');
  }
}

/** Mails a fresh 6-digit verification code (the server paces repeats: one per minute per address). */
export async function requestEmailCode(email: string): Promise<void> {
  const { error } = await authClient.emailOtp.sendVerificationOtp({ email, type: 'email-verification' });
  if (error) throw new Error(describeCodeError(error));
}

export async function verifyEmailCode(email: string, otp: string): Promise<void> {
  const { error } = await authClient.emailOtp.verifyEmail({ email, otp });
  if (error) throw new Error(describeCodeError(error));
}

/** Always resolves the same way for known and unknown emails (the server does not reveal which has an account). */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await authClient.emailOtp.requestPasswordReset({ email });
  if (error) throw new Error(describeCodeError(error));
}

export async function resetPasswordWithCode(email: string, otp: string, password: string): Promise<void> {
  const { error } = await authClient.emailOtp.resetPassword({ email, otp, password });
  if (error) throw new Error(describeCodeError(error));
}
