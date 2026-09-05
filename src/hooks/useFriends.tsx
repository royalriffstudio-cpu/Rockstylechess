import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import {
  acceptFriendRequest,
  declineFriendRequest,
  getConversations,
  getFriendRequests,
  getFriends,
  lookupFriendCode,
  markConversationRead as markConversationReadApi,
  removeFriend,
  sendFriendRequest,
  type ConversationSummary,
  type Friend,
  type FriendCodeLookup,
  type FriendRequestUser,
} from '@/lib/api';
import { getAuthToken } from '@/lib/authStorage';
import type {
  DirectMessagePayload,
  FriendPresencePayload,
  FriendRemovedPayload,
} from '@/lib/friendsSocket';
import { usePlayerProfile } from '@/hooks/usePlayerProfile';
import { getSocket } from '@/lib/socket';

export type FriendsStatus = 'loading' | 'ready' | 'guest' | 'error';
export type FriendPresence = 'online' | 'in-game' | 'offline';

interface FriendsContextValue {
  status: FriendsStatus;
  friends: Friend[];
  incoming: FriendRequestUser[];
  outgoing: FriendRequestUser[];
  conversations: ConversationSummary[];
  pendingCount: number;
  unreadTotal: number;
  isFriend: (userId: string) => boolean;
  hasOutgoingTo: (userId: string) => boolean;
  presenceOf: (userId: string) => FriendPresence;
  refresh: () => Promise<void>;
  lookup: (code: string) => Promise<FriendCodeLookup | null>;
  addFriend: (target: { friendCode: string } | { userId: string }) => Promise<{ accepted: boolean }>;
  acceptRequest: (userId: string) => Promise<void>;
  declineRequest: (userId: string) => Promise<void>;
  unfriend: (userId: string) => Promise<void>;
  markConversationRead: (userId: string) => Promise<void>;
}

const FriendsContext = createContext<FriendsContextValue | null>(null);

