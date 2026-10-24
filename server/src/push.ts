import { eq, inArray } from 'drizzle-orm';

import { db } from './db/client.js';
import { getPushPrefs, type PushCategory } from './db/pushPrefs.js';
import { isBlocked } from './db/moderation.js';
import { playerProfiles, pushDevices } from './db/schema/index.js';
import { isUserForeground } from './realtime.js';

// Push delivery through the Expo Push Service (https://docs.expo.dev/push-notifications/sending-notifications/).
// Everything here is best-effort and fire-and-forget: a failed push must never break a move, a settlement or
// a friend request, so callers `void` the promise and errors are only logged.
//
//   EXPO_PUSH_DISABLED=1   send nothing (local dev without a device)
//   EXPO_ACCESS_TOKEN      optional, for projects with "enhanced push security" turned on
//   EXPO_PUSH_URL / EXPO_PUSH_RECEIPTS_URL   overridable so tests can point at a local stub

const SEND_URL = (): string => process.env.EXPO_PUSH_URL ?? 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = (): string => process.env.EXPO_PUSH_RECEIPTS_URL ?? 'https://exp.host/--/api/v2/push/getReceipts';
const BATCH = 100;
const RECEIPT_DELAY_MS = 15 * 60_000;

// One Android notification channel per category (the app creates them with these ids at startup).
const CHANNEL: Record<PushCategory, string> = { social: 'social', invites: 'invites', results: 'results', daily: 'daily' };

export interface PushMessage {
  title: string;
  body: string;
  /** Delivered to the app on tap; carries the route kind plus whatever ids that screen needs. */
  data?: Record<string, unknown>;
  /** Seconds the push service keeps trying while the phone is unreachable. */
  ttl?: number;
}

export function pushEnabled(): boolean {
  const v = process.env.EXPO_PUSH_DISABLED;
  return !(v === '1' || v === 'true');
}

function headers(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json', 'Content-Type': 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) h.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  return h;
}

interface Ticket {
  status: 'ok' | 'error';
  id?: string;
  message?: string;
  details?: { error?: string };
}

// Tickets whose receipt has not been checked yet. In memory on purpose: losing them on a restart only means a
// dead token is cleaned up by the next send's ticket instead of by its receipt.
const pendingReceipts: { id: string; token: string; at: number }[] = [];

async function dropTokens(tokens: string[]): Promise<void> {
  if (tokens.length === 0) return;
  await db.delete(pushDevices).where(inArray(pushDevices.token, tokens));
}

/** Send one already-resolved batch of messages to specific tokens. */
export async function sendToTokens(tokens: string[], category: PushCategory, msg: PushMessage): Promise<void> {
  for (let i = 0; i < tokens.length; i += BATCH) {
    const chunk = tokens.slice(i, i + BATCH);
    const res = await fetch(SEND_URL(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(
        chunk.map((to) => ({
          to,
          title: msg.title,
          body: msg.body,
          data: { category, ...(msg.data ?? {}) },
          sound: 'default',
          priority: 'high',
          channelId: CHANNEL[category],
          ...(msg.ttl ? { ttl: msg.ttl } : {}),
        })),
      ),
    });
    if (!res.ok) {
      console.error(`push send failed: HTTP ${res.status}`);
      continue;
    }
    const json = (await res.json()) as { data?: Ticket[] };
    const tickets = json.data ?? [];
    const dead: string[] = [];
    tickets.forEach((ticket, idx) => {
      const token = chunk[idx];
      if (!token) return;
      if (ticket.status === 'ok' && ticket.id) pendingReceipts.push({ id: ticket.id, token, at: Date.now() });
      else if (ticket.details?.error === 'DeviceNotRegistered') dead.push(token);
      else if (ticket.status === 'error') console.error(`push ticket error: ${ticket.message ?? 'unknown'}`);
    });
    await dropTokens(dead);
  }
}

/**
 * Push to every device of one account, unless the category is switched off or the app is on screen.
 * Returns how many devices were addressed (0 when skipped) so callers/tests can tell.
 */
export async function pushToUser(userId: string, category: PushCategory, msg: PushMessage): Promise<number> {
  try {
    if (!pushEnabled()) return 0;
    if (isUserForeground(userId)) return 0;
    const [prefs, devices] = await Promise.all([
      getPushPrefs(userId),
      db.select({ token: pushDevices.token }).from(pushDevices).where(eq(pushDevices.userId, userId)),
    ]);
    if (!prefs[category] || devices.length === 0) return 0;
    const tokens = devices.map((d) => d.token);
    await sendToTokens(tokens, category, msg);
    return tokens.length;
  } catch (err) {
    console.error('push failed', err);
    return 0;
  }
}

/** Ask Expo how earlier tickets ended; tokens it reports as unregistered are deleted. Called from the scheduler tick. */
export async function checkPendingReceipts(now = Date.now()): Promise<void> {
  if (!pushEnabled()) return;
  const due = pendingReceipts.filter((p) => now - p.at >= RECEIPT_DELAY_MS).slice(0, 1000);
  if (due.length === 0) return;
  const ids = new Set(due.map((d) => d.id));
  for (let i = pendingReceipts.length - 1; i >= 0; i--) if (ids.has(pendingReceipts[i].id)) pendingReceipts.splice(i, 1);
  const tokenById = new Map(due.map((d) => [d.id, d.token]));
  const dead: string[] = [];
  for (let i = 0; i < due.length; i += 300) {
    const res = await fetch(RECEIPTS_URL(), {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ ids: due.slice(i, i + 300).map((d) => d.id) }),
    });
    if (!res.ok) continue;
    const json = (await res.json()) as { data?: Record<string, Ticket> };
    for (const [id, receipt] of Object.entries(json.data ?? {})) {
      if (receipt.status === 'error' && receipt.details?.error === 'DeviceNotRegistered') {
        const token = tokenById.get(id);
        if (token) dead.push(token);
      }
    }
  }
  await dropTokens(dead);
}

// Per (sender, recipient) pacing for chat pushes: a burst of messages is one buzz, not twenty.
const lastChatPush = new Map<string, number>();
export function chatPushAllowed(fromUserId: string, toUserId: string, now = Date.now(), windowMs = 30_000): boolean {
  const key = `${fromUserId}>${toUserId}`;
  const last = lastChatPush.get(key);
  if (last !== undefined && now - last < windowMs) return false;
  lastChatPush.set(key, now);
  if (lastChatPush.size > 5000) {
    for (const [k, t] of lastChatPush) if (now - t >= windowMs) lastChatPush.delete(k);
  }
  return true;
}

/** Chat push for the recipient of a direct message: sender's name + a short preview, paced per pair, never for blocked pairs. */
export async function pushDirectMessage(fromUserId: string, toUserId: string, text: string, conversationId: string): Promise<void> {
  try {
    if (!pushEnabled() || isUserForeground(toUserId)) return;
    if (!chatPushAllowed(fromUserId, toUserId)) return;
    if (await isBlocked(fromUserId, toUserId)) return;
    const [sender] = await db
      .select({ name: playerProfiles.displayName })
      .from(playerProfiles)
      .where(eq(playerProfiles.userId, fromUserId))
      .limit(1);
    const preview = text.length > 80 ? `${text.slice(0, 79)}…` : text;
    await pushToUser(toUserId, 'social', {
      title: sender?.name ?? 'New message',
      body: preview,
      data: { kind: 'dm', fromUserId, conversationId },
    });
  } catch (err) {
    console.error('chat push failed', err);
  }
}
