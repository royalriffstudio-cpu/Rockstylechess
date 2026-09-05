import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';

import { ChessBoard, PlayerAvatar, ScreenBackdrop } from '@/components/ui';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { goUp } from '@/lib/navigation';

const CHAT_TICKER =
  'User_99: Incredible sacrifice!  •  ChessWiz: Hikaru is in trouble now.  •  Grandmaster_Fan: Wait for the engine evaluation!  •  ';

const REACTIONS = ['🔥', '⚡', '👏', '🤯', '👑'];

interface FloatingReaction {
  id: number;
  emoji: string;
  left: number;
}

export default function FrontRowScreen() {
  const insets = useSafeAreaInsets();
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  function handleReactionPress(emoji: string) {
    const id = Date.now() + Math.random();
    const left = 40 + Math.random() * 60;
    setFloatingReactions((prev) => [...prev, { id, emoji, left }]);
    console.log('Reaction sent', emoji);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 2000);
  }

  return (
    <View className="flex-1 bg-bg-base">
      <ScreenBackdrop source={ScreenArt.frontRowCrowd} opacity={0.3} topScrim={0.4} />
      <View className="flex-row items-center justify-between px-lg pb-sm" style={{ paddingTop: insets.top + 16 }}>
        <Pressable onPress={() => goUp('/front-row')} className="h-10 w-10 items-center justify-center rounded-full" style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.8), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4) }}>
          <ChevronLeft />
        </Pressable>
        <Text className="flex-1 text-center font-display-hero text-text-primary" style={{ fontSize: 16, textTransform: 'uppercase' }}>
          Front Row
        </Text>
        <LiveBadge />
      </View>

      <View className="mb-sm flex-row items-center justify-center gap-1">
        <Text style={{ fontSize: 11, color: Colors.textMuted }}>👁 2,847 watching</Text>
      </View>

      <View className="flex-row gap-sm px-lg">
        <View className="flex-1 flex-row items-center gap-sm rounded-lg p-sm" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.chrome, 0.2) }}>
          <PlayerAvatar emoji="🔥" size="small" />
          <View>
            <Text className="font-heading-md" style={{ fontSize: 12, color: Colors.chrome }}>
              GM MAGNUS_V
            </Text>
            <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.textMuted }}>
              2854 ELO
            </Text>
            <Text className="font-display-hero" style={{ fontSize: 16, color: Colors.chrome, marginTop: 2 }}>
              08:42
            </Text>
          </View>
        </View>
        <View className="flex-1 flex-row-reverse items-center gap-sm rounded-lg p-sm" style={{ backgroundColor: Colors.bgPanel, borderWidth: 1, borderColor: withOpacity(Colors.emberLight, 0.3) }}>
          <PlayerAvatar emoji="💀" size="small" />
          <View style={{ alignItems: 'flex-end' }}>
            <Text className="font-heading-md" style={{ fontSize: 12, color: Colors.emberLight }}>
              GM HIKARU_X
            </Text>
            <Text className="font-body-sm" style={{ fontSize: 11, color: Colors.textMuted }}>
              2832 ELO
            </Text>
            <Text className="font-display-hero" style={{ fontSize: 16, color: Colors.emberLight, marginTop: 2 }}>
              09:15
            </Text>
          </View>
        </View>
      </View>

      <View className="flex-1 items-center justify-center">
        <ChessBoard />
      </View>

      <View className="flex-row justify-center gap-md px-lg" style={{ paddingBottom: 16 + insets.bottom }}>
        {REACTIONS.map((emoji) => (
          <Pressable
            key={emoji}
            onPress={() => handleReactionPress(emoji)}
            className="h-12 w-12 items-center justify-center rounded-full"
            style={{ backgroundColor: withOpacity(Colors.bgPanel, 0.85), borderWidth: 1, borderColor: withOpacity(Colors.cyan, 0.3), boxShadow: `0px 0px 12px ${withOpacity(Colors.cyan, 0.2)}` }}
          >
            <Text style={{ fontSize: 22 }}>{emoji}</Text>
          </Pressable>
        ))}
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', inset: 0 }}>
        {floatingReactions.map((reaction) => (
          <FloatingEmoji key={reaction.id} emoji={reaction.emoji} left={reaction.left} />
        ))}
      </View>

      <ChatTicker />
    </View>
  );
}

function ChevronLeft() {
  return <Text style={{ fontSize: 24, color: Colors.textPrimary, marginLeft: -2 }}>‹</Text>;
}

function LiveBadge() {
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.value = withRepeat(withSequence(withTiming(0.5, { duration: 750, easing: Easing.inOut(Easing.ease) }), withTiming(1, { duration: 750 })), -1, false);
  }, [opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View className="flex-row items-center gap-1 rounded-full px-md" style={[{ paddingVertical: 6, backgroundColor: Colors.crimson }, animatedStyle]}>
      <View className="h-1.5 w-1.5 rounded-full bg-text-primary" />
      <Text className="font-section-header text-caption text-text-primary" style={{ textTransform: 'uppercase' }}>
        Live
      </Text>
    </Animated.View>
  );
}

function FloatingEmoji({ emoji, left }: { emoji: string; left: number }) {
  const translateY = useSharedValue(0);
  const scale = useSharedValue(1);
  const opacity = useSharedValue(1);

  useEffect(() => {
    translateY.value = withTiming(-200, { duration: 2000, easing: Easing.out(Easing.quad) });
    scale.value = withTiming(1.5, { duration: 2000 });
    opacity.value = withTiming(0, { duration: 2000 });
  }, [translateY, scale, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }, { scale: scale.value }],
    opacity: opacity.value,
  }));

  return <Animated.Text style={[{ position: 'absolute', bottom: 110, left, fontSize: 28 }, animatedStyle]}>{emoji}</Animated.Text>;
}

function ChatTicker() {
  const [textWidth, setTextWidth] = useState(0);
  const translateX = useSharedValue(0);

  useEffect(() => {
    if (textWidth === 0) return;
    translateX.value = 0;
    translateX.value = withRepeat(withTiming(-textWidth, { duration: 16000, easing: Easing.linear }), -1, false);
  }, [textWidth, translateX]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  return (
    <View className="justify-center" style={{ height: 40, overflow: 'hidden', backgroundColor: withOpacity(Colors.bgBase, 0.85), borderTopWidth: 1, borderTopColor: withOpacity(Colors.chromeDark, 0.3) }}>
      <Animated.Text onLayout={(e) => setTextWidth(e.nativeEvent.layout.width)} style={[{ fontSize: 12, color: Colors.textMuted, width: 2000 }, animatedStyle]} numberOfLines={1}>
        {CHAT_TICKER + CHAT_TICKER}
      </Animated.Text>
    </View>
  );
}
