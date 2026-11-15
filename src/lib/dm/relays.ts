import type { NostrEvent } from '@nostrify/nostrify';

import { normalizeRelayUrl } from '@/lib/sanitize';

/**
 * Suggested NIP-17 inbox relays (kind 10050). auth.nostr1.com requires NIP-42
 * AUTH and only serves gift wraps to their recipients, which is ideal for DMs.
 */
export const DEFAULT_INBOX_RELAYS = [
  'wss://relay.ditto.pub/',
  'wss://auth.nostr1.com/',
  'wss://nos.lol/',
];

/** Where we look up other people's relay lists (kind 10050 / 10002) and profiles. */
export const DISCOVERY_RELAYS = [
  'wss://purplepag.es/',
  'wss://relay.ditto.pub/',
  'wss://nos.lol/',
  'wss://relay.primal.net/',
];

/** NIP-17 recommends keeping inbox lists small. */
export const MAX_INBOX_RELAYS = 5;

export function uniqueRelays(urls: Iterable<string>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of urls) {
    const normalized = normalizeRelayUrl(url);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

/** Relay URLs from a kind 10050 DM relay list. */
export function parseInboxRelays(event: NostrEvent | undefined): string[] {
  if (!event || event.kind !== 10050) return [];
  return uniqueRelays(event.tags.filter(([name]) => name === 'relay').map(([, url]) => url ?? '')).slice(
    0,
    MAX_INBOX_RELAYS,
  );
}

/** Read ("inbox") relays from a kind 10002 NIP-65 relay list. */
export function parseNip65ReadRelays(event: NostrEvent | undefined): string[] {
  if (!event || event.kind !== 10002) return [];
  return uniqueRelays(
    event.tags
      .filter(([name, , marker]) => name === 'r' && (!marker || marker === 'read'))
      .map(([, url]) => url ?? ''),
  ).slice(0, MAX_INBOX_RELAYS);
}
