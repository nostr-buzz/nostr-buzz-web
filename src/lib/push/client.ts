/**
 * Page-side notification plumbing: the service worker, the Web Push subscription,
 * the push server registration, local notifications and the app icon badge.
 */
import { base64UrlToBytes, type PushRegistration, pushSet, type PushState, type WorkerMessage } from './store';

/** Base URL of the nostr.buzz push server, set at build time. Empty = no closed-app push. */
export const PUSH_SERVER = (import.meta.env.VITE_PUSH_SERVER_URL ?? '').trim().replace(/\/+$/, '');

/** Window event (detail = path) fired when a notification asks the app to open a chat. */
export const PUSH_NAVIGATE_EVENT = 'nostr-buzz:navigate';

const TOKEN_KEY = 'nostr-buzz:push-token';
const SYNCED_KEY = 'nostr-buzz:push-synced';
const RESYNC_AFTER_MS = 12 * 60 * 60 * 1000;
const ICON = '/icons/icon-192.png';

/**
 * - `off`: notifications are turned off (or nobody is logged in)
 * - `local`: shown only while the app is open in the background
 * - `push`: delivered by the push server, even with the app closed
 * - `error`: the push server could not be reached; behaves like `local`
 */
export type PushDelivery = 'off' | 'local' | 'push' | 'error';

let delivery: PushDelivery = 'off';
const listeners = new Set<() => void>();

function setDelivery(next: PushDelivery) {
  if (next === delivery) return;
  delivery = next;
  for (const listener of listeners) listener();
}

export function subscribeDelivery(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getDelivery = (): PushDelivery => delivery;

/* --------------------------------- platform -------------------------------- */

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function pushSupported(): boolean {
  return notificationsSupported() && 'serviceWorker' in navigator && 'PushManager' in window;
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Installed to the home screen (the only place iOS allows web notifications). */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as { standalone?: boolean }).standalone === true
  );
}

export function notificationPermission(): NotificationPermission {
  return notificationsSupported() ? Notification.permission : 'denied';
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/* ------------------------------ service worker ------------------------------ */

let registered = false;

/** Register the service worker once and listen for "open this chat" requests from it. */
export function registerServiceWorker(): void {
  if (registered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registered = true;
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<WorkerMessage | undefined>) => {
    const data = event.data;
    if (data?.type === 'navigate' && typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//')) {
      window.dispatchEvent(new CustomEvent(PUSH_NAVIGATE_EVENT, { detail: data.url }));
    }
  });
  const register = () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      console.debug('Service worker registration failed', error);
    });
  };
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

async function getRegistration(): Promise<ServiceWorkerRegistration | undefined> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return undefined;
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8000)),
    ]);
  } catch {
    return undefined;
  }
}

/* -------------------------------- push server ------------------------------- */

function getToken(): string {
  try {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored;
  } catch {
    // Storage blocked: use a token for this session only.
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // See above.
  }
  return token;
}

