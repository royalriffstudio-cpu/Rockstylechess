export type PushPermission = 'granted' | 'denied' | 'undetermined' | 'unavailable';

/** What a tapped notification carries: `kind` plus whatever ids the target screen needs (see server/src/push.ts). */
export type PushTapData = Record<string, unknown>;
