import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';

import { useDiscoveryRelays } from '@/hooks/useDMRelays';

const HEX64 = /^[0-9a-f]{64}$/;

/** Pubkeys the given user follows (kind 3), newest list wins. */
export function useFollows(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const relays = useDiscoveryRelays();

  return useQuery({
    queryKey: ['nostr', 'follows', pubkey ?? ''],
    enabled: !!pubkey,
    queryFn: async ({ signal }) => {
      if (!pubkey) return [];
      const events = await nostr.query([{ kinds: [3], authors: [pubkey], limit: 1 }], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        relays,
      });
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return [];
      const seen = new Set<string>();
      for (const [name, value] of latest.tags) {
        if (name === 'p' && value && HEX64.test(value)) seen.add(value);
      }
      return [...seen];
    },
    staleTime: 5 * 60 * 1000,
  });
}