// Mounted once at the app root, inside PlayerProfileProvider (it reads the
// signed-in userId from there). The single place the friend/DM socket events
// are listened to -- every (social) screen reads derived state from here
// rather than each opening its own socket listener.
export function FriendsProvider({ children }: { children: ReactNode }) {
  const { profile } = usePlayerProfile();
  const myUserId = profile?.userId ?? null;

  const [status, setStatus] = useState<FriendsStatus>('loading');
  const [friends, setFriends] = useState<Friend[]>([]);
  const [incoming, setIncoming] = useState<FriendRequestUser[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequestUser[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  // Live presence deltas from `friend:presence`, layered over the REST snapshot.
  const [presence, setPresence] = useState<Record<string, 'online' | 'offline'>>({});

  // Kept in a ref so the socket handlers (bound once) always see the current id.
  const myUserIdRef = useRef<string | null>(myUserId);
  myUserIdRef.current = myUserId;

  const refreshConversations = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) return;
    try {
      const { conversations: next } = await getConversations(token);
      setConversations(next);
    } catch (error) {
      console.log('Failed to refresh conversations', error);
    }
  }, []);

  const refresh = useCallback(async () => {
    const token = await getAuthToken();
    if (!token) {
      setStatus('guest');
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setConversations([]);
      setPresence({});
      return;
    }
    try {
      const [friendsRes, requestsRes, conversationsRes] = await Promise.all([
        getFriends(token),
        getFriendRequests(token),
        getConversations(token),
      ]);
      setFriends(friendsRes.friends);
      setIncoming(requestsRes.incoming);
      setOutgoing(requestsRes.outgoing);
      setConversations(conversationsRes.conversations);
      setPresence({});
      setStatus('ready');
    } catch (error) {
      console.log('Failed to load friends', error);
      setStatus('error');
    }
  }, []);

  // (Re)load whenever the signed-in identity changes (login / logout / initial).
  useEffect(() => {
    if (!myUserId) {
      setStatus('guest');
      setFriends([]);
      setIncoming([]);
      setOutgoing([]);
      setConversations([]);
      setPresence({});
      return;
    }
    setStatus('loading');
    void refresh();
  }, [myUserId, refresh]);

  // Socket listeners -- bound once, active only meaningfully while signed in
  // (the server never emits these to a guest socket).
  useEffect(() => {
    const socket = getSocket();

    const onPresence = (p: FriendPresencePayload) => {
      setPresence((prev) => ({ ...prev, [p.userId]: p.status }));
    };
    const onRequestChanged = () => {
      void refresh();
    };
    const onRemoved = (_p: FriendRemovedPayload) => {
      void refresh();
    };
    const onDm = (p: DirectMessagePayload) => {
      const mine = p.fromUserId === myUserIdRef.current;
      const otherId = mine ? p.toUserId : p.fromUserId;
      setConversations((prev) => {
        const idx = prev.findIndex((c) => c.userId === otherId);
        if (idx === -1) {
          // First message in a thread we don't have summarised yet.
          void refreshConversations();
          return prev;
        }
        const updated: ConversationSummary = {
          ...prev[idx],
          lastMessage: { text: p.text, sentAt: new Date(p.sentAt).toISOString(), mine },
          unreadCount: mine ? prev[idx].unreadCount : prev[idx].unreadCount + 1,
        };
        return [updated, ...prev.slice(0, idx), ...prev.slice(idx + 1)];
      });
    };

    socket.on('friend:presence', onPresence);
    socket.on('friend:request', onRequestChanged);
    socket.on('friend:request:accepted', onRequestChanged);
    socket.on('friend:request:withdrawn', onRequestChanged);
    socket.on('friend:removed', onRemoved);
    socket.on('dm:message', onDm);

    return () => {
      socket.off('friend:presence', onPresence);
      socket.off('friend:request', onRequestChanged);
      socket.off('friend:request:accepted', onRequestChanged);
      socket.off('friend:request:withdrawn', onRequestChanged);
      socket.off('friend:removed', onRemoved);
      socket.off('dm:message', onDm);
    };
  }, [refresh, refreshConversations]);

  const withToken = useCallback(async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
    const token = await getAuthToken();
    if (!token) throw new Error('not-signed-in');
    return fn(token);
  }, []);

  const lookup = useCallback(
    (code: string) => withToken(async (token) => (await lookupFriendCode(token, code)).user),
    [withToken],
  );

  const addFriend = useCallback(
    (target: { friendCode: string } | { userId: string }) =>
      withToken(async (token) => {
        const res = await sendFriendRequest(token, target);
        await refresh();
        return { accepted: res.accepted };
      }),
    [withToken, refresh],
  );

  const acceptRequest = useCallback(
    (userId: string) =>
      withToken(async (token) => {
        await acceptFriendRequest(token, userId);
        await refresh();
      }),
    [withToken, refresh],
  );

  const declineRequest = useCallback(
    (userId: string) =>
      withToken(async (token) => {
        await declineFriendRequest(token, userId);
        await refresh();
      }),
    [withToken, refresh],
  );

  const unfriend = useCallback(
    (userId: string) =>
      withToken(async (token) => {
        await removeFriend(token, userId);
        await refresh();
      }),
    [withToken, refresh],
  );

  const markConversationRead = useCallback(
    (userId: string) =>
      withToken(async (token) => {
        setConversations((prev) =>
          prev.map((c) => (c.userId === userId ? { ...c, unreadCount: 0 } : c)),
        );
        await markConversationReadApi(token, userId);
      }),
    [withToken],
  );

  const friendIds = useMemo(() => new Set(friends.map((f) => f.userId)), [friends]);
  const outgoingIds = useMemo(() => new Set(outgoing.map((o) => o.userId)), [outgoing]);

  const mergedFriends = useMemo(
    () =>
      friends.map((f) => {
        const live = presence[f.userId];
        return live ? { ...f, online: live === 'online' } : f;
      }),
    [friends, presence],
  );

  const value = useMemo<FriendsContextValue>(
    () => ({
      status,
      friends: mergedFriends,
      incoming,
      outgoing,
      conversations,
      pendingCount: incoming.length,
      unreadTotal: conversations.reduce((sum, c) => sum + c.unreadCount, 0),
      isFriend: (userId: string) => friendIds.has(userId),
      hasOutgoingTo: (userId: string) => outgoingIds.has(userId),
      presenceOf: (userId: string) => {
        const friend = mergedFriends.find((f) => f.userId === userId);
        if (!friend) return presence[userId] === 'online' ? 'online' : 'offline';
        if (friend.inGame && friend.online) return 'in-game';
        return friend.online ? 'online' : 'offline';
      },
      refresh,
      lookup,
      addFriend,
      acceptRequest,
      declineRequest,
      unfriend,
      markConversationRead,
    }),
    [
      status,
      mergedFriends,
      incoming,
      outgoing,
      conversations,
      friendIds,
      outgoingIds,
      presence,
      refresh,
      lookup,
      addFriend,
      acceptRequest,
      declineRequest,
      unfriend,
      markConversationRead,
    ],
  );

  return <FriendsContext.Provider value={value}>{children}</FriendsContext.Provider>;
}

export function useFriends(): FriendsContextValue {
  const context = useContext(FriendsContext);
  if (!context) throw new Error('useFriends must be used within a FriendsProvider');
  return context;
}
