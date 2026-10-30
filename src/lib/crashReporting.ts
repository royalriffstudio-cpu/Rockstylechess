import * as Sentry from '@sentry/react-native';
import type { ComponentType } from 'react';

// Crash and error reporting (Sentry). THE ONLY file that imports the SDK besides this module's
// web stub (crashReporting.web.ts), the same rule as src/lib/ads: importing the SDK elsewhere
// would drag it into the web bundle.
//
// Anonymous by policy (docs/privacy-policy.html, Section 2j): no user id, email, name, request
// bodies, headers or tokens ever leave the device. Anything that could identify a player is
// removed here in beforeSend / beforeBreadcrumb, not left to call sites. Does nothing in
// development or when EXPO_PUBLIC_SENTRY_DSN is unset (the DSN is not a secret: it ships in the APK).

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN;
const enabled = !__DEV__ && !!DSN;

// Transient, uninteresting failures: offline requests and socket drops are normal on mobile.
const IGNORED_ERRORS = [/Network request failed/i, /Failed to fetch/i, /timeout/i, /websocket error/i, /xhr poll error/i, /transport (close|error)/i];

// The same error reported over and over (a render loop) must not eat the free quota.
const recent = new Map<string, number>();
const DEDUPE_MS = 60_000;

function isDuplicate(key: string): boolean {
  const now = Date.now();
  const last = recent.get(key);
  recent.set(key, now);
  if (recent.size > 100) for (const [k, t] of recent) if (now - t > DEDUPE_MS) recent.delete(k);
  return last !== undefined && now - last < DEDUPE_MS;
}

const stripQuery = (url: unknown): unknown => (typeof url === 'string' ? url.split('?')[0] : url);

export function initCrashReporting(): void {
  if (!enabled) return;
  const traces = Number(process.env.EXPO_PUBLIC_SENTRY_TRACES ?? 0.1);
  Sentry.init({
    dsn: DSN,
    environment: 'production',
    // release/dist are filled in by the native SDK (package@version+versionCode), which is what
    // the Gradle plugin tags the uploaded source maps with.
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(traces) ? traces : 0.1,
    // Frozen/slow frames and JS thread stalls: the data that shows a hung render thread.
    enableNativeFramesTracking: true,
    enableStallTracking: true,
    enableUserInteractionTracing: false,
    enableCaptureFailedRequests: false,
    attachScreenshot: false,
    attachViewHierarchy: false,
    profilesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    beforeSend(event) {
      delete event.user;
      if (event.request) event.request = { method: event.request.method, url: stripQuery(event.request.url) as string | undefined };
      const message = event.exception?.values?.[0]?.value ?? event.message ?? '';
      if (IGNORED_ERRORS.some((re) => re.test(message))) return null;
      const top = event.exception?.values?.[0]?.stacktrace?.frames?.slice(-1)[0];
      if (isDuplicate(`${message}|${top?.filename ?? ''}:${top?.lineno ?? ''}`)) return null;
      return event;
    },
    beforeBreadcrumb(breadcrumb) {
      if (breadcrumb.category === 'fetch' || breadcrumb.category === 'xhr') {
        const url = String(breadcrumb.data?.url ?? '');
        if (url.includes('/api/auth')) return null; // sign-in / token traffic
        if (breadcrumb.data) breadcrumb.data = { ...breadcrumb.data, url: stripQuery(url) };
      }
      // Console breadcrumbs can contain whatever a log line printed.
      if (breadcrumb.category === 'console') return null;
      return breadcrumb;
    },
  });
}

/** Report a handled-but-important failure (a catch block that would otherwise only console.log). */
export function reportError(error: unknown, tags: Record<string, string | number | undefined> = {}): void {
  console.log(`[${tags.area ?? 'error'}]`, error);
  if (!enabled) return;
  Sentry.withScope((scope) => {
    for (const [key, value] of Object.entries(tags)) if (value !== undefined) scope.setTag(key, String(value));
    Sentry.captureException(error);
  });
}

/** Technical context for everything reported afterwards (screen, mode, difficulty). Never ids of players. */
export function setCrashTags(tags: Record<string, string | undefined>): void {
  if (!enabled) return;
  for (const [key, value] of Object.entries(tags)) Sentry.setTag(key, value);
}

export function addCrashBreadcrumb(category: string, message: string, data?: Record<string, unknown>): void {
  if (!enabled) return;
  Sentry.addBreadcrumb({ category, message, data, level: 'info' });
}

/** Wraps the root component so render errors and touches are tracked. Identity when disabled. */
export function wrapRoot<P extends object>(Root: ComponentType<P>): ComponentType<P> {
  return enabled ? (Sentry.wrap(Root as ComponentType<Record<string, unknown>>) as unknown as ComponentType<P>) : Root;
}

/** Sends a deliberate native crash / JS error from a dev-only test control, then nothing. */
export const crashTestActions = {
  jsError: () => {
    throw new Error('Sentry test: JS error');
  },
  rejection: () => {
    void Promise.reject(new Error('Sentry test: unhandled promise rejection'));
  },
  nativeCrash: () => {
    if (enabled) Sentry.nativeCrash();
  },
};
