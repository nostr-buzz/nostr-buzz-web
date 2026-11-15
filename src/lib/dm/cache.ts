import type { ChatMessage } from './types';

/**
 * Tiny IndexedDB cache of decrypted DMs, so returning users don't have to
 * re-decrypt (and re-approve, for extension / remote signers) every gift wrap.
 *
 * Records are keyed by `<owner>:<eventId>` where `eventId` is the gift wrap id
 * (NIP-17) or the kind 4 event id (NIP-04).
 */
export interface CacheRecord {
  key: string;
  owner: string;
  eventId: string;
  message: ChatMessage;
  at: number;
}

const DB_NAME = 'nostr-buzz';
const DB_VERSION = 1;
const STORE = 'dm-events';

let dbPromise: Promise<IDBDatabase | undefined> | undefined;

function openDb(): Promise<IDBDatabase | undefined> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(undefined);
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('owner', 'owner', { unique: false });
        }
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

/** Strip local-only fields before persisting. */
function persistable(message: ChatMessage): ChatMessage {
  const { status: _status, localPreviewUrl: _url, localPreviewType: _type, ...rest } = message;
  return rest;
}

export async function loadCachedMessages(owner: string): Promise<CacheRecord[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).index('owner').getAll(owner);
      request.onsuccess = () => resolve((request.result as CacheRecord[]) ?? []);
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function saveCachedMessages(
  owner: string,
  entries: { eventId: string; message: ChatMessage }[],
): Promise<void> {
  if (entries.length === 0) return;
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const at = Date.now();
      for (const { eventId, message } of entries) {
        const record: CacheRecord = {
          key: `${owner}:${eventId}`,
          owner,
          eventId,
          message: persistable(message),
          at,
        };
        store.put(record);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Remove every cached message for a user (used by "Clear local cache"). */
export async function clearCachedMessages(owner: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const index = tx.objectStore(STORE).index('owner');
      const request = index.openCursor(IDBKeyRange.only(owner));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
