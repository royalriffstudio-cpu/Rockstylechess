import type { ComponentType } from 'react';

// Web stub: the Sentry SDK must never be imported into the web bundle (see crashReporting.ts).
export function initCrashReporting(): void {}
export function reportError(error: unknown, tags: Record<string, string | number | undefined> = {}): void {
  console.log(`[${tags.area ?? 'error'}]`, error);
}
export function setCrashTags(_tags: Record<string, string | undefined>): void {}
export function addCrashBreadcrumb(_category: string, _message: string, _data?: Record<string, unknown>): void {}
export function wrapRoot<P extends object>(Root: ComponentType<P>): ComponentType<P> {
  return Root;
}
export const crashTestActions = {
  jsError: () => {
    throw new Error('Sentry test: JS error');
  },
  rejection: () => {
    void Promise.reject(new Error('Sentry test: unhandled promise rejection'));
  },
  nativeCrash: () => {},
};
