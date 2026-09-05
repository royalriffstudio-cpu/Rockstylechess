import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

import { getPieceSprites } from '@/components/ui/pieceSprites';

// Off-screen, non-interactive. Decodes the equipped piece set (12 vtraced
// SVGs, 170-395 KB each) into expo-image's memory + disk cache BEFORE /match
// mounts, so the board doesn't visibly blank-flash rasterising them on entry.
// Render on the pre-match screens (setup / bots / matchmaking). Real pixel
// size so the warmed bitmap matches roughly what the board asks for.
export function BoardAssetPrewarm({ pieceId }: { pieceId?: string | null }) {
  const sprites = Object.values(getPieceSprites(pieceId));
  return (
    <View style={styles.holder} pointerEvents="none" aria-hidden>
      {sprites.map((sprite, i) => (
        <Image
          key={i}
          source={sprite}
          cachePolicy="memory-disk"
          contentFit="contain"
          priority="low"
          style={styles.warm}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  holder: {
    position: 'absolute',
    top: -1000,
    left: -1000,
    width: 44,
    height: 44,
    opacity: 0,
    overflow: 'hidden',
  },
  warm: { width: 44, height: 44 },
});
