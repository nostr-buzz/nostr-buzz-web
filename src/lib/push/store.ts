/**
 * Small IndexedDB key-value store shared by the page and the service worker.
 *
 * The service worker cannot read localStorage, so everything it needs to turn an
 * encrypted push into a notification is mirrored here by the page.
 */

/** What the service worker knows about the signed-in account. */
export interface PushState {
  /** Active account (hex pubkey). */
  me: string;
  /**
   * Hex secret key, only for nsec logins (the same key already sits in localStorage).
   * Without it (extension / remote signer) notifications can't show who wrote or what.
   */
  secret?: string;
  /** The user's "Notifications" setting. */
  enabled: boolean;
  /** Show message text in notifications. */
  previews: boolean;
  /** Notifications may play the system sound. */
  sound: boolean;
  buzzFromStrangers: boolean;
  /** Muted conversation ids. */
  muted: string[];
  /** Pubkeys the user follows or already chats with. Others are message requests. */
  known: string[];
  /** Display info by pubkey or group id. */
  names: Record<string, { name: string; picture?: string }>;
  /** Group keys by epoch pubkey. */
  groups: Record<string, { secret: string; groupId: string; retiredAt?: number }>;
  /** group id -> members that admins muted (pubkey -> unix seconds). */
  groupMuted: Record<string, Record<string, number>>;
}

/** Enough to register this device again from the service worker. */
export interface PushRegistration {
  server: string;
  vapidKey: string;
  body: {
    token: string;
    owner: string;
    watch: string[];
    relays: string[];
    legacy: boolean;
  };
}

interface Schema {
  state: PushState;
  registration: PushRegistration;
  /** Unread count shown on the app icon. */
  badge: number;
}

const DB_NAME = 'nostr-buzz-push';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

function openDb(): Promise<IDBDatabase | undefined> {
  dbPromise ??= new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(undefined);
        return;
      }
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      request.onblocked = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
  return dbPromise;
}

export async function pushGet<K extends keyof Schema>(key: K): Promise<Schema[K] | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise((resolve) => {
    try {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result as Schema[K] | undefined);
      request.onerror = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function pushSet<K extends keyof Schema>(key: K, value: Schema[K] | undefined): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      if (value === undefined) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Messages the service worker posts to open windows. */
export type WorkerMessage = { type: 'navigate'; url: string };

/** Body of a push message from the nostr.buzz push server. */
export type PushPayload =
  | { t: 'e'; e: unknown }
  | { t: 'r'; id: string; r: string[] }
  | { t: 't' };

/** Standard base64url -> bytes, for the VAPID application server key. */
export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
