/**
 * Keeps every open tab and installed copy of the app on the latest deployed version.
 *
 * Each build writes `/version.json`. The running app compares it with the version it was
 * built as; when they differ, a new version is live and a reload picks it up.
 */

/** The version this bundle was built as. */
export const APP_VERSION: string = __APP_VERSION__;
export const APP_BUILT_AT: string = __APP_BUILT_AT__;

const APPLIED_KEY = 'nostr-buzz:update';
/** Automatic reloads per new version, in case a stale copy of the app keeps being served. */
const MAX_AUTO_RELOADS = 2;

export interface UpdateState {
  /** A newer version than the running one is deployed. */
  available: boolean;
  /** The deployed version, once known. */
  latest?: string;
  checking: boolean;
}

let state: UpdateState = { available: false, checking: false };
const listeners = new Set<() => void>();

function setState(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribeUpdate(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export const getUpdateState = (): UpdateState => state;

let inFlight: Promise<boolean> | undefined;

/** Ask the server which version is live. Resolves to true when it is newer than this one. */
export function checkForUpdate(): Promise<boolean> {
  if (import.meta.env.DEV) return Promise.resolve(false);
  inFlight ??= (async () => {
    setState({ checking: true });
    try {
      // The query string and `no-store` get past both the browser and the CDN cache.
      const response = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) return state.available;
      const data = (await response.json()) as { version?: unknown };
      if (typeof data.version !== 'string' || !data.version) return state.available;
      const available = data.version !== APP_VERSION;
      setState({ available, latest: data.version });
      // Let the browser pick up a new service worker right away too.
      if (available && 'serviceWorker' in navigator) {
        void navigator.serviceWorker
          .getRegistration('/')
          .then((registration) => registration?.update())
          .catch(() => undefined);
      }
      return available;
    } catch {
      // Offline or blocked: try again at the next check.
      return state.available;
    } finally {
      setState({ checking: false });
      inFlight = undefined;
    }
  })();
  return inFlight;
}

interface Applied {
  version: string;
  count: number;
  at: number;
}

function readApplied(): Applied | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(APPLIED_KEY) ?? 'null') as Partial<Applied> | null;
    if (value && typeof value.version === 'string' && typeof value.count === 'number' && typeof value.at === 'number') {
      return { version: value.version, count: value.count, at: value.at };
    }
  } catch {
    // Storage blocked.
  }
  return undefined;
}

/**
 * Load the new version. `auto` reloads are limited per version so a stale cache
 * can never trap the app in a reload loop; a tap on "Update" always reloads.
 */
export function applyUpdate(auto = false): boolean {
  const target = state.latest ?? 'unknown';
  const previous = readApplied();
  const count = previous?.version === target ? previous.count : 0;
  if (auto && count >= MAX_AUTO_RELOADS) return false;
  try {
    sessionStorage.setItem(APPLIED_KEY, JSON.stringify({ version: target, count: count + 1, at: Date.now() } satisfies Applied));
  } catch {
    // Without storage there is no loop guard, so only reload when asked to.
    if (auto) return false;
  }
  window.location.reload();
  return true;
}

/** True once, right after the app reloaded itself into the version it was aiming for. */
export function consumeJustUpdated(): boolean {
  const applied = readApplied();
  if (!applied || applied.version !== APP_VERSION) return false;
  try {
    sessionStorage.removeItem(APPLIED_KEY);
  } catch {
    // Nothing to clean up.
  }
  return Date.now() - applied.at < 60_000;
}

/**
 * After a deploy, the old version's lazily loaded files are gone. If this (old) copy asks
 * for one, reload into the new version instead of failing.
 */
export function recoverFromMissingChunks(): void {
  window.addEventListener('vite:preloadError', (event) => {
    const applied = readApplied();
    if (applied && Date.now() - applied.at < 30_000) return;
    event.preventDefault();
    applyUpdate(true);
  });
}
