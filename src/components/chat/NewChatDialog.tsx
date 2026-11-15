import { NIP05, type NostrEvent, type NostrMetadata, NSchema as n } from '@nostrify/nostrify';
import { useNostr } from '@nostrify/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Bookmark, Check, Loader2, Search, Users, X } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';

import { UserAvatar } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { useDiscoveryRelays } from '@/hooks/useDMRelays';
import { useFollows } from '@/hooks/useFollows';
import { useToast } from '@/hooks/useToast';
import { conversationIdFromParticipants, conversationRoute } from '@/lib/dm/conversation';
import { displayName, shortNpub } from '@/lib/format';
import { cn } from '@/lib/utils';

const HEX64 = /^[0-9a-f]{64}$/;
const SEARCH_RELAYS = ['wss://relay.ditto.pub/', 'wss://search.nos.today/'];

interface Candidate {
  pubkey: string;
  metadata?: NostrMetadata;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function parseMetadata(event: NostrEvent): NostrMetadata | undefined {
  const parsed = n.json().pipe(n.metadata()).safeParse(event.content);
  return parsed.success ? parsed.data : undefined;
}

/** Profiles of everyone the user follows (also seeds the author cache). */
function useContactProfiles(pubkeys: string[] | undefined) {
  const { nostr } = useNostr();
  const relays = useDiscoveryRelays();
  const queryClient = useQueryClient();

  return useQuery({
    queryKey: ['nostr', 'contact-profiles', pubkeys?.length ?? 0, pubkeys?.[0] ?? ''],
    enabled: !!pubkeys && pubkeys.length > 0,
    staleTime: 10 * 60 * 1000,
    queryFn: async ({ signal }): Promise<Candidate[]> => {
      const list = (pubkeys ?? []).slice(0, 600);
      const filters = [];
      for (let i = 0; i < list.length; i += 150) {
        const chunk = list.slice(i, i + 150);
        filters.push({ kinds: [0], authors: chunk, limit: chunk.length });
      }
      const events = await nostr.query(filters, { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), relays });
      const latest = new Map<string, NostrEvent>();
      for (const event of events) {
        const current = latest.get(event.pubkey);
        if (!current || current.created_at < event.created_at) latest.set(event.pubkey, event);
      }
      return list.map((pubkey) => {
        const event = latest.get(pubkey);
        const metadata = event ? parseMetadata(event) : undefined;
        if (event && !queryClient.getQueryData(['nostr', 'author', pubkey])) {
          queryClient.setQueryData(['nostr', 'author', pubkey], { event, metadata });
        }
        return { pubkey, metadata };
      });
    },
  });
}

/** Turns "npub…", "nprofile…", hex or "name@domain" into a pubkey. */
function useResolvedIdentifier(input: string) {
  const value = input.trim();
  const isNip05 = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || /^[a-z0-9-]+\.[a-z]{2,}$/i.test(value);

  const direct = useMemo(() => {
    if (HEX64.test(value)) return value;
    try {
      const decoded = nip19.decode(value.replace(/^nostr:/, ''));
      if (decoded.type === 'npub') return decoded.data;
      if (decoded.type === 'nprofile') return decoded.data.pubkey;
    } catch {
      // not bech32
    }
    return undefined;
  }, [value]);

  const nip05 = useQuery({
    queryKey: ['nip05', value.toLowerCase()],
    enabled: !direct && isNip05,
    staleTime: 10 * 60 * 1000,
    retry: false,
    queryFn: async ({ signal }) => {
      const pointer = await NIP05.lookup(value, { signal: AbortSignal.any([signal, AbortSignal.timeout(6000)]) });
      return pointer.pubkey;
    },
  });

  return { pubkey: direct ?? nip05.data, loading: nip05.isFetching, isIdentifier: !!direct || isNip05 };
}

/** NIP-50 profile search on search-capable relays. */
function useProfileSearch(term: string, enabled: boolean) {
  const { nostr } = useNostr();
  return useQuery({
    queryKey: ['nostr', 'profile-search', term.toLowerCase()],
    enabled: enabled && term.length >= 2,
    staleTime: 60 * 1000,
    queryFn: async ({ signal }): Promise<Candidate[]> => {
      const events = await nostr.query([{ kinds: [0], search: term, limit: 12 }], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
        relays: SEARCH_RELAYS,
      });
      const seen = new Set<string>();
      const out: Candidate[] = [];
      for (const event of events) {
        if (seen.has(event.pubkey)) continue;
        seen.add(event.pubkey);
        out.push({ pubkey: event.pubkey, metadata: parseMetadata(event) });
      }
      return out;
    },
  });
}

