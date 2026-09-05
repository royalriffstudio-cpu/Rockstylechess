import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { AppIcon, CurrencyPill, EmberParticles, RockButton, RockCard } from '@/components/ui';
import { SubPageHeader } from '@/components/layout';
import { Colors, withOpacity } from '@/constants/theme';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getSpinStatus, spinWheel, type SpinResult } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { ANGLE_PER_SEGMENT, SPIN_SEGMENTS, type SpinSegment } from '@/lib/spinPrizes';

const WHEEL_SIZE = 300;

function buildSegmentPath(startAngle: number, endAngle: number): string {
  const x1 = 50 + 50 * Math.cos((Math.PI * (startAngle - 90)) / 180);
  const y1 = 50 + 50 * Math.sin((Math.PI * (startAngle - 90)) / 180);
  const x2 = 50 + 50 * Math.cos((Math.PI * (endAngle - 90)) / 180);
  const y2 = 50 + 50 * Math.sin((Math.PI * (endAngle - 90)) / 180);
  return `M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`;
}

export default function SpinScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { status: profileStatus, gems, refresh } = usePlayerProfile();
  const rotation = useSharedValue(0);
  const totalRotationRef = useRef(0);
  const [canSpin, setCanSpin] = useState<boolean | null>(null); // null = not loaded yet
  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<SpinSegment | null>(null);

  useEffect(() => {
    if (profileStatus !== 'ready') return;
    let cancelled = false;
    (async () => {
      const token = await getAuthToken();
      if (!token) return;
      try {
        const status = await getSpinStatus(token);
        if (!cancelled) setCanSpin(status.canSpin);
      } catch (error) {
        console.log('Failed to load spin status', error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileStatus]);

  function handleSpinComplete(spinResult: SpinResult, segmentIndex: number) {
    setIsSpinning(false);
    setCanSpin(false);
    setResult(SPIN_SEGMENTS[segmentIndex] ?? null);
    refresh();
  }

  async function handleSpin() {
    if (isSpinning || !canSpin) return;
    const token = await getAuthToken();
    if (!token) return;

    setIsSpinning(true);
    setResult(null);

    let spinResult: SpinResult;
    try {
      spinResult = await spinWheel(token);
    } catch (error) {
      console.log('Spin failed', error);
      setIsSpinning(false);
      setCanSpin(false);
      return;
    }

    const segmentIndex = Math.max(
      0,
      SPIN_SEGMENTS.findIndex((s) => s.id === spinResult.prizeId),
    );
    const extraRounds = 5 + Math.floor(Math.random() * 5);
    // Land the fixed top pointer on the middle of the winning segment --
    // reverse of the old "derive the prize from wherever the wheel lands"
    // logic: the server already decided the prize, we just animate to it.
    const segmentMidAngle = segmentIndex * ANGLE_PER_SEGMENT + ANGLE_PER_SEGMENT / 2;
    const targetNormalized = (360 - segmentMidAngle) % 360;
    const currentNormalized = totalRotationRef.current % 360;
    const delta = (targetNormalized - currentNormalized + 360) % 360;
    totalRotationRef.current += extraRounds * 360 + delta;
    const target = totalRotationRef.current;

    rotation.value = withTiming(
      target,
      { duration: 4000, easing: Easing.bezier(0.15, 0, 0.15, 1) },
      (finished) => {
        if (finished) {
          runOnJS(handleSpinComplete)(spinResult, segmentIndex);
        }
      },
    );
  }

  const wheelStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  return (
    <View className="flex-1 bg-bg-base">
      <EmberParticles count={10} />
      <SubPageHeader title="Daily Spin" trailing={<CurrencyPill type="gems" value={gems} />} />

      {profileStatus === 'guest' ? (
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <Text className="text-center font-body-base text-body-base text-text-muted">Sign in to spin the wheel.</Text>
          <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
        </View>
      ) : canSpin === null ? (
        <ActivityIndicator color={Colors.cyan} style={{ marginTop: 48 }} />
      ) : (
        <View
          className="flex-1 items-center justify-center gap-xl p-lg"
          style={{ paddingBottom: insets.bottom + 16 }}
        >
          <View style={{ width: WHEEL_SIZE, height: WHEEL_SIZE, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', top: -14, zIndex: 2 }}>
              <Svg width={32} height={40} viewBox="0 0 40 50">
                <Path d="M20 50L0 10C0 4.47715 4.47715 0 10 0H30C35.5228 0 40 4.47715 40 10L20 50Z" fill={Colors.crimson} />
              </Svg>
            </View>

            <Animated.View
              style={[
                {
                  width: WHEEL_SIZE,
                  height: WHEEL_SIZE,
                  borderRadius: WHEEL_SIZE / 2,
                  borderWidth: 10,
                  borderColor: Colors.chromeDark,
                  overflow: 'hidden',
                  boxShadow: `0px 0px 50px ${withOpacity(Colors.bgBase, 0.8)}, inset 0px 0px 30px ${withOpacity(Colors.bgBase, 0.6)}`,
                },
                wheelStyle,
              ]}
            >
              <Svg width={WHEEL_SIZE} height={WHEEL_SIZE} viewBox="0 0 100 100">
                {SPIN_SEGMENTS.map((segment, i) => (
                  <Path key={segment.id} d={buildSegmentPath(i * ANGLE_PER_SEGMENT, (i + 1) * ANGLE_PER_SEGMENT)} fill={segment.color} stroke={withOpacity(Colors.chrome, 0.08)} strokeWidth={0.5} />
                ))}
              </Svg>

              <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
                {SPIN_SEGMENTS.map((segment, i) => {
                  const midAngle = i * ANGLE_PER_SEGMENT + ANGLE_PER_SEGMENT / 2;
                  return (
                    <View key={segment.id} style={[StyleSheet.absoluteFillObject, { transform: [{ rotate: `${midAngle}deg` }] }]}>
                      <Text
                        className="font-section-header"
                        style={{ position: 'absolute', top: 28, left: 0, right: 0, textAlign: 'center', fontSize: 11, color: Colors.textPrimary, textShadowColor: withOpacity(Colors.bgBase, 0.8), textShadowRadius: 3, textShadowOffset: { width: 0, height: 1 } }}
                      >
                        {segment.label}
                      </Text>
                    </View>
                  );
                })}
              </View>
            </Animated.View>

            <View
              className="items-center justify-center"
              style={{ position: 'absolute', width: 90, height: 90, borderRadius: 45, backgroundColor: Colors.ember, borderWidth: 4, borderColor: Colors.bgBase, boxShadow: `0px 4px 12px ${withOpacity(Colors.bgBase, 0.6)}` }}
            >
              <Text className="font-display-hero" style={{ fontSize: 26, color: Colors.bgBase }}>
                45
              </Text>
              <Text className="font-section-header" style={{ fontSize: 7, color: withOpacity(Colors.bgBase, 0.8), letterSpacing: 0.5 }}>
                RPM High Fidelity
              </Text>
            </View>
          </View>

          <View style={{ width: '100%', maxWidth: 320 }}>
            <RockButton
              label={canSpin ? 'Spin Now' : 'Come Back Tomorrow'}
              loadingLabel="Spinning..."
              icon={<AppIcon name="casino" size={18} color={Colors.bgBase} />}
              variant="gold"
              loading={isSpinning}
              disabled={!canSpin}
              onPress={handleSpin}
            />
          </View>

          {result ? (
            <RockCard glowColor={Colors.gold} style={{ width: '100%', maxWidth: 320, alignItems: 'center' }}>
              <Text className="font-section-header text-text-muted" style={{ fontSize: 12, letterSpacing: 2 }}>
                YOU WON!
              </Text>
              <Text className="font-display-hero text-gold" style={{ fontSize: 24, marginTop: 4, textShadowColor: withOpacity(Colors.gold, 0.5), textShadowRadius: 10, textShadowOffset: { width: 0, height: 0 } }}>
                {result.label}
              </Text>
              <Pressable onPress={() => setResult(null)}>
                <Text className="font-body-sm text-text-muted" style={{ fontSize: 12, textDecorationLine: 'underline', marginTop: 8 }}>
                  Nice — collect later
                </Text>
              </Pressable>
            </RockCard>
          ) : null}
        </View>
      )}
    </View>
  );
}
