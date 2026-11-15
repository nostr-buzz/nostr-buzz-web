/**
 * Validate an untrusted (event-sourced) URL and return a safe absolute https URL,
 * or `undefined` when the URL is malformed or uses any other protocol.
 *
 * Use this before putting any event data into `href`, `src`, or CSS `url()`.
 */
export function sanitizeUrl(value: string | undefined | null): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/** Normalize a relay URL (wss/ws only) so it can be compared and deduplicated. */
export function normalizeRelayUrl(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return undefined;
    url.hash = '';
    url.search = '';
    // URL already lowercases scheme + host and normalizes a bare host to "/".
    return url.href;
  } catch {
    return undefined;
  }
}
