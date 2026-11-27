/// <reference lib="webworker" />
/**
 * nostr.buzz service worker.
 *
 * Receives Web Push messages from the push server (an encrypted gift wrap, or a pointer to
 * one), decrypts them on the device and shows a WhatsApp-style notification. Nothing readable
 * ever leaves the device.
 */
import { type NostrEvent, NSecSigner } from '@nostrify/nostrify';
import { nip04, verifyEvent } from 'nostr-tools';

import {
  conversationIdFromParticipants,
  conversationRoute,
  getParticipants,
  isBuzz,
  MAX_GROUP_PARTICIPANTS,
  messagePreview,
} from '@/lib/dm/conversation';
import { unwrapGiftWrap } from '@/lib/dm/nip17';
import { DM_KIND, type Rumor } from '@/lib/dm/types';
import { shortNpub } from '@/lib/format';
import { fromHex, isGroupJoin } from '@/lib/groups/groups';
import { base64UrlToBytes, pushGet, type PushPayload, pushSet, type PushState, type WorkerMessage } from '@/lib/push/store';
import { normalizeRelayUrl, sanitizeUrl } from '@/lib/sanitize';

declare const self: ServiceWorkerGlobalScope;

const ICON = '/icons/icon-192.png';
const HEX64 = /^[0-9a-f]{64}$/;
/** Pushes can be delayed while a phone sleeps; older messages are not news any more. */
const MAX_AGE_SECONDS = 30 * 60;
const BUZZ_VIBRATION = [120, 60, 120, 60, 120, 60, 300];
const QUIET_TAG = 'nostr-buzz-quiet';

/** Notification options browsers support but TypeScript's DOM lib doesn't list. */
interface RichNotificationOptions extends NotificationOptions {
  renotify?: boolean;
  vibrate?: number[];
  timestamp?: number;
}

interface NotificationData {
  url: string;
  lines: string[];
}

/** What to show for one push. `undefined` means "nothing". */
interface Alert {
  tag: string;
  title: string;
  line: string;
  url: string;
  icon?: string;
  buzz?: boolean;
  at?: number;
}

/**
 * WebKit (Safari, every iOS browser) revokes a push subscription after a few pushes that
 * show nothing. Other browsers allow silent pushes within a budget.
 */
const mustAlwaysShow = /AppleWebKit/.test(self.navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(self.navigator.userAgent);

self.addEventListener('install', () => {
  void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  event.waitUntil(
    onPush(event).catch(async (error: unknown) => {
      console.debug('Push handling failed', error);
      await quiet();
    }),
  );
});

async function onPush(event: PushEvent): Promise<void> {
  let payload: PushPayload | undefined;
  try {
    payload = event.data?.json() as PushPayload | undefined;
  } catch {
    payload = undefined;
  }
  if (!payload || typeof payload !== 'object') return quiet();

  if (payload.t === 't') {
    await self.registration.showNotification('Notifications work 🐝', {
      body: 'You will get messages here, even with the app closed.',
      icon: ICON,
      tag: 'nostr-buzz-test',
      data: { url: '/settings', lines: [] } satisfies NotificationData,
    });
    return;
  }

  const state = await pushGet('state');
  if (!state?.enabled) return quiet();

  // An open, visible window already shows the message and plays its sound.
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  if (windows.some((client) => client.visibilityState === 'visible')) return quiet();

  const nostrEvent = payload.t === 'e' ? parseEvent(payload.e) : payload.t === 'r' ? await fetchEvent(payload.id, payload.r) : undefined;
  if (!nostrEvent || !verifyEvent(nostrEvent)) return quiet();

  const alert = await buildAlert(nostrEvent, state);
  if (!alert) return quiet();
  await showAlert(alert);
}

/* --------------------------------- decoding -------------------------------- */

function parseEvent(value: unknown): NostrEvent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const event = value as Partial<NostrEvent>;
  if (
    typeof event.id !== 'string' ||
    typeof event.pubkey !== 'string' ||
    typeof event.sig !== 'string' ||
    typeof event.content !== 'string' ||
    typeof event.kind !== 'number' ||
    typeof event.created_at !== 'number' ||
    !Array.isArray(event.tags) ||
    !event.tags.every((tag) => Array.isArray(tag) && tag.every((item) => typeof item === 'string'))
  ) {
    return undefined;
  }
  return event as NostrEvent;
}

