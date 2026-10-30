import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

import { playSound } from '@/lib/soundEffects';

// One call per "moment" -- sound plus a matching haptic. Both honour the
// player's sound setting / device capabilities and can never throw into the UI
// (a missing haptic engine or an audio hiccup must not break a result screen).
export type CelebrationKind = 'levelUp' | 'reward' | 'title';

export function celebrate(kind: CelebrationKind): void {
  try {
    playSound(kind);
  } catch {
    // audio is decoration
  }
  if (Platform.OS === 'web') return;
  try {
    if (kind === 'levelUp') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    else if (kind === 'title') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    else void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // no haptic engine
  }
}