function matches(candidate: Candidate, needle: string): boolean {
  const m = candidate.metadata;
  return [m?.display_name, m?.name, m?.nip05].some((field) => field?.toLowerCase().includes(needle));
}

const GROUP_MEMBER_LIMIT = 50;

/** "Pick people" mode, e.g. adding members to an existing group. */
interface PickOptions {
  title: string;
  confirmLabel: string;
  /** People who can't be picked (already members). */
  exclude: string[];
  onConfirm: (pubkeys: string[]) => Promise<void>;
}

interface NewChatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pick?: PickOptions;
}

export function NewChatDialog({ open, onOpenChange, pick }: NewChatDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(42rem,calc(100dvh-2rem))] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        {open && <NewChatPanel onDone={() => onOpenChange(false)} pick={pick} />}
      </DialogContent>
    </Dialog>
  );
}

function NewChatPanel({ onDone, pick }: { onDone: () => void; pick?: PickOptions }) {
  const { user } = useCurrentUser();
  const { conversations, createGroup: createNostrGroup } = useDM();
  const { toast } = useToast();
  const navigate = useNavigate();
  const follows = useFollows(user?.pubkey);
  const contacts = useContactProfiles(follows.data);

  const [mode, setMode] = useState<'direct' | 'group'>(pick ? 'group' : 'direct');
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);

  const term = useDebounced(input.trim(), 350);
  const resolved = useResolvedIdentifier(term);
  const remote = useProfileSearch(term, !resolved.isIdentifier);
  const me = user?.pubkey ?? '';

  const recent = useMemo(
    () =>
      conversations
        .filter((c) => !c.isGroup && !c.isSelf)
        .slice(0, 8)
        .map((c) => c.participants[0]),
    [conversations],
  );

  const results = useMemo((): { section: string; items: Candidate[] }[] => {
    const needle = term.toLowerCase();
    const seen = new Set<string>([me, ...(pick?.exclude ?? [])]);
    const take = (items: Candidate[]) =>
      items.filter((item) => {
        if (seen.has(item.pubkey)) return false;
        seen.add(item.pubkey);
        return true;
      });

    if (!needle) {
      return [
        { section: 'Recent', items: take(recent.map((pubkey) => ({ pubkey }))) },
        { section: 'Following', items: take(contacts.data ?? []) },
      ].filter((group) => group.items.length > 0);
    }

    const sections: { section: string; items: Candidate[] }[] = [];
    if (resolved.pubkey) sections.push({ section: 'Nostr user', items: take([{ pubkey: resolved.pubkey }]) });
    sections.push({ section: 'Following', items: take((contacts.data ?? []).filter((c) => matches(c, needle)).slice(0, 30)) });
    sections.push({ section: 'Everyone on Nostr', items: take(remote.data ?? []) });
    return sections.filter((group) => group.items.length > 0);
  }, [term, me, pick?.exclude, recent, contacts.data, resolved.pubkey, remote.data]);

  const openChat = (pubkey: string) => {
    navigate(conversationRoute(conversationIdFromParticipants([pubkey], me)));
    onDone();
  };

  const toggle = (pubkey: string) => {
    setSelected((current) =>
      current.includes(pubkey)
        ? current.filter((p) => p !== pubkey)
        : current.length >= GROUP_MEMBER_LIMIT
          ? current
          : [...current, pubkey],
    );
  };

  const confirm = async () => {
    if (selected.length === 0 || busy) return;
    setBusy(true);
    try {
      if (pick) {
        await pick.onConfirm(selected);
        onDone();
        return;
      }
      const groupId = await createNostrGroup({ name: groupName, members: selected });
      navigate(conversationRoute(groupId));
      onDone();
    } catch (error) {
      toast({
        title: pick ? 'Could not add members' : 'Could not create group',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const searching = (term !== input.trim() && input.trim().length > 0) || resolved.loading || remote.isFetching;
  const loadingContacts = follows.isLoading || contacts.isLoading;

  return (
    <>
      <DialogHeader className="border-b px-5 pt-5 pb-4 text-left">
        <div className="flex items-center gap-2">
          {mode === 'group' && !pick && (
            <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => setMode('direct')}>
              <ArrowLeft />
            </Button>
          )}
          <DialogTitle className="font-display text-xl">
            {pick ? pick.title : mode === 'group' ? 'New group' : 'New chat'}
          </DialogTitle>
        </div>
        <DialogDescription>{mode === 'group' ? 'Pick people.' : 'Name, npub or NIP-05.'}</DialogDescription>
        <div className="relative mt-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="name, npub1…, or you@domain.com"
            aria-label="Search people"
            dir="auto"
            className="h-11 rounded-xl pl-9"
          />
          {searching && <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
        {mode === 'group' && (
          <>
            {!pick && (
              <Input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Group name"
                aria-label="Group name"
                dir="auto"
                maxLength={80}
                className="mt-2 h-11 rounded-xl"
              />
            )}
            {selected.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {selected.map((pubkey) => (
                  <SelectedChip key={pubkey} pubkey={pubkey} onRemove={() => toggle(pubkey)} />
                ))}
              </div>
            )}
          </>
        )}
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2 scrollbar-thin">
        {mode === 'direct' && !term && (
          <div className="mb-1 space-y-0.5">
            <ActionRow icon={<Users className="size-5" />} label="New group" onClick={() => setMode('group')} />
            <ActionRow
              icon={<Bookmark className="size-5" />}
              label="Saved messages"
              onClick={() => {
                navigate(conversationRoute(me));
                onDone();
              }}
            />
          </div>
        )}

        {results.map((group) => (
          <section key={group.section} className="mb-2">
            <h3 className="px-3 pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.section}</h3>
            <ul>
              {group.items.map((candidate) => (
                <li key={candidate.pubkey}>
                  <PersonRow
                    candidate={candidate}
                    selectable={mode === 'group'}
                    selected={selected.includes(candidate.pubkey)}
                    onClick={() => (mode === 'group' ? toggle(candidate.pubkey) : openChat(candidate.pubkey))}
                  />
                </li>
              ))}
            </ul>
          </section>
        ))}

        {results.length === 0 && (loadingContacts || searching) && (
          <div className="space-y-1 px-1 py-2">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="flex items-center gap-3 px-2 py-2">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        )}

        {results.length === 0 && !loadingContacts && !searching && (
          <p className="px-6 py-10 text-center text-sm text-muted-foreground">
            {term ? 'No one found. Try an npub.' : 'Paste an npub to start.'}
          </p>
        )}
      </div>

      {mode === 'group' && (
        <div className="border-t p-4">
          <Button className="h-11 w-full rounded-xl" disabled={selected.length === 0 || busy} onClick={() => void confirm()}>
            {busy ? <Loader2 className="animate-spin" /> : <Users />}
            {pick ? pick.confirmLabel : 'Create group'}
            {selected.length > 0 ? ` · ${selected.length}` : ''}
          </Button>
        </div>
      )}
    </>
  );
}

function ActionRow({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-medium transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground">{icon}</span>
      {label}
    </button>
  );
}

function PersonRow({
  candidate,
  selectable,
  selected,
  onClick,
}: {
  candidate: Candidate;
  selectable: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const name = displayName(candidate.pubkey, candidate.metadata);
  const subtitle = candidate.metadata?.nip05 || shortNpub(candidate.pubkey);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selectable ? selected : undefined}
      className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      <UserAvatar pubkey={candidate.pubkey} className="size-10" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium" dir="auto">
          {name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{subtitle}</span>
      </span>
      {selectable && (
        <span
          className={cn(
            'flex size-6 items-center justify-center rounded-full border-2 transition-colors',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40',
          )}
          aria-hidden="true"
        >
          {selected && <Check className="size-4" />}
        </span>
      )}
    </button>
  );
}

function SelectedChip({ pubkey, onRemove }: { pubkey: string; onRemove: () => void }) {
  const queryClient = useQueryClient();
  const metadata = queryClient.getQueryData<{ metadata?: NostrMetadata }>(['nostr', 'author', pubkey])?.metadata;
  const name = displayName(pubkey, metadata);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-accent py-0.5 pr-1 pl-0.5 text-sm">
      <UserAvatar pubkey={pubkey} className="size-6" />
      <span className="max-w-32 truncate" dir="auto">
        {name}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="flex size-5 items-center justify-center rounded-full hover:bg-background/60"
      >
        <X className="size-3.5" />
      </button>
    </span>
  );
}