/** Events too big for a push payload are fetched from the relay that had them. */
function fetchEvent(id: string, relays: string[]): Promise<NostrEvent | undefined> {
  const url = Array.isArray(relays) ? relays.map((relay) => normalizeRelayUrl(String(relay))).find((relay) => relay?.startsWith('wss://')) : undefined;
  if (!url || !HEX64.test(id)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let socket: WebSocket | undefined;
    const finish = (event?: NostrEvent) => {
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // Already closed.
      }
      resolve(event);
    };
    const timer = setTimeout(() => finish(), 8000);
    try {
      socket = new WebSocket(url);
      socket.onopen = () => socket?.send(JSON.stringify(['REQ', 'push', { ids: [id], limit: 1 }]));
      socket.onerror = () => finish();
      socket.onclose = () => finish();
      socket.onmessage = (message) => {
        try {
          const data: unknown = JSON.parse(String(message.data));
          if (!Array.isArray(data)) return;
          if (data[0] === 'EOSE') finish();
          if (data[0] !== 'EVENT') return;
          const event = parseEvent(data[2]);
          if (event?.id === id) finish(event);
        } catch {
          finish();
        }
      };
    } catch {
      finish();
    }
  });
}

const nowSeconds = () => Math.floor(Date.now() / 1000);

function nameOf(state: PushState, pubkey: string): string {
  return state.names[pubkey]?.name || shortNpub(pubkey);
}

function pictureOf(state: PushState, key: string): string | undefined {
  return sanitizeUrl(state.names[key]?.picture);
}

async function buildAlert(event: NostrEvent, state: PushState): Promise<Alert | undefined> {
  const targets = event.tags.filter(([name]) => name === 'p').map(([, value]) => value);

  if (event.kind === DM_KIND.legacy) {
    if (!targets.includes(state.me) || event.pubkey === state.me) return undefined;
    if (nowSeconds() - event.created_at > MAX_AGE_SECONDS) return undefined;
    if (state.muted.includes(event.pubkey) || !state.known.includes(event.pubkey)) return undefined;
    if (!state.secret) return genericAlert();
    const text = state.previews
      ? messagePreview({ kind: DM_KIND.legacy, tags: event.tags, content: await nip04.decrypt(state.secret, event.pubkey, event.content) })
      : 'New message';
    if (!text) return undefined;
    return {
      tag: event.pubkey,
      title: nameOf(state, event.pubkey),
      line: text,
      url: conversationRoute(event.pubkey),
      icon: pictureOf(state, event.pubkey),
      at: event.created_at,
    };
  }

  if (event.kind !== 1059) return undefined;

  const epoch = targets.find((target) => state.groups[target]);
  if (epoch) {
    const group = state.groups[epoch];
    const rumor = await unwrapGiftWrap(new NSecSigner(fromHex(group.secret)), event);
    if (!rumor.tags.some(([name, value]) => name === 'p' && value === group.groupId)) return undefined;
    if (group.retiredAt !== undefined && rumor.created_at > group.retiredAt + 60) return undefined;
    const mutedAt = state.groupMuted[group.groupId]?.[rumor.pubkey];
    if (mutedAt !== undefined && rumor.created_at >= mutedAt) return undefined;
    return rumorAlert(rumor, group.groupId, state, true);
  }

  if (!targets.includes(state.me)) return undefined;
  // Extension and remote-signer logins keep the key away from this device's storage.
  if (!state.secret) return genericAlert();

  const rumor = await unwrapGiftWrap(new NSecSigner(fromHex(state.secret)), event);
  const participants = getParticipants(rumor);
  if (!participants.includes(state.me) || participants.length > MAX_GROUP_PARTICIPANTS + 1) return undefined;
  return rumorAlert(rumor, conversationIdFromParticipants(participants, state.me), state, false);
}

function genericAlert(): Alert {
  return { tag: 'nostr-buzz-message', title: 'nostr.buzz', line: 'New message', url: '/' };
}