async function api<T>(path: string, body?: unknown, timeout = 10_000): Promise<T> {
  const response = await fetch(`${PUSH_SERVER}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`Push server answered ${response.status}`);
  return (await response.json()) as T;
}

let vapidKey: string | undefined;

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const bytes = new Uint8Array(a);
  return bytes.length === b.length && bytes.every((value, index) => value === b[index]);
}

export interface PushTarget {
  /** The user's "Notifications" setting. */
  enabled: boolean;
  /** Deliver through the push server (off = only while the app is open). */
  push: boolean;
  owner: string;
  /** Pubkeys to hear about: the user plus their group keys. */
  watch: string[];
  relays: string[];
  legacy: boolean;
}

let queue: Promise<void> = Promise.resolve();

/** Bring the push subscription in line with the account. Calls run one after another. */
export function syncPush(target: PushTarget | undefined): Promise<void> {
  queue = queue
    .then(() => applyPush(target))
    .catch((error: unknown) => {
      console.debug('Push sync failed', error);
      setDelivery(target?.enabled && notificationPermission() === 'granted' ? 'error' : 'off');
    });
  return queue;
}

async function applyPush(target: PushTarget | undefined): Promise<void> {
  if (!target?.enabled || notificationPermission() !== 'granted') {
    await removePush();
    setDelivery('off');
    return;
  }
  if (!target.push) {
    await removePush();
    setDelivery('local');
    return;
  }
  if (!PUSH_SERVER || !pushSupported()) {
    setDelivery('local');
    return;
  }
  const registration = await getRegistration();
  if (!registration) {
    setDelivery('local');
    return;
  }

  vapidKey ??= (await api<{ key: string }>('/vapid')).key;
  const keyBytes = base64UrlToBytes(vapidKey);
  let subscription = await registration.pushManager.getSubscription();
  if (subscription && !sameKey(subscription.options.applicationServerKey, keyBytes)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  subscription ??= await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes });

  const body: PushRegistration['body'] = {
    token: getToken(),
    owner: target.owner,
    watch: [...new Set(target.watch)].sort(),
    relays: [...new Set(target.relays)].sort(),
    legacy: target.legacy,
  };
  const fingerprint = JSON.stringify([PUSH_SERVER, subscription.endpoint, body]);
  if (!recentlySynced(fingerprint)) {
    await api('/subscribe', { ...body, subscription: subscription.toJSON() });
    rememberSynced(fingerprint);
    await pushSet('registration', { server: PUSH_SERVER, vapidKey, body });
  }
  setDelivery('push');
}

function recentlySynced(fingerprint: string): boolean {
  try {
    const stored = JSON.parse(localStorage.getItem(SYNCED_KEY) ?? 'null') as { fingerprint?: string; at?: number } | null;
    return stored?.fingerprint === fingerprint && Date.now() - (stored.at ?? 0) < RESYNC_AFTER_MS;
  } catch {
    return false;
  }
}

function rememberSynced(fingerprint: string | undefined) {
  try {
    if (fingerprint) localStorage.setItem(SYNCED_KEY, JSON.stringify({ fingerprint, at: Date.now() }));
    else localStorage.removeItem(SYNCED_KEY);
  } catch {
    // Only an optimization.
  }
}

async function removePush(): Promise<void> {
  let wasRegistered: boolean;
  try {
    wasRegistered = localStorage.getItem(SYNCED_KEY) !== null;
  } catch {
    wasRegistered = false;
  }
  rememberSynced(undefined);
  await pushSet('registration', undefined);
  if (PUSH_SERVER && wasRegistered) {
    await api('/unsubscribe', { token: getToken() }).catch(() => undefined);
  }
  if (!pushSupported()) return;
  const registration = await navigator.serviceWorker.getRegistration('/').catch(() => undefined);
  const subscription = await registration?.pushManager.getSubscription().catch(() => null);
  await subscription?.unsubscribe().catch(() => false);
}

/**
 * Tell the push server about gift wraps this device is about to publish for its own
 * account, so the user's devices are not alerted about their own messages.
 * Resolves quickly even when the server is slow: sending never waits on it for long.
 */
export async function ignoreOwnWraps(ids: string[]): Promise<void> {
  if (delivery !== 'push' || ids.length === 0) return;
  await api('/ignore', { token: getToken(), ids }, 1500).catch(() => undefined);
}

export async function sendTestPush(): Promise<void> {
  if (delivery === 'push') {
    await api('/test', { token: getToken() });
    return;
  }
  const registration = await getRegistration();
  const options = { body: 'You will get messages here while the app is open.', icon: ICON, tag: 'nostr-buzz-test' };
  if (registration) await registration.showNotification('Notifications work 🐝', options);
  else new Notification('Notifications work 🐝', options);
}

/* ------------------------------ local fallbacks ------------------------------ */

/** Mirror what the service worker needs (or forget it on logout). */
export function writePushState(state: PushState | undefined): Promise<void> {
  return pushSet('state', state);
}

/**
 * Show a notification from the page. Skipped when the push server delivers them,
 * so the same message never alerts twice.
 */
export async function showLocalNotification(title: string, body: string, tag: string, url: string, silent = false): Promise<void> {
  if (delivery === 'push' || notificationPermission() !== 'granted') return;
  const options = { body, tag, icon: ICON, silent, data: { url, lines: [body] } };
  try {
    // Mobile browsers only allow notifications from a service worker.
    const registration = await getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
    const notification = new Notification(title, options);
    notification.onclick = () => {
      window.focus();
      window.dispatchEvent(new CustomEvent(PUSH_NAVIGATE_EVENT, { detail: url }));
      notification.close();
    };
  } catch {
    // Notifications are best effort.
  }
}

/** Dismiss a chat's notifications once it has been read. */
export async function closeNotifications(tag?: string): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration('/');
    const notifications = (await registration?.getNotifications(tag ? { tag } : undefined)) ?? [];
    for (const notification of notifications) notification.close();
  } catch {
    // Not supported everywhere.
  }
}

/** Unread count on the installed app's icon. */
export function setUnreadBadge(count: number): void {
  void pushSet('badge', count);
  try {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    if (count > 0) void nav.setAppBadge?.(count).catch(() => undefined);
    else void nav.clearAppBadge?.().catch(() => undefined);
  } catch {
    // Badges are optional.
  }
}
