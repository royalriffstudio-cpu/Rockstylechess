import * as Sentry from '@sentry/node';

// Crash/error reporting for the server (Sentry). Anonymous by policy (docs/privacy-policy.html
// Section 2j): no user id, email, name, headers, cookies or request bodies ever leave the
// process, and tags carry technical ids only (area, matchId, tier).
//
// Initialised at import time, and imported right after env.js in index.ts, so the DSN from
// .env is visible and the SDK is up before the rest of the server loads. With SENTRY_DSN unset
// (local development) everything here is a no-op apart from the console.error in reportError.
// The server is ESM, so there is no auto-instrumentation/tracing -- errors only, which is the
// point.

const DSN = process.env.SENTRY_DSN;

if (DSN) {
  Sentry.init({
    dsn: DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.RAILWAY_ENVIRONMENT_NAME ?? 'production',
    release: process.env.SENTRY_RELEASE ?? process.env.RAILWAY_GIT_COMMIT_SHA ?? `rockstyle-server@${process.env.npm_package_version ?? 'dev'}`,
    // Sentry 11 collects headers, cookies, bodies and user info by default: switch ALL of it off.
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false },
    tracesSampleRate: 0,
    // Expected, uninteresting failures: a client dropping its socket mid-request.
    ignoreErrors: ['ECONNRESET', 'EPIPE', 'aborted'],
    beforeSend(event) {
      delete event.user;
      if (event.request) {
        // Keep only what locates the failing route; never headers (bearer tokens), cookies, query or body.
        event.request = { method: event.request.method, url: event.request.url?.split('?')[0] };
      }
      return event;
    },
  });
}

/** Report a handled-but-important failure. Always logs too, so Railway logs stay complete. */
export function reportError(error: unknown, tags: Record<string, string | number | undefined> = {}): void {
  console.error(`[${tags.area ?? 'error'}]`, error);
  if (!DSN) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(tags)) {
      if (value !== undefined) scope.setTag(key, String(value));
    }
    Sentry.captureException(error);
  });
}

/** Express error handler hook (see index.ts). */
export const setupExpressMonitoring = (app: Parameters<typeof Sentry.setupExpressErrorHandler>[0]): void => {
  if (DSN) Sentry.setupExpressErrorHandler(app);
};

/** Flush pending events before the process exits (SIGTERM during a Railway deploy). */
export async function flushMonitoring(timeoutMs = 2000): Promise<void> {
  if (DSN) await Sentry.close(timeoutMs);
}
