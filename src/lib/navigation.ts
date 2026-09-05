import { router, type Href } from 'expo-router';

// The app is one flat Expo Router Stack, and every cross-menu tap is a
// `router.push`, so the navigation history is an arbitrary trail rather than a
// hierarchy. This module makes "back" mean "go one level UP toward the main
// menu" regardless of how the screen was actually reached.
//
// `router.dismissTo(href)` (POP_TO): if the target is already in the stack it
// pops back to it; if not, it replaces the current screen with it (keeping
// everything below). Repeated calls therefore always converge on `/home`,
// which sits at stack index 0 in every normal flow (login does
// `router.replace('/home')`).

// Canonical parent for every route. Routes absent here fall back to `/home`.
const PARENT: Record<string, Href> = {
  '/play': '/home',
  '/setup': '/home',
  '/matchmaking': '/home',
  '/bots': '/home',
  '/puzzles': '/home',
  '/tournaments': '/home',
  '/game-room': '/home',
  '/puzzle-match': '/puzzles',
  '/replay': '/iron-id',
  '/result-placeholder': '/home',
  '/daily-bonus': '/home',
  '/spin': '/home',
  '/quests': '/iron-id',
  '/achievements': '/iron-id',
  '/collections': '/iron-id',
  '/iron-id': '/home',
  '/world-rankings': '/home',
  '/friends': '/iron-id',
  '/messages': '/iron-id',
  '/bands': '/iron-id',
  '/front-row': '/iron-id',
  '/shop': '/home',
  '/forge': '/shop',
  '/control-core': '/iron-id',
  '/account-security': '/control-core',
  '/backstage-alerts': '/control-core',
  '/roadie-support': '/control-core',
  '/sign-in': '/sign-up',
};

// Android hardware back is swallowed on these -- either mid-onboarding (the
// account already exists, going "back" to sign-up is broken) or mid-game
// (`/match` registers its own handler that shows the resign prompt instead).
export const BLOCKED_BACK = new Set<string>(['/pick-rockstar', '/welcome-reward', '/match']);

// Android hardware back falls through to the OS here (exit the app / default).
export const ROOT_ROUTES = new Set<string>(['/home', '/sign-up', '/']);

/** Navigate one level up the menu hierarchy from `pathname`. */
export function goUp(pathname: string): void {
  const parent = PARENT[pathname] ?? '/home';
  if (parent === pathname) {
    router.replace('/home');
    return;
  }
  router.dismissTo(parent);
}
