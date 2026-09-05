import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SubPageHeader } from '@/components/layout';
import { AppIcon, CurrencyPill, PlayerAvatar, RockButton, ScreenBackdrop, SectionLabel } from '@/components/ui';
import { getAvatarImage } from '@/constants/avatars';
import { ScreenArt } from '@/constants/screenArt';
import { Colors, withOpacity } from '@/constants/theme';
import { useFriends } from '@/hooks/useFriends';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getConversationMessages, type ConversationSummary } from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import { goUp } from '@/lib/navigation';
import type { DirectMessagePayload } from '@/lib/friendsSocket';
import { sendDirectMessage } from '@/lib/friendsSocket';
import { getSocket } from '@/lib/socket';

interface ThreadMessage {
  id: string;
  senderUserId: string;
  text: string;
  sentAt: string;
  mine: boolean;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function MessagesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { gems, profile } = usePlayerProfile();
  const friends = useFriends();
  const { userId: userIdParam } = useLocalSearchParams<{ userId?: string }>();

  const myUserId = profile?.userId ?? null;
  const [openUserId, setOpenUserId] = useState<string | null>(userIdParam ?? null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<ScrollView>(null);

  // The friend on the other end of the open thread. Falls back to a
  // conversation summary if they aren't in the friends list yet (shouldn't
  // happen -- DMs are friends-only -- but keeps the header from going blank).
  const openPartner = useMemo(() => {
    if (!openUserId) return null;
    const friend = friends.friends.find((f) => f.userId === openUserId);
    if (friend) return { displayName: friend.displayName, avatarId: friend.avatarId };
    const convo = friends.conversations.find((c) => c.userId === openUserId);
    return convo ? { displayName: convo.displayName, avatarId: convo.avatarId } : { displayName: null, avatarId: null };
  }, [openUserId, friends.friends, friends.conversations]);

  const loadThread = useCallback(async (partnerId: string) => {
    const token = await getAuthToken();
    if (!token) return;
    setLoadingThread(true);
    try {
      const { messages: history } = await getConversationMessages(token, partnerId, { limit: 50 });
      setMessages(
        history.map((m) => ({ id: m.id, senderUserId: m.senderUserId, text: m.text, sentAt: m.sentAt, mine: m.mine })),
      );
    } catch (error) {
      console.log('Failed to load thread', error);
      setMessages([]);
    } finally {
      setLoadingThread(false);
    }
  }, []);

  // Open the thread: load history + mark read.
  useEffect(() => {
    if (!openUserId) {
      setMessages([]);
      return;
    }
    void loadThread(openUserId);
    void friends.markConversationRead(openUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUserId, loadThread]);

  // Live messages for whichever thread is open.
  useEffect(() => {
    if (!openUserId) return;
    const socket = getSocket();
    const onDm = (p: DirectMessagePayload) => {
      const otherId = p.fromUserId === myUserId ? p.toUserId : p.fromUserId;
      if (otherId !== openUserId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === p.id)) return prev;
        return [
          ...prev,
          {
            id: p.id,
            senderUserId: p.fromUserId,
            text: p.text,
            sentAt: new Date(p.sentAt).toISOString(),
            mine: p.fromUserId === myUserId,
          },
        ];
      });
      if (p.fromUserId !== myUserId) void friends.markConversationRead(openUserId);
    };
    socket.on('dm:message', onDm);
    return () => {
      socket.off('dm:message', onDm);
    };
  }, [openUserId, myUserId, friends]);

  useEffect(() => {
    if (messages.length) requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  function handleSend() {
    const text = draft.trim();
    if (!text || !openUserId) return;
    void sendDirectMessage(openUserId, text);
    setDraft('');
  }

  function handleBack() {
    if (openUserId) {
      setOpenUserId(null);
      setDraft('');
      // Drop the deep-link param so re-opening the list screen doesn't jump
      // straight back into the thread.
      router.setParams({ userId: '' });
    } else {
      goUp('/messages');
    }
  }

  // Android hardware back closes an open thread first (the thread is internal
  // state, not a route) -- otherwise the global handler in _layout.tsx would
  // jump straight up to /iron-id.
  useEffect(() => {
    if (!openUserId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenUserId(null);
      setDraft('');
      router.setParams({ userId: '' });
      return true;
    });
    return () => sub.remove();
  }, [openUserId, router]);

  if (friends.status === 'guest') {
    return (
      <View className="flex-1 bg-bg-base">
        <SubPageHeader title="Messages" />
        <View className="flex-1 items-center justify-center gap-md px-xl">
          <AppIcon name="chat" size={40} color={Colors.textMuted} />
          <Text className="text-center font-body-base text-body-base text-text-muted">
            Sign in to message your friends between games.
          </Text>
          <RockButton label="Sign In" variant="primary" onPress={() => router.push('/sign-in')} />
        </View>
      </View>
    );
  }

  if (openUserId) {
    return (
      <View className="flex-1 bg-bg-base">
        <ScreenBackdrop source={ScreenArt.messagesLounge} opacity={0.18} />
        <SubPageHeader title={openPartner?.displayName ?? 'Message'} onBack={handleBack} />

        {loadingThread && messages.length === 0 ? (
          <ActivityIndicator color={Colors.cyan} style={{ marginTop: 40 }} />
        ) : (
          <ScrollView ref={scrollRef} contentContainerClassName="gap-md px-lg py-lg" showsVerticalScrollIndicator={false}>
            {messages.length === 0 ? (
              <Text className="mt-xl text-center font-body-sm text-text-muted" style={{ fontSize: 12 }}>
                No messages yet. Say something.
              </Text>
            ) : (
              messages.map((message) => (
                <View
                  key={message.id}
                  className={message.mine ? 'items-end self-end' : 'items-start'}
                  style={{ maxWidth: '85%' }}
                >
                  <View
                    className="rounded-lg p-md"
                    style={
                      message.mine
                        ? { backgroundColor: withOpacity(Colors.emberLight, 0.16), borderWidth: 1, borderColor: withOpacity(Colors.emberLight, 0.4), borderTopRightRadius: 4 }
                        : { backgroundColor: withOpacity(Colors.bgPanel, 0.85), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.3), borderTopLeftRadius: 4 }
                    }
                  >
                    <Text className="font-body-base text-text-primary" style={{ fontSize: 14, lineHeight: 20 }}>
                      {message.text}
                    </Text>
                  </View>
                  <Text className="mt-0.5 font-body-sm" style={{ fontSize: 9, color: Colors.textMuted, paddingHorizontal: 6 }}>
                    {relativeTime(message.sentAt)}
                  </Text>
                </View>
              ))
            )}
          </ScrollView>
        )}

        <View
          className="flex-row items-center gap-sm p-md"
          style={{ paddingBottom: 12 + insets.bottom, borderTopWidth: 1, borderTopColor: withOpacity(Colors.chromeDark, 0.3), backgroundColor: withOpacity(Colors.bgPanel, 0.9) }}
        >
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message…"
            placeholderTextColor={Colors.textMuted}
            className="flex-1 rounded-md px-md font-body-base text-text-primary"
            style={{ height: 44, backgroundColor: withOpacity(Colors.bgBase, 0.6), borderWidth: 1, borderColor: withOpacity(Colors.chromeDark, 0.4), fontSize: 13 }}
            onSubmitEditing={handleSend}
            returnKeyType="send"
            maxLength={200}
          />
          <Pressable
            className="h-11 w-11 items-center justify-center rounded-md"
            style={{ backgroundColor: Colors.cyan, opacity: draft.trim() ? 1 : 0.5 }}
            onPress={handleSend}
            disabled={!draft.trim()}
          >
            <AppIcon name="send" size={18} color={Colors.bgBase} />
          </Pressable>
        </View>
      </View>
    );
  }

  const conversations: ConversationSummary[] = friends.conversations;

  return (
    <View className="flex-1 bg-bg-base">
      <SubPageHeader title="Messages" trailing={<CurrencyPill type="gems" value={gems} />} />

      <ScrollView
        contentContainerClassName="gap-md px-lg py-xl"
        contentContainerStyle={{ paddingBottom: 60 + insets.bottom }}
        showsVerticalScrollIndicator={false}
      >
        <SectionLabel label="Conversations" />
        {friends.status === 'loading' && conversations.length === 0 ? (
          <ActivityIndicator color={Colors.cyan} style={{ marginTop: 24 }} />
        ) : conversations.length === 0 ? (
          <Text className="font-body-sm text-text-muted" style={{ fontSize: 12 }}>
            No conversations yet. Start one from a friend&apos;s row on the Friends screen.
          </Text>
        ) : (
          <View className="gap-sm">
            {conversations.map((c) => (
              <Pressable
                key={c.userId}
                className="flex-row items-center gap-md overflow-hidden rounded-lg p-md"
                style={{
                  backgroundColor: withOpacity(Colors.bgPanel, c.unreadCount > 0 ? 0.85 : 0.6),
                  borderWidth: 1,
                  borderColor: withOpacity(Colors.chromeDark, 0.2),
                }}
                onPress={() => setOpenUserId(c.userId)}
              >
                {c.unreadCount > 0 ? (
                  <View className="absolute bottom-0 left-0 top-0" style={{ width: 4, backgroundColor: Colors.emberLight }} />
                ) : null}
                <View style={{ position: 'relative' }}>
                  <PlayerAvatar source={getAvatarImage(c.avatarId)} size="small" />
                  {c.online ? (
                    <View
                      style={{ position: 'absolute', bottom: -1, right: -1, width: 11, height: 11, borderRadius: 6, borderWidth: 2, borderColor: Colors.bgBase, backgroundColor: Colors.cyan }}
                    />
                  ) : null}
                </View>
                <View className="flex-1">
                  <View className="flex-row items-baseline justify-between">
                    <Text
                      className="font-heading-md uppercase"
                      style={{ fontSize: 14, color: c.unreadCount > 0 ? Colors.textPrimary : Colors.textMuted }}
                      numberOfLines={1}
                    >
                      {c.displayName ?? 'Anonymous'}
                    </Text>
                    <Text className="font-body-sm" style={{ fontSize: 10, color: Colors.textMuted }}>
                      {relativeTime(c.lastMessage.sentAt)}
                    </Text>
                  </View>
                  <Text className="mt-0.5 font-body-sm italic text-text-muted" numberOfLines={1} style={{ fontSize: 12 }}>
                    {c.lastMessage.mine ? 'You: ' : ''}
                    {c.lastMessage.text}
                  </Text>
                </View>
                {c.unreadCount > 0 ? (
                  <View
                    className="items-center justify-center rounded-full px-1.5"
                    style={{ minWidth: 18, height: 18, backgroundColor: Colors.emberLight }}
                  >
                    <Text className="font-section-header" style={{ fontSize: 10, color: Colors.bgBase }}>
                      {c.unreadCount}
                    </Text>
                  </View>
                ) : null}
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}
