import { and, desc, eq, inArray, isNull, lt, ne } from 'drizzle-orm';

import { db } from './client.js';
import { areFriends, orderPair, type FriendProfile } from './friends.js';
import { conversationParticipants, conversations, messages, playerProfiles } from './schema/index.js';

// Cap on a single history page -- mirrors auth.ts's clampLimit intent.
const MAX_PAGE = 100;
const DEFAULT_PAGE = 40;
export const MAX_MESSAGE_LENGTH = 500;

export interface DirectMessage {
  id: string;
  conversationId: string;
  senderUserId: string;
  text: string;
  sentAt: Date;
  readAt: Date | null;
}

function pairKeyFor(a: string, b: string): string {
  const [lo, hi] = orderPair(a, b);
  return `${lo}:${hi}`;
}

/** The 1:1 conversation row id for a friend pair, created on first use.
 *  Returns null when the two aren't accepted friends. */
export async function getOrCreateDirectConversation(a: string, b: string): Promise<string | null> {
  if (!(await areFriends(a, b))) return null;
  const pairKey = pairKeyFor(a, b);

  const [existing] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.pairKey, pairKey))
    .limit(1);
  if (existing) return existing.id;

  return db.transaction(async (tx) => {
    // Re-check inside the txn: a concurrent first message from the other side
    // could have created it between the SELECT above and here.
    const [row] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.pairKey, pairKey))
      .limit(1);
    if (row) return row.id;

    const [created] = await tx.insert(conversations).values({ pairKey }).returning({ id: conversations.id });
    await tx.insert(conversationParticipants).values([
      { conversationId: created.id, userId: a },
      { conversationId: created.id, userId: b },
    ]);
    return created.id;
  });
}

export type SendMessageResult =
  | { status: 'ok'; message: DirectMessage }
  | { status: 'not-friends' }
  | { status: 'empty' };

export async function persistMessage(me: string, otherUserId: string, rawText: string): Promise<SendMessageResult> {
  const text = rawText.trim().slice(0, MAX_MESSAGE_LENGTH);
  if (!text) return { status: 'empty' };

  const conversationId = await getOrCreateDirectConversation(me, otherUserId);
  if (!conversationId) return { status: 'not-friends' };

  const [row] = await db
    .insert(messages)
    .values({ conversationId, senderUserId: me, text })
    .returning();
  return { status: 'ok', message: row };
}

export type MessagesResult =
  | { status: 'ok'; messages: DirectMessage[] }
  | { status: 'not-friends' };

export async function getMessages(
  me: string,
  otherUserId: string,
  opts: { limit?: number; before?: string },
): Promise<MessagesResult> {
  if (!(await areFriends(me, otherUserId))) return { status: 'not-friends' };

  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.pairKey, pairKeyFor(me, otherUserId)))
    .limit(1);
  if (!conversation) return { status: 'ok', messages: [] };

  const limit = Number.isFinite(opts.limit) && (opts.limit ?? 0) > 0 ? Math.min(Math.floor(opts.limit!), MAX_PAGE) : DEFAULT_PAGE;
  const before = opts.before ? new Date(opts.before) : null;

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        before && !Number.isNaN(before.getTime()) ? lt(messages.sentAt, before) : undefined,
      ),
    )
    .orderBy(desc(messages.sentAt))
    .limit(limit);

  // Fetched newest-first for the limit/cursor; hand back oldest-first for render.
  return { status: 'ok', messages: rows.reverse() };
}

export async function markRead(me: string, otherUserId: string): Promise<{ status: 'ok' }> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.pairKey, pairKeyFor(me, otherUserId)))
    .limit(1);
  if (!conversation) return { status: 'ok' };

  await db
    .update(messages)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(messages.conversationId, conversation.id),
        ne(messages.senderUserId, me),
        isNull(messages.readAt),
      ),
    );
  return { status: 'ok' };
}

export interface ConversationSummary {
  user: FriendProfile;
  lastMessage: { text: string; sentAt: Date; mine: boolean };
  unreadCount: number;
}

/** Every friend `me` has exchanged at least one message with, newest thread
 *  first, with the last message and this-user's unread count. */
export async function listConversations(me: string): Promise<ConversationSummary[]> {
  const myParts = await db
    .select({ conversationId: conversationParticipants.conversationId })
    .from(conversationParticipants)
    .where(eq(conversationParticipants.userId, me));
  const convIds = myParts.map((p) => p.conversationId);
  if (convIds.length === 0) return [];

  const otherParts = await db
    .select({ conversationId: conversationParticipants.conversationId, userId: conversationParticipants.userId })
    .from(conversationParticipants)
    .where(and(inArray(conversationParticipants.conversationId, convIds), ne(conversationParticipants.userId, me)));
  const otherUserByConv = new Map(otherParts.map((p) => [p.conversationId, p.userId]));

  const allMsgs = await db
    .select()
    .from(messages)
    .where(inArray(messages.conversationId, convIds))
    .orderBy(desc(messages.sentAt));

  const lastByConv = new Map<string, DirectMessage>();
  const unreadByConv = new Map<string, number>();
  for (const msg of allMsgs) {
    if (!lastByConv.has(msg.conversationId)) lastByConv.set(msg.conversationId, msg);
    if (msg.senderUserId !== me && msg.readAt === null) {
      unreadByConv.set(msg.conversationId, (unreadByConv.get(msg.conversationId) ?? 0) + 1);
    }
  }

  const otherIds = [...new Set([...otherUserByConv.values()])];
  const profileRows = otherIds.length
    ? await db
        .select({
          userId: playerProfiles.userId,
          displayName: playerProfiles.displayName,
          avatarId: playerProfiles.avatarId,
          rating: playerProfiles.rating,
          level: playerProfiles.level,
        })
        .from(playerProfiles)
        .where(inArray(playerProfiles.userId, otherIds))
    : [];
  const profileById = new Map(profileRows.map((p) => [p.userId, p]));

  return convIds
    .map((convId) => {
      const last = lastByConv.get(convId);
      const otherId = otherUserByConv.get(convId);
      const profile = otherId ? profileById.get(otherId) : undefined;
      if (!last || !profile) return null;
      return {
        user: profile,
        lastMessage: { text: last.text, sentAt: last.sentAt, mine: last.senderUserId === me },
        unreadCount: unreadByConv.get(convId) ?? 0,
      };
    })
    .filter((c): c is ConversationSummary => c !== null)
    .sort((a, b) => b.lastMessage.sentAt.getTime() - a.lastMessage.sentAt.getTime());
}
