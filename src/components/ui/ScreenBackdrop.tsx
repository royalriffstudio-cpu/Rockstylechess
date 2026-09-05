import { Image, type ImageSource } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { StyleSheet } from 'react-native';

import { Colors, withOpacity } from '@/constants/theme';

interface ScreenBackdropProps {
  /** A `require(...)` module or a remote `{ uri }` — the atmospheric photo. */
  source: ImageSource | number;
  /** Photo opacity before the scrim. Screens with dense content want this low. */
  opacity?: number;
  /**
   * Scrim strength at the top of the screen (the bottom always lands on
   * `bgBase` so content stays readable). 0 = no top scrim, 1 = opaque.
   */
  topScrim?: number;
}

/**
 * Full-bleed atmospheric photo + a vertical scrim to `bgBase`, mounted as the
 * first child of a screen's root `View` (behind `EmberParticles` and content).
 * Translates the Stitch mockups' full-screen background images without letting
 * them fight the foreground UI.
 */
export function ScreenBackdrop({ source, opacity = 0.35, topScrim = 0.55 }: ScreenBackdropProps) {
  return (
    <>
      <Image
        source={source}
        contentFit="cover"
        cachePolicy="memory-disk"
        transition={300}
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { opacity }]}
      />
      <LinearGradient
        pointerEvents="none"
        colors={[withOpacity(Colors.bgBase, topScrim), withOpacity(Colors.bgBase, 0.85), Colors.bgBase]}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFillObject}
      />
    </>
  );
}
