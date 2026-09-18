import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

const STORAGE_KEY = 'rockstyle-chess:music-enabled';

// Lazily created (not eagerly like soundEffects.ts's SFX players) -- this is
// non-trivial background music, not a tiny bundled clip, so there's no
// reason to pay its load cost before the menu is actually reached.
//
// Three tracks played back-to-back in a fixed cycle (1 -> 2 -> 3 -> 1 -> ...)
// rather than one file with expo-audio's `loop`, since that flag restarts a
// single source rather than advancing through several. Each track is its
// own AudioPlayer with a `playbackStatusUpdate` listener watching
// `didJustFinish`; when the current track ends, `advance()` moves to the
// next index (wrapping via modulo) and plays it. All three files were
// loudness-normalized to -23.5 LUFS (matching the level established for the
// prior intro/loop track) with a short exponential fade-in baked in at
// encode time, so no in-app fade logic is needed at the handoff points.
const TRACK_SOURCES = [
  require('../../assets/sounds/mainMenuFixed_track1.m4a'),
  require('../../assets/sounds/mainMenuFixed_track2.m4a'),
  require('../../assets/sounds/mainMenuFixed_track3.m4a'),
];

const players: (AudioPlayer | null)[] = TRACK_SOURCES.map(() => null);
let currentIndex = 0;

function getPlayer(index: number): AudioPlayer {
  let player = players[index];
  if (!player) {
    player = createAudioPlayer(TRACK_SOURCES[index]);
    player.loop = false;
    player.addListener('playbackStatusUpdate', (status) => {
      if (status.didJustFinish && currentIndex === index) advance();
    });
    players[index] = player;
  }
  return player;
}

// Called when the current track finishes naturally -- moves to the next one
// in the cycle and plays it from the start (the player that just finished
// sits at its own end position until it's reached again next cycle).
function advance(): void {
  currentIndex = (currentIndex + 1) % TRACK_SOURCES.length;
  if (wantsToPlay && enabledCache !== false) {
    const next = getPlayer(currentIndex);
    next.seekTo(0);
    next.play();
  }
}

// Same cached-variable-in-front-of-AsyncStorage pattern as soundEffects.ts.
// null = not yet loaded from storage (treated as "on", matching this
// preference's default, so music isn't silently skipped before the async
// load resolves).
let enabledCache: boolean | null = null;

// Tracks whether the menu (as opposed to gameplay) is the current screen,
// independent of the enabled/disabled preference -- so toggling the setting
// mid-menu can start/stop playback immediately without _layout.tsx having to
// re-derive "are we on a menu screen" itself.
let wantsToPlay = false;

export async function loadMusicPreference(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  enabledCache = stored !== 'false';
  return enabledCache;
}

export async function setMusicEnabled(value: boolean): Promise<void> {
  enabledCache = value;
  await AsyncStorage.setItem(STORAGE_KEY, String(value));
  if (wantsToPlay) {
    if (value) getPlayer(currentIndex).play();
    else getPlayer(currentIndex).pause();
  }
}

// Menu screens call this on focus; a no-op if already playing or disabled.
export function playMenuMusic(): void {
  wantsToPlay = true;
  if (enabledCache === false) return;
  const p = getPlayer(currentIndex);
  if (!p.playing) p.play();
}

// Gameplay screens call this on focus.
export function stopMenuMusic(): void {
  wantsToPlay = false;
  players.forEach((p) => p?.pause());
}
