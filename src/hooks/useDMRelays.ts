import type { NostrEvent } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { queryOptions, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAppContext } from '@/hooks/useAppContext';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { nowSeconds } from '@/lib/dm/nip17';
import {
  DISCOVERY_RELAYS,
  MAX_INBOX_RELAYS,
  parseInboxRelays,
  parseNip65ReadRelays,
  uniqueRelays,
} from '@/lib/dm/relays';

type NostrPool = ReturnType<typeof useNostr>['nostr'];

export interface DMRelayInfo {
  /** NIP-17 inbox relays (kind 10050). Empty when the user hasn't published a list. */
  inbox: string[];
  /** NIP-65 read relays (kind 10002), used as a fallback. */
  nip65Read: string[];
  inboxEvent?: NostrEvent;
}

const EMPTY_INFO: DMRelayInfo = { inbox: [], nip65Read: [] };

/** App read relays + well-known indexers, used to find other people's lists and profiles. */
export function useDiscoveryRelays(): string[] {
  const { config } = useAppContext();
  return useMemo(
    () =>
      uniqueRelays([
        ...config.relayMetadata.relays.filter((relay) => relay.read).map((relay) => relay.url),
        ...DISCOVERY_RELAYS,
      ]),
    [config.relayMetadata],
  );
}

function latestOfKind(events: NostrEvent[], kind: number): NostrEvent | undefined {
  return events.filter((event) => event.kind === kind).sort((a, b) => b.created_at - a.created_at)[0];
}

export function dmRelayInfoQueryOptions(nostr: NostrPool, pubkey: string, relays: string[]) {
  return queryOptions({
    queryKey: ['nostr', 'dm-relays', pubkey],
    queryFn: async ({ signal }): Promise<DMRelayInfo> => {
      const events = await nostr.query(
        [
          { kinds: [10050], authors: [pubkey], limit: 1 },
          { kinds: [10002], authors: [pubkey], limit: 1 },
        ],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]), relays },
      );
      const inboxEvent = latestOfKind(events, 10050);
      return {
        inbox: parseInboxRelays(inboxEvent),
        nip65Read: parseNip65ReadRelays(latestOfKind(events, 10002)),
        inboxEvent,
      };
    },
    staleTime: 10 * 60 * 1000,
    retry: 1,
  });
}

/** Where a user receives DMs. */
export function useDMRelayInfo(pubkey: string | undefined) {
  const { nostr } = useNostr();
  const relays = useDiscoveryRelays();
  return useQuery({
    ...dmRelayInfoQueryOptions(nostr, pubkey ?? '', relays),
    enabled: !!pubkey,
  });
}

/** Publish the current user's NIP-17 inbox relay list (kind 10050). */
export function usePublishInboxRelays() {
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { config } = useAppContext();
  const discovery = useDiscoveryRelays();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (urls: string[]) => {
      if (!user) throw new Error('You need to be logged in.');
      const relays = uniqueRelays(urls).slice(0, MAX_INBOX_RELAYS);
      if (relays.length === 0) throw new Error('Add at least one relay.');

      const event = await user.signer.signEvent({
        kind: 10050,
        content: '',
        tags: relays.map((url) => ['relay', url]),
        created_at: nowSeconds(),
      });

      // Spread the list widely so anyone can find where to reach this user.
      const targets = uniqueRelays([
        ...relays,
        ...discovery,
        ...config.relayMetadata.relays.filter((relay) => relay.write).map((relay) => relay.url),
      ]);
      await nostr.event(event, { relays: targets, signal: AbortSignal.timeout(10_000) });
      return event;
    },
    onSuccess: (event) => {
      if (!user) return;
      queryClient.setQueryData<DMRelayInfo>(['nostr', 'dm-relays', user.pubkey], (old) => ({
        ...(old ?? EMPTY_INFO),
        inbox: parseInboxRelays(event),
        inboxEvent: event,
      }));
    },
  });
}
