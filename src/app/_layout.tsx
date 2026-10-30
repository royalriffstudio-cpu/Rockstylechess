import '../../global.css';

import { Anton_400Regular } from '@expo-google-fonts/anton';
import { Inter_400Regular } from '@expo-google-fonts/inter';
import { Oswald_600SemiBold } from '@expo-google-fonts/oswald';
import { useFonts } from 'expo-font';
import { Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StatusBar } from 'expo-status-bar';
import { BackHandler, Platform } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { enableFreeze } from 'react-native-screens';

import { ChallengeModals } from '@/components/friends/ChallengeModals';
import { ProgressionOverlay } from '@/components/progression/ProgressionOverlay';
import { BottomNav, bottomNavTabForRoute } from '@/components/ui';
import { SplashReveal } from '@/components/ui/SplashReveal';
import { Colors } from '@/constants/theme';
import { ChallengesProvider } from '@/hooks/useChallenges';
import { FriendsProvider } from '@/hooks/useFriends';
import { PlayerProfileProvider } from '@/hooks/usePlayerProfile';
import { initAds } from '@/lib/ads';
import { loadMusicPreference, playMenuMusic, stopMenuMusic } from '@/lib/backgroundMusic';
import { BLOCKED_BACK, goUp, ROOT_ROUTES } from '@/lib/navigation';
import { loadSoundFxPreference } from '@/lib/soundEffects';

// The only screens where a live game is actually being played -- (play)/
// also holds lobby/setup/replay screens (matchmaking, game-room, setup,
// tournaments, puzzles, bots, replay, result-placeholder) that are still
// "menu", so this can't just be a route-group check.
const GAMEPLAY_ROUTES = new Set(['/match', '/puzzle-match']);

// Suspend rendering of screens that aren't the active one (e.g. the bot
// picker sitting under a live match) -- a background provider re-render then
// can't cost a hidden screen a reconcile, and returning to a screen is
// instant. react-native-screens is already a dependency (via expo-router).
enableFreeze(true);

// react-native-keyboard-controller's native module access isn't web-safe --
// browsers already handle keyboard-avoiding behavior natively, so this is a
// pure no-op on web rather than something to find a shim for.
function KeyboardProviderOrFragment({ children }: { children: ReactNode }) {
  if (Platform.OS === 'web') return <>{children}</>;
  return <KeyboardProvider>{children}</KeyboardProvider>;
}

// Keep the native splash screen visible until fonts are ready, so there's
// no flash of unstyled text on first launch.
SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;
  const [fontsLoaded, fontError] = useFonts({
    Anton_400Regular,
    Oswald_600SemiBold,
    Inter_400Regular,
  });
  const [showSplashReveal, setShowSplashReveal] = useState(true);

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  // Ads (consent form + SDK start) wait until the splash is gone so a UMP
  // consent dialog never appears over the splash, and are fire-and-forget: a
  // failure inside initAds() is caught there and can never block the app.
  useEffect(() => {
    if (fontsLoaded || fontError) void initAds();
  }, [fontsLoaded, fontError]);

  // Not gated on splash-hide (unlike fonts) -- a quick local AsyncStorage
  // read with no visible flash-of-content risk. Loaded once here, before any
  // gameplay screen could call playSound(), so a previously-disabled
  // preference isn't briefly ignored just because the user never happened to
  // open Settings this session (soundEffects.ts's cache defaults to "on"
  // until loaded).
  useEffect(() => {
    loadSoundFxPreference();
    loadMusicPreference();
  }, []);

  // Android hardware back = "go one level UP toward the main menu", not "pop
  // the last screen" (see src/lib/navigation.ts). Screens that need to
  // intercept back themselves -- /match (resign prompt), /result-placeholder
  // (straight home) -- register their own BackHandler, which is invoked first
  // because it mounts later. Everything else is handled here.
  useEffect(() => {
    const onBack = () => {
      const path = pathnameRef.current;
      if (ROOT_ROUTES.has(path)) return false; // let the OS exit the app
      if (BLOCKED_BACK.has(path)) return true; // swallow (mid-onboarding / mid-game)
      goUp(path);
      return true;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBack);
    return () => sub.remove();
  }, []);

  // Menu music: on everywhere except the two actual gameplay boards, driven
  // purely by route rather than a per-screen mount/unmount call -- this one
  // effect covers every current and future "menu" screen (home, settings,
  // shop, matchmaking/setup lobbies, replay, ...) without each of them
  // needing to remember to start/stop it themselves. Gated on the same
  // fontsLoaded/fontError condition as the splash-hide effect above -- this
  // effect still fires (with the native splash visible and pathname at its
  // initial route) while fonts are loading, and starting music under the
  // still-visible splash would contradict "after the splash screen".
  useEffect(() => {
    if (!fontsLoaded && !fontError) return;
    if (GAMEPLAY_ROUTES.has(pathname)) {
      stopMenuMusic();
    } else {
      playMenuMusic();
    }
  }, [pathname, fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  // The bottom tab bar lives here, once, driven by the route -- not rendered
  // (and its activeTab hand-set) by each screen. It shows only on the five
  // tab-level menu routes; every pushed detail screen and gameplay screen has
  // a header back button instead. See src/components/ui/BottomNav.tsx.
  const navTab = bottomNavTabForRoute(pathname);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <KeyboardProviderOrFragment>
          <PlayerProfileProvider>
            <FriendsProvider>
              <ChallengesProvider>
                <StatusBar style="light" />
                <Stack
                  screenOptions={{
                    headerShown: false,
                    contentStyle: { backgroundColor: Colors.bgBase },
                    // The iOS left-edge swipe-back is a plain history pop, which
                    // contradicts the hierarchical "back = up" model (and would
                    // let a player swipe out of a live match). All back
                    // navigation goes through the header button or the hardware
                    // back handler instead.
                    gestureEnabled: false,
                  }}
                />
                {navTab ? <BottomNav activeTab={navTab} /> : null}
                <ChallengeModals />
                <ProgressionOverlay />
              </ChallengesProvider>
            </FriendsProvider>
          </PlayerProfileProvider>
        </KeyboardProviderOrFragment>
        {showSplashReveal && <SplashReveal onDone={() => setShowSplashReveal(false)} />}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