function rumorAlert(rumor: Rumor, conversationId: string, state: PushState, buzzGroup: boolean): Alert | undefined {
  if (rumor.pubkey === state.me) return undefined;
  if (nowSeconds() - rumor.created_at > MAX_AGE_SECONDS) return undefined;
  if (state.muted.includes(conversationId)) return undefined;

  const isRoom = buzzGroup || conversationId.includes(',');
  const known = buzzGroup || state.known.includes(rumor.pubkey);
  const sender = nameOf(state, rumor.pubkey);
  const url = conversationRoute(conversationId);
  const icon = pictureOf(state, buzzGroup ? conversationId : rumor.pubkey) ?? pictureOf(state, rumor.pubkey);
  const roomName = buzzGroup
    ? state.names[conversationId]?.name || 'Group'
    : rumor.tags.find(([name]) => name === 'subject')?.[1]?.trim() || 'Group chat';

  if (isBuzz(rumor)) {
    if (!known && !state.buzzFromStrangers) return undefined;
    return {
      tag: conversationId,
      title: isRoom ? `🐝 ${roomName}` : `🐝 ${sender}`,
      line: isRoom ? `${sender}: BUZZ!!!` : 'BUZZ!!!',
      url,
      icon,
      buzz: true,
      at: rumor.created_at,
    };
  }

  // Message requests stay quiet, like in the app.
  if (!known || isGroupJoin(rumor)) return undefined;

  let text: string;
  if (rumor.kind === DM_KIND.chat || rumor.kind === DM_KIND.file) {
    text = state.previews ? messagePreview(rumor) : 'New message';
  } else if (rumor.kind === DM_KIND.reaction && !isRoom) {
    const emoji = rumor.content.trim();
    if (emoji === '-') return undefined;
    text = state.previews ? `Reacted ${!emoji || emoji === '+' ? '👍' : [...emoji].slice(0, 8).join('')}` : 'New reaction';
  } else {
    return undefined;
  }
  if (!text) return undefined;

  return {
    tag: conversationId,
    title: isRoom ? roomName : sender,
    line: isRoom ? `${sender}: ${text}` : text,
    url,
    icon,
    at: rumor.created_at,
  };
}

/* ------------------------------- notifications ------------------------------ */

async function showAlert(alert: Alert): Promise<void> {
  // Stack the latest lines of a chat into one notification, like native messengers.
  const existing = await self.registration.getNotifications({ tag: alert.tag });
  const previous = (existing[0]?.data as NotificationData | undefined)?.lines ?? [];
  const lines = alert.buzz ? [alert.line] : [...previous, alert.line.slice(0, 240)].slice(-5);

  const options: RichNotificationOptions = {
    body: lines.join('\n'),
    icon: alert.icon ?? ICON,
    tag: alert.tag,
    renotify: true,
    timestamp: (alert.at ?? nowSeconds()) * 1000,
    data: { url: alert.url, lines } satisfies NotificationData,
    ...(alert.buzz ? { vibrate: BUZZ_VIBRATION } : {}),
  };
  await self.registration.showNotification(alert.title, options);

  const badge = ((await pushGet('badge')) ?? 0) + 1;
  await pushSet('badge', badge);
  await setBadge(badge);
}

/** Nothing to tell the user. On WebKit a push still has to show something, so make it brief. */
async function quiet(): Promise<void> {
  if (!mustAlwaysShow) return;
  await self.registration.showNotification('nostr.buzz', { body: 'Up to date', tag: QUIET_TAG, silent: true, icon: ICON });
  await new Promise((resolve) => setTimeout(resolve, 120));
  for (const notification of await self.registration.getNotifications({ tag: QUIET_TAG })) notification.close();
}

async function setBadge(count: number): Promise<void> {
  try {
    const nav = self.navigator as WorkerNavigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) await nav.setAppBadge?.(count);
    else await nav.clearAppBadge?.();
  } catch {
    // Badges are optional.
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data as NotificationData | undefined;
  const url = typeof data?.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/';
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = windows.find((item) => item.visibilityState === 'visible') ?? windows[0];
      if (client) {
        client.postMessage({ type: 'navigate', url } satisfies WorkerMessage);
        await client.focus().catch(() => undefined);
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

/** The browser replaced our push subscription: register the new one with the server. */
self.addEventListener('pushsubscriptionchange', (event) => {
  (event as ExtendableEvent).waitUntil(
    (async () => {
      const registration = await pushGet('registration');
      if (!registration) return;
      const subscription = await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToBytes(registration.vapidKey),
      });
      await fetch(`${registration.server}/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...registration.body, subscription: subscription.toJSON() }),
      });
    })().catch((error: unknown) => console.debug('Could not renew push subscription', error)),
  );
});
