import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppIcon, CurrencyIcon, EmberParticles, RockButton } from '@/components/ui';
import { Colors, withOpacity } from '@/constants/theme';

const REWARD_CHIPS = 10_000;
const DURATION_MS = 2500;
const FRAME_MS = 30;

function formatNumber(num: number) {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function easeOutExpo(t: number) {
  return t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
}

export default function WelcomeRewardScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [displayChips, setDisplayChips] = useState(0);

  useEffect(() => {
    const totalFrames = DURATION_MS / FRAME_MS;
    let currentFrame = 0;
    let timeoutId: ReturnType<typeof setTimeout>;

    const animate = () => {
      currentFrame++;
      const progress = currentFrame / totalFrames;
      setDisplayChips(Math.round(REWARD_CHIPS * easeOutExpo(progress)));
      if (currentFrame < totalFrames) {
        timeoutId = setTimeout(animate, FRAME_MS);
      } else {
        setDisplayChips(REWARD_CHIPS);
      }
    };

    const startId = setTimeout(animate, 500);
    return () => {
      clearTimeout(startId);
      clearTimeout(timeoutId);
    };
  }, []);

  function handleClaim() {
    console.log('Claimed reward', REWARD_CHIPS, 'chips');
    router.replace('/home');
  }

  return (
    <View className="flex-1 items-center justify-center bg-bg-base" style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <LinearGradient pointerEvents="none" colors={[withOpacity(Colors.gold, 0.2), Colors.bgBase, Colors.bgBase]} style={{ position: 'absolute', inset: 0 }} />
      <EmberParticles count={12} />

      <View className="items-center px-margin-mobile" style={{ width: '100%', maxWidth: 440 }}>
        <Text
          className="mb-xl text-center font-display-hero text-display-hero uppercase tracking-widest text-gold"
          style={{ textShadowColor: Colors.gold, textShadowRadius: 18, textShadowOffset: { width: 0, height: 0 } }}
        >
          Welcome Bonus
        </Text>

        <View className="mb-lg items-center justify-center">
          <LinearGradient
            colors={[Colors.gold, '#ffca5e', '#b38200']}
            style={{
              width: 192,
              height: 192,
              borderRadius: 96,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 4,
              borderColor: '#ffdea4',
              boxShadow: `0px 10px 40px ${withOpacity(Colors.gold, 0.6)}`,
            }}
          >
            <View style={{ position: 'absolute', inset: 16, borderRadius: 80, borderWidth: 2, borderStyle: 'dashed', borderColor: 'rgba(117,84,0,0.5)' }} />
            <CurrencyIcon type="chips" size={80} color="#755400" />
          </LinearGradient>
        </View>

        <View className="mb-xl items-center">
          <View className="mb-sm flex-row items-center gap-2">
            <Text className="font-display-hero text-display-hero text-gold">+</Text>
            <Text className="font-display-hero text-display-hero text-text-primary" style={{ fontVariant: ['tabular-nums'] }}>
              {formatNumber(displayChips)}
            </Text>
          </View>
          <Text
            className="rounded-full px-4 py-2 font-section-header text-section-header uppercase tracking-widest text-text-muted"
            style={{ backgroundColor: withOpacity(Colors.chromeDark, 0.2), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3) }}
          >
            Chips Added To Your Vault
          </Text>
        </View>

        <View style={{ width: '100%', maxWidth: 380 }}>
          <RockButton label="Claim & Play" variant="gold" icon={<AppIcon name="arrow_forward_ios" size={18} color={Colors.bgBase} />} onPress={handleClaim} />
        </View>
      </View>
    </View>
  );
}
