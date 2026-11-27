/**
 * "Install app" support. Chromium browsers fire `beforeinstallprompt` when the app can be
 * installed; holding on to that event lets the app offer its own install button.
 * (Safari has no such event: there the user adds the app from the Share menu.)
 */
import { useSyncExternalStore } from 'react';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let pending: InstallPromptEvent | undefined;
const listeners = new Set<() => void>();

function set(event: InstallPromptEvent | undefined) {
  pending = event;
  for (const listener of listeners) listener();
}

/** Start listening for the browser's install offer. Call once at startup. */
export function watchInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-banner away; the app shows the offer in its menu.
    event.preventDefault();
    set(event as InstallPromptEvent);
  });
  window.addEventListener('appinstalled', () => set(undefined));
}

/** Show the browser's install dialog. Resolves to true when the user installed the app. */
export async function promptInstall(): Promise<boolean> {
  const event = pending;
  if (!event) return false;
  set(undefined);
  try {
    await event.prompt();
    return (await event.userChoice).outcome === 'accepted';
  } catch {
    return false;
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while the browser is ready to install the app. */
export function useCanInstall(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => pending !== undefined,
    () => false,
  );
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** False while the device reports no network connection. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine,
    () => true,
  );
}
