/**
 * Unsent message drafts, one per conversation, kept in localStorage.
 * The composer writes them; the chat list shows them ("Draft: …").
 */
import { useSyncExternalStore } from 'react';

const draftKey = (id: string) => `nostr-buzz:draft:${id}`;

/** Drafts read so far, so the chat list doesn't hit localStorage on every render. */
const cache = new Map<string, string>();
const listeners = new Set<() => void>();

export function loadDraft(id: string): string {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  let value = '';
  try {
    value = localStorage.getItem(draftKey(id)) ?? '';
  } catch {
    // Storage blocked: no drafts.
  }
  cache.set(id, value);
  return value;
}

export function saveDraft(id: string, value: string): void {
  const next = value.trim() ? value : '';
  if (loadDraft(id) === next) return;
  cache.set(id, next);
  try {
    if (next) localStorage.setItem(draftKey(id), next);
    else localStorage.removeItem(draftKey(id));
  } catch {
    // Drafts are a convenience.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The saved draft for a conversation (empty when there is none). Updates as it changes. */
export function useDraft(id: string): string {
  return useSyncExternalStore(
    subscribe,
    () => loadDraft(id),
    () => '',
  );
}
