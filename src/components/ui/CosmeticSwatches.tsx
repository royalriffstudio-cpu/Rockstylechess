import { Image } from 'expo-image';
import { View } from 'react-native';

import { getPieceSprites } from '@/components/ui/pieceSprites';
import { Colors, withOpacity } from '@/constants/theme';

// Small preview swatches shared by any screen that lists board themes /
// piece sets (the Forge shop, the Collections inventory) -- a 2x2 checker
// sample of a board's colors, and a piece set's king sprite.
export function BoardSwatch({ light, dark }: { light: string; dark: string }) {
  return (
    <View className="flex-1 flex-row flex-wrap">
      {Array.from({ length: 4 }).map((_, i) => (
        <View key={i} style={{ width: '50%', height: '50%', backgroundColor: (Math.floor(i / 2) + i) % 2 === 0 ? light : dark }} />
      ))}
    </View>
  );
}

export function PieceSwatch({ setId }: { setId: string }) {
  const sprite = getPieceSprites(setId).wk;
  return (
    <View className="flex-1 items-center justify-center" style={{ backgroundColor: withOpacity(Colors.bgBase, 0.5) }}>
      {sprite ? <Image source={sprite} contentFit="contain" style={{ width: '70%', height: '70%' }} /> : null}
    </View>
  );
}
