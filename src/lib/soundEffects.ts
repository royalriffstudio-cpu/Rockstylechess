import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { Platform } from 'react-native';

import type { MoveSoundKind } from './chessBoardSnapshot';

type SoundKind = MoveSoundKind | 'illegal' | 'levelUp' | 'reward' | 'title';

const SOUND_SOURCES: Record<SoundKind, number> = {
  move: require('../../assets/sounds/move.wav'),
  capture: require('../../assets/sounds/capture.wav'),
  castle: require('../../assets/sounds/castle.wav'),
  check: require('../../assets/sounds/check.wav'),
  checkmate: require('../../assets/sounds/checkmate.wav'),
  illegal: require('../../assets/sounds/illegal.wav'),
  // Placeholder celebration cues (scripts/gen-celebration-sounds.mjs) -- swap the
  // wav files for real audio with no code change.
  levelUp: require('../../assets/sounds/level-up.wav'),
  reward: require('../../assets/sounds/reward.wav'),
  title: require('../../assets/sounds/title.wav'),
};

// Eagerly instantiated once at module load on every real platform (native,
// and real browser web) -- expo-audio has no dedicated "preload" API, and
// these are small bundled local files with no real load latency, so this
// just avoids first-play instantiation cost. One player per sound, not a
// pool -- chess moves are inherently turn-based/sequential, so true
// overlapping playback of the SAME cue isn't a realistic case.
//
// The one exception: Expo Router's web static-render pass evaluates this
// module in Node (Platform.OS reports 'web' for that bundle target, but
// there's no real `window`/Audio element) -- createAudioPlayer throws
// there. Lazily creating on first real playSound() call instead sidesteps
// that pass without changing eager behavior on native or in an actual
// browser, where `window` exists.
const isServerRenderPass = Platform.OS === 'web' && typeof window === 'undefined';

const players: Partial<Record<SoundKind, AudioPlayer>> = isServerRenderPass
  ? {}
  : (Object.fromEntries(
      (Object.keys(SOUND_SOURCES) as SoundKind[]).map((kind) => [kind, createAudioPlayer(SOUND_SOURCES[kind])]),
    ) as Record<SoundKind, AudioPlayer>);

function getPlayer(kind: SoundKind): AudioPlayer {
  let player = players[kind];
  if (!player) {
    player = createAudioPlayer(SOUND_SOURCES[kind]);
    players[kind] = player;
  }
  return player;
}

const STORAGE_KEY = 'rockstyle-chess:sound-fx-enabled';

// Mirrors playerId.ts's cached-variable-in-front-of-AsyncStorage pattern.
// null = not yet loaded from storage (playSound treats that as "on", same
// as control-core.tsx's current default, so sound isn't silently dropped
// before the async load resolves).
let enabledCache: boolean | null = null;

export async function loadSoundFxPreference(): Promise<boolean> {
  if (enabledCache !== null) return enabledCache;
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  enabledCache = stored !== 'false';
  return enabledCache;
}

export async function setSoundFxEnabled(value: boolean): Promise<void> {
  enabledCache = value;
  await AsyncStorage.setItem(STORAGE_KEY, String(value));
}

export function playSound(kind: SoundKind): void {
  if (enabledCache === false) return;
  const player = getPlayer(kind);
  // seekTo is async (unlike play()) -- must resolve before play() or a
  // rapid repeat trigger can start playback from wherever the previous
  // play left off instead of the beginning.
  player.seekTo(0).then(() => player.play());
}
