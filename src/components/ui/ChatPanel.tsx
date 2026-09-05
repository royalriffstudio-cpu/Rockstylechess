import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useEffect, useRef, useState } from 'react';
import {
  Dimensions,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { ChatMessageWithId } from '@/hooks/useMatchChat';
import { Colors, Fonts, Radius, Spacing, withOpacity } from '@/constants/theme';
import { RockCard } from './RockCard';

const SHEET_HEIGHT = Dimensions.get('window').height * 0.58;
// RockCard's own content padding (Spacing.lg on every side) is a shared,
// widely-reused component we don't want to touch just for this panel's
// layout -- an explicit inner height here, rather than a flex:1 chain
// through RockCard, sidesteps any native-vs-web Yoga differences in how
// flex:1 resolves inside an otherwise auto-height parent.
const SHEET_INNER_HEIGHT = SHEET_HEIGHT - Spacing.lg * 2;
const MAX_MESSAGE_LENGTH = 200;

interface ChatPanelProps {
  visible: boolean;
  onClose: () => void;
  messages: ChatMessageWithId[];
  myColor: 'w' | 'b';
  onSend: (text: string) => void;
  canSend: boolean;
}

function formatTime(sentAt: number): string {
  const date = new Date(sentAt);
  const hours = date.getHours().toString().padStart(2, '0');
  const minutes = date.getMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
}

// The slide-up in-match chat panel. Stays mounted while hidden (visible=false
// just fades it out and disables its touches) so the close animation can play
// and the message list in useMatchChat isn't lost/remounted.
export function ChatPanel({ visible, onClose, messages, myColor, onSend, canSend }: ChatPanelProps) {
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);
  const translateY = useSharedValue(SHEET_HEIGHT);
  const backdropOpacity = useSharedValue(0);

  useEffect(() => {
    const timingConfig = { duration: 260, easing: Easing.out(Easing.cubic) };
    translateY.value = withTiming(visible ? 0 : SHEET_HEIGHT, timingConfig);
    backdropOpacity.value = withTiming(visible ? 1 : 0, timingConfig);
  }, [visible, translateY, backdropOpacity]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const sheetStyle = useAnimatedStyle(() => ({ transform: [{ translateY: translateY.value }] }));

  function handleSend() {
    if (!draft.trim() || !canSend) return;
    onSend(draft);
    setDraft('');
  }

  return (
    <View style={StyleSheet.absoluteFillObject} pointerEvents={visible ? 'auto' : 'none'}>
      <Animated.View style={[styles.backdrop, backdropStyle]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>

      <Animated.View style={[styles.sheetWrap, sheetStyle]}>
        <RockCard glowColor={Colors.cyan}>
          <KeyboardAvoidingView
            style={styles.sheetInner}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.header}>
              <Text style={styles.headerTitle}>Match Chat</Text>
              <Pressable onPress={onClose} style={styles.closeButton}>
                <MaterialCommunityIcons name="chevron-down" size={24} color={Colors.textPrimary} />
              </Pressable>
            </View>

            <ScrollView
              ref={scrollRef}
              style={styles.flex}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            >
              {messages.length === 0 ? (
                <Text style={styles.emptyText}>No messages yet — say hello!</Text>
              ) : (
                messages.map((message) => {
                  const isMine = message.color === myColor;
                  const accent = isMine ? Colors.cyan : Colors.crimson;
                  return (
                    <View key={message.id} style={[styles.bubbleWrap, isMine ? styles.bubbleWrapMe : styles.bubbleWrapThem]}>
                      <Text style={[styles.bubbleSender, { color: accent, textAlign: isMine ? 'right' : 'left' }]}>
                        {isMine ? 'You' : message.displayName} · {formatTime(message.sentAt)}
                      </Text>
                      <View
                        style={[
                          styles.bubble,
                          {
                            backgroundColor: withOpacity(accent, 0.16),
                            borderColor: withOpacity(accent, 0.4),
                          },
                          isMine ? styles.bubbleMe : styles.bubbleThem,
                        ]}
                      >
                        <Text style={styles.bubbleText}>{message.text}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View style={[styles.composerRow, { paddingBottom: Spacing.md + insets.bottom }]}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="Say something..."
                placeholderTextColor={Colors.textMuted}
                maxLength={MAX_MESSAGE_LENGTH}
                style={styles.composerInput}
                editable={canSend}
              />
              <Pressable
                style={[styles.sendButton, (!canSend || !draft.trim()) && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={!canSend || !draft.trim()}
              >
                <MaterialCommunityIcons name="send" size={18} color={Colors.bgBase} />
              </Pressable>
            </View>
          </KeyboardAvoidingView>
        </RockCard>
      </Animated.View>
    </View>
  );
}

// #region Styles
const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: withOpacity(Colors.bgBase, 0.55),
  },
  sheetWrap: {
    position: 'absolute',
    left: Spacing.md,
    right: Spacing.md,
    bottom: Spacing.md,
    height: SHEET_HEIGHT,
  },
  sheetInner: {
    height: SHEET_INNER_HEIGHT,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: Spacing.md,
    marginBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: withOpacity(Colors.chromeDark, 0.3),
  },
  headerTitle: {
    fontFamily: Fonts.display,
    fontSize: 14,
    color: Colors.textPrimary,
    textTransform: 'uppercase',
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
  },
  scrollContent: {
    gap: Spacing.md,
    paddingBottom: Spacing.sm,
  },
  emptyText: {
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.xl,
  },
  bubbleWrap: {
    maxWidth: '85%',
    gap: 4,
  },
  bubbleWrapThem: {
    alignSelf: 'flex-start',
  },
  bubbleWrapMe: {
    alignSelf: 'flex-end',
  },
  bubbleSender: {
    fontFamily: Fonts.heading,
    fontSize: 10,
    textTransform: 'uppercase',
    paddingHorizontal: Spacing.sm,
  },
  bubble: {
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
  },
  bubbleThem: {
    borderTopLeftRadius: 4,
  },
  bubbleMe: {
    borderTopRightRadius: 4,
  },
  bubbleText: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textPrimary,
    lineHeight: 20,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingTop: Spacing.md,
  },
  composerInput: {
    flex: 1,
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: withOpacity(Colors.bgBase, 0.6),
    borderWidth: 1,
    borderColor: withOpacity(Colors.chromeDark, 0.4),
    fontFamily: Fonts.body,
    fontSize: 13,
    color: Colors.textPrimary,
  },
  sendButton: {
    width: 44,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.cyan,
    boxShadow: `0px 0px 14px ${withOpacity(Colors.cyan, 0.4)}`,
  },
  sendButtonDisabled: {
    opacity: 0.4,
    boxShadow: 'none',
  },
});
// #endregion
