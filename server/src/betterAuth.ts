import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { bearer, emailOTP } from 'better-auth/plugins';

import { allowedTrustedOrigins } from './allowedOrigins.js';
import { db } from './db/client.js';
import { emailGateEnabled, forgetEmailGateCache, grantWelcomeBonus } from './db/emailGate.js';
import { checkEmail, isTestEmail } from './emailPolicy.js';
import { isLocalDatabase } from './localDb.js';
import { mailAllowed, passwordResetMail, sendMail, verificationMail } from './mailer.js';
import { generateFriendCode } from './db/friends.js';
import { ECONOMY } from './economy.generated.js';
import { account, playerProfiles, session, users, verification } from './db/schema/index.js';

const BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET;
if (!BETTER_AUTH_SECRET) {
  throw new Error('BETTER_AUTH_SECRET is not set');
}

// Dev convenience only: an account whose email is on the local test domain (emailPolicy.ts isTestEmail, which is
// false on any non-local database and whose value lives only in a developer's local .env) gets a large chips/gems
// balance instead of the normal defaults, so Forge purchases can be smoke-tested without grinding or editing the DB.
const TEST_ACCOUNT_CHIPS = 100_000;
const TEST_ACCOUNT_GEMS = 100_000;

// "Continue with Google". The app signs in natively (src/lib/googleSignIn.ts) and posts a Google ID token whose audience is
// the Web client ID below; the browser redirect flow through @better-auth/expo still works for older builds. The provider only exists when both values are
// set, so a server without them (local dev, CI) behaves exactly as before and the sign-in route just errors.
// The redirect URI to register in Google Cloud is `${BETTER_AUTH_URL}/api/auth/callback/google`. Existing
// email/password accounts are deliberately NOT auto-linked (better-auth refuses while their email is unverified);
// a signed-in player links Google from Account Security instead.
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
export const googleSignInEnabled = Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  secret: BETTER_AUTH_SECRET,
  database: drizzleAdapter(db, {
    provider: 'pg',
    // Reuses the existing `users` table as better-auth's `user` model
    // (rather than a separate table) so playerProfiles/matches/etc.'s
    // existing `references(() => users.id)` FKs need no changes.
    schema: { user: users, session, account, verification },
  }),
  // Keeps Postgres's own `defaultRandom()` (gen_random_uuid()) generating
  // every id below, matching the pre-existing `users.id` column type/shape
  // instead of better-auth's own id format.
  advanced: { database: { generateId: false } },
  trustedOrigins: allowedTrustedOrigins,
  emailAndPassword: { enabled: true, minPasswordLength: 8, revokeSessionsOnPasswordReset: true },
  // sendOnSignUp makes better-auth ask for a verification mail at sign-up; the emailOTP plugin below (with
  // overrideDefaultEmailVerification) turns that into a 6-digit code. Only when EMAIL_GATE is on.
  emailVerification: { sendOnSignUp: emailGateEnabled() },
  ...(googleSignInEnabled
    ? { socialProviders: { google: { clientId: GOOGLE_CLIENT_ID as string, clientSecret: GOOGLE_CLIENT_SECRET as string } } }
    : {}),
  rateLimit: {
    // Rate limiting defaults to production-only; this is an MVP with real
    // brute-force exposure on login/signup even in dev/staging use, so
    // enable it unconditionally.
    enabled: true,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 5 },
      '/sign-in/social': { window: 60, max: 10 },
    },
  },
  // bearer(): lets a session be presented as `Authorization: Bearer <token>`
  // (the raw token is returned via the `set-auth-token` response header on
  // sign-in/sign-up) -- both api.ts's REST calls and socket.ts's handshake
  // auth already depend on a portable token string like this, not a cookie
  // jar, which React Native can't carry across platforms cleanly anyway.
  // expo(): default trustedOrigins for Expo dev clients + the expo-origin
  // header rewrite and /expo-authorization-proxy that the Google browser flow uses; a harmless
  // no-op for email/password.
  plugins: [
    bearer(),
    expo(),
    // 6-digit email codes: verify an address, and reset a forgotten password. Stored hashed, 10 minutes, 5 tries.
    emailOTP({
      otpLength: 6,
      expiresIn: 600,
      allowedAttempts: 5,
      // The plugin's own per-IP limiter on each code endpoint (default 3/min); matches allowedAttempts.
      rateLimit: { window: 60, max: 5 },
      storeOTP: 'hashed',
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'email-verification' && type !== 'forget-password') return;
        if (isTestEmail(email) || !mailAllowed(email)) return;
        // Not awaited: the response must not reveal (by timing) whether the address has an account.
        void sendMail(type === 'email-verification' ? verificationMail(email, otp) : passwordResetMail(email, otp)).catch((error) =>
          console.error('mail send failed:', error instanceof Error ? error.message : error),
        );
      },
    }),
  ],
  hooks: {
    before: createAuthMiddleware(async (ctx) => {
      const path = ctx.path;
      if (path === '/sign-up/email') {
        const problem = await checkEmail(String((ctx.body as { email?: unknown } | undefined)?.email ?? ''));
        if (problem) {
          throw new APIError('BAD_REQUEST', { message: problem.code, code: problem.code, ...(problem.suggestion ? { suggestion: problem.suggestion } : {}) });
        }
        return;
      }
      // The plugin also ships passwordless sign-in and email change; neither is a sign-in method we offer.
      if (path === '/sign-in/email-otp' || path === '/forget-password/email-otp' || path === '/email-otp/request-email-change' || path === '/email-otp/change-email') {
        throw new APIError('NOT_FOUND', { message: 'Not found' });
      }
      if (path.startsWith('/email-otp/')) {
        if (!emailGateEnabled()) throw new APIError('NOT_FOUND', { message: 'Not found' });
        if (path === '/email-otp/send-verification-otp') {
          const type = (ctx.body as { type?: unknown } | undefined)?.type;
          if (type !== 'email-verification' && type !== 'forget-password') throw new APIError('BAD_REQUEST', { message: 'Invalid OTP type' });
        }
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        // The local test domain is created already verified (it is exempt from every email rule).
        before: async (user) => {
          if (isTestEmail(user.email)) return { data: { ...user, emailVerified: true } };
        },
        // Replaces the old POST /auth/signup handler's
        // `db.insert(playerProfiles)` call -- same defaults (1200 rating,
        // the welcome bonus in economy.config.json) come from playerProfiles's own column defaults, except
        // for local-dev test-domain accounts (see TEST_ACCOUNT_CHIPS above).
        after: async (user) => {
          const isTestAccount = isTestEmail(user.email);
          // A new email/password account with the gate on holds its welcome bonus until the email is verified
          // (grantWelcomeBonus pays it on verification). Google and test accounts arrive verified: paid now.
          const holdBonus = emailGateEnabled() && !user.emailVerified;
          await db.insert(playerProfiles).values({
            userId: user.id,
            // The short code another player types in to friend this account
            // (see db/friends.ts). Generated once, here, so it exists for
            // every account from creation.
            friendCode: await generateFriendCode(),
            chips: holdBonus ? 0 : ECONOMY.welcomeChips,
            welcomeBonusPending: holdBonus,
            ...(isTestAccount ? { chips: TEST_ACCOUNT_CHIPS, gems: TEST_ACCOUNT_GEMS } : {}),
          });
        },
      },
      update: {
        // Verifying the email (the OTP route updates the user row) releases the held welcome bonus. Idempotent
        // (db/emailGate.ts), and /me/profile retries it if this ever failed, so a hiccup never strands the chips.
        after: async (user) => {
          forgetEmailGateCache(user.id);
          if (user.emailVerified) {
            try {
              await grantWelcomeBonus(user.id);
            } catch (error) {
              console.error('welcome bonus grant failed', error);
            }
          }
        },
      },
    },
  },
});
