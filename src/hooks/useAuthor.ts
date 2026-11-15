import { type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useDiscoveryRelays } from '@/hooks/useDMRelays';

export function useAuthor(pubkey: string | undefined) {
  const { nostr } = useNostr();
  // Chat partners can be anyone, so also look at well-known profile indexers.
  const relays = useDiscoveryRelays();

  return useQuery<{ event?: NostrEvent; metadata?: NostrMetadata }>({
    queryKey: ['nostr', 'author', pubkey ?? ''],
    queryFn: async () => {
      if (!pubkey) {
        return {};
      }

      const events = await nostr.query(
        [{ kinds: [0], authors: [pubkey], limit: 1 }],
        { signal: AbortSignal.timeout(2500), relays },
      );
      const event = events.sort((a, b) => b.created_at - a.created_at)[0];

      if (!event) {
        throw new Error('No event found');
      }

      try {
        const metadata = n.json().pipe(n.metadata()).parse(event.content);
        return { metadata, event };
      } catch {
        return { event };
      }
    },
    staleTime: 5 * 60 * 1000, // Keep cached data fresh for 5 minutes
    retry: 2,
  });
}
