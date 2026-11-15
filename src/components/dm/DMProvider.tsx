import { type NostrEvent, type NostrFilter, type NostrMetadata, type NostrSigner, NSecSigner } from '@nostrify/nostrify';
import { BlossomUploader } from '@nostrify/nostrify/uploaders';
import { useNostr } from '@nostrify/react';
import type { NUser } from '@nostrify/react/login';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { DMContext, type DMContextValue, type DMStatus, type SendOptions } from '@/contexts/DMContext';
import { useAppContext } from '@/hooks/useAppContext';
import { useBuzz } from '@/hooks/useBuzz';
import { useChatSettings } from '@/hooks/useChatSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { dmRelayInfoQueryOptions, useDiscoveryRelays } from '@/hooks/useDMRelays';
import { useFollows } from '@/hooks/useFollows';
import { getEffectiveBlossomServers } from '@/lib/appBlossom';
import { clearCachedMessages, loadCachedMessages, saveCachedMessages } from '@/lib/dm/cache';
import {
  BUZZ_CONTENT,
  BUZZ_TAG,
  conversationIdFromParticipants,
  conversationRoute,
  getParticipants,
  getSubject,
  isBuzz,
  MAX_GROUP_PARTICIPANTS,
  messagePreview,
  participantsFromConversationId,
} from '@/lib/dm/conversation';
import { encryptFile } from '@/lib/dm/fileCrypto';
import {
  createLimiter,
  createRumor,
  NIP44_UNSUPPORTED,
  nowSeconds,
  sealRumor,
  unwrapGiftWrap,
  wrapSeal,
} from '@/lib/dm/nip17';
import { DEFAULT_INBOX_RELAYS, uniqueRelays } from '@/lib/dm/relays';
import { type ChatMessage, type Conversation, DM_KIND, type ReactionGroup, type Rumor, VISIBLE_KINDS } from '@/lib/dm/types';
import { displayName } from '@/lib/format';
import {
  decryptGroupState,
  fromHex,
  GROUP_STATE_D,
  GROUP_STATE_KIND,
  type GroupKeyring,
  type GroupKeys,
  type GroupState,
  type GroupView,
  buildInviteLink,
  GROUP_JOIN_CONTENT,
  GROUP_JOIN_TAG,
  type GroupInvite,
  inviteTags,
  isActiveGroup,
  isGroupInvite,
  isGroupJoin,
  loadKeyring,
  mergeInvite,
  newKeypair,
  parseInvite,
  saveKeyring,
  signGroupState,
} from '@/lib/groups/groups';
import { playMessageSound } from '@/lib/sounds';

const TWO_DAYS = 2 * 24 * 60 * 60;
const BUZZ_COOLDOWN_MS = 8000;
const NIP17_KINDS: ReadonlySet<number> = new Set([DM_KIND.chat, DM_KIND.file, DM_KIND.reaction, DM_KIND.deletion]);

/* -------------------------------------------------------------------------- */
/*                               Message store                                */
/* -------------------------------------------------------------------------- */

/** Holds every decrypted message; batches notifications so bursts render once. */
class MessageStore {
  private messages = new Map<string, ChatMessage>();
  private snapshot: ChatMessage[] = [];
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.snapshot;

  get(id: string): ChatMessage | undefined {
    return this.messages.get(id);
  }

  upsert(messages: ChatMessage[], immediate = false) {
    if (messages.length === 0) return;
    for (const message of messages) {
      const previous = this.messages.get(message.id);
      this.messages.set(message.id, previous ? { ...previous, ...message } : message);
    }
    this.emit(immediate);
  }

  patch(id: string, patch: Partial<ChatMessage>) {
    const previous = this.messages.get(id);
    if (!previous) return;
    this.messages.set(id, { ...previous, ...patch });
    this.emit(true);
  }

  remove(id: string) {
    if (this.messages.delete(id)) this.emit(true);
  }

  private emit(immediate: boolean) {
    if (immediate) {
      if (this.timer) clearTimeout(this.timer);
      this.flush();
      return;
    }
    this.timer ??= setTimeout(this.flush, 80);
  }

  private flush = () => {
    this.timer = undefined;
    this.snapshot = [...this.messages.values()];
    for (const listener of this.listeners) listener();
  };
}

/* -------------------------------------------------------------------------- */
/*                             Per-user preferences                           */
/* -------------------------------------------------------------------------- */

interface DMPrefs {
  /** conversationId -> unix seconds the chat was last read. */
  read: Record<string, number>;
  muted: string[];
  pinned: string[];
  /** When this account was first opened on this device; older messages count as read. */
  firstSeen: number;
}

const prefsSchema = z.object({
  read: z.record(z.string(), z.number()),
  muted: z.array(z.string()),
  pinned: z.array(z.string()),
  firstSeen: z.number(),
});

const prefsKey = (pubkey: string) => `nostr-buzz:dm-prefs:${pubkey}`;

function loadPrefs(pubkey: string | undefined): DMPrefs {
  const fallback: DMPrefs = { read: {}, muted: [], pinned: [], firstSeen: nowSeconds() };
  if (!pubkey) return fallback;
  try {
    const raw = localStorage.getItem(prefsKey(pubkey));
    if (raw) return prefsSchema.parse(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage: start fresh.
  }
  return fallback;
}

function savePrefs(pubkey: string, prefs: DMPrefs) {
  try {
    localStorage.setItem(prefsKey(pubkey), JSON.stringify(prefs));
  } catch {
    // Storage full or blocked; prefs are a convenience.
  }
}

/* -------------------------------------------------------------------------- */
/*                         Building conversations                             */
/* -------------------------------------------------------------------------- */

function byTime(a: ChatMessage, b: ChatMessage) {
  return a.created_at - b.created_at || a.id.localeCompare(b.id);
}

function normalizeReaction(content: string): string | undefined {
  const value = content.trim();
  if (value === '' || value === '+') return '👍';
  if (value === '-') return undefined;
  return [...value].slice(0, 8).join('');
}

function emptyConversation(id: string, me: string): Conversation {
  const participants = participantsFromConversationId(id);
  return {
    id,
    participants,
    isSelf: id === me,
    isGroup: participants.length > 1,
    messages: [],
    reactions: new Map(),
    editedIds: new Set(),
    lastActivity: 0,
    unreadCount: 0,
    isRequest: false,
    usesLegacy: false,
  };
}

/** A nostr.buzz group the user is in: its keys plus what the UI shows. */
interface GroupContext {
  keys: GroupKeys;
  view: GroupView;
}

function buildConversation(
  id: string,
  list: ChatMessage[],
  me: string,
  follows: ReadonlySet<string>,
  prefs: DMPrefs,
  group?: GroupContext,
): Conversation {
  list.sort(byTime);

  // Deletions only apply to events by the same author (kind 5 semantics).
  const deletions = new Map<string, Set<string>>();
  for (const message of list) {
    if (message.kind !== DM_KIND.deletion) continue;
    for (const [name, value] of message.tags) {
      if (name !== 'e' || !value) continue;
      let authors = deletions.get(value);
      if (!authors) deletions.set(value, (authors = new Set()));
      authors.add(message.pubkey);
    }
  }
  // In nostr.buzz groups, admins can also delete other people's messages.
  const admins = new Set(group?.view.admins ?? []);
  const isDeleted = (message: ChatMessage) => {
    const deleters = deletions.get(message.id);
    if (!deleters) return false;
    if (deleters.has(message.pubkey)) return true;
    for (const pubkey of deleters) if (admins.has(pubkey)) return true;
    return false;
  };

  const messages: ChatMessage[] = [];
  const deletedSlots = new Set<string>();
  for (const message of list) {
    if (!VISIBLE_KINDS.has(message.kind)) continue;
    if (isDeleted(message)) deletedSlots.add(`${message.pubkey}:${message.created_at}`);
    else messages.push(message);
  }

  // An edit = delete + republish with the same timestamp.
  const editedIds = new Set<string>();
  for (const message of messages) {
    if (deletedSlots.has(`${message.pubkey}:${message.created_at}`)) editedIds.add(message.id);
  }

  const reactions = new Map<string, ReactionGroup[]>();
  for (const message of list) {
    if (message.kind !== DM_KIND.reaction || isDeleted(message)) continue;
    const target = [...message.tags].reverse().find(([name, value]) => name === 'e' && value)?.[1];
    const emoji = normalizeReaction(message.content);
    if (!target || !emoji) continue;
    const groups = reactions.get(target) ?? [];
    let group = groups.find((g) => g.emoji === emoji);
    if (!group) {
      group = { emoji, pubkeys: [] };
      groups.push(group);
    }
    if (!group.pubkeys.includes(message.pubkey)) group.pubkeys.push(message.pubkey);
    if (message.pubkey === me) group.mine = message;
    reactions.set(target, groups);
  }

  let subject: string | undefined;
  for (let i = list.length - 1; i >= 0 && !subject; i--) subject = getSubject(list[i]);

  if (group) subject = group.view.name;
  const participants = group
    ? group.view.members.filter((p) => p !== me)
    : participantsFromConversationId(id);
  const isSelf = id === me;
  const lastMessage = messages.at(-1);
  const readAt = Math.max(prefs.read[id] ?? 0, prefs.firstSeen);
  let unreadCount = 0;
  for (const message of messages) {
    if (message.pubkey !== me && message.created_at > readAt) unreadCount++;
  }
  const iParticipated = list.some((message) => message.pubkey === me);

  return {
    id,
    participants,
    isSelf,
    isGroup: group ? true : participants.length > 1,
    messages,
    reactions,
    editedIds,
    lastMessage,
    lastActivity: lastMessage?.created_at ?? group?.keys.joinedAt ?? 0,
    unreadCount,
    subject,
    isRequest: group ? false : !isSelf && !iParticipated && !participants.some((p) => follows.has(p)),
    usesLegacy: list.some((message) => message.protocol === 'nip04'),
    group: group?.view,
  };
}

function buildConversations(
  all: ChatMessage[],
  me: string,
  follows: ReadonlySet<string>,
  prefs: DMPrefs,
  legacy: boolean,
  groupContexts: ReadonlyMap<string, GroupContext>,
): Conversation[] {
  const buckets = new Map<string, ChatMessage[]>();
  for (const message of all) {
    if (!legacy && message.protocol === 'nip04') continue;
    // Group key backups the user sends to themselves stay out of "Saved messages".
    if (message.conversationId === me && isGroupInvite(message)) continue;
    if (message.via) {
      const group = groupContexts.get(message.conversationId);
      // A group we left, or a message sent with a key retired by a member removal.
      if (!group) continue;
      const retiredAt = group.keys.epochs[message.via]?.retiredAt;
      if (retiredAt !== undefined && message.created_at > retiredAt + 60) continue;
      // Muted members can't post: hide anything they sent after being muted.
      const mutedAt = group.view.muted[message.pubkey];
      if (mutedAt !== undefined && message.created_at >= mutedAt) continue;
    }
    let list = buckets.get(message.conversationId);
    if (!list) buckets.set(message.conversationId, (list = []));
    list.push(message);
  }

  const conversations: Conversation[] = [];
  for (const [id, list] of buckets) {
    const group = groupContexts.get(id);
    const conversation = buildConversation(id, list, me, follows, prefs, group);
    if (conversation.messages.length > 0 || group) conversations.push(conversation);
  }
  // Groups show up in the list even before the first message.
  for (const [id, group] of groupContexts) {
    if (!buckets.has(id)) conversations.push(buildConversation(id, [], me, follows, prefs, group));
  }

  const pinned = new Map(prefs.pinned.map((id, index) => [id, index]));
  return conversations.sort((a, b) => {
    const pa = pinned.get(a.id);
    const pb = pinned.get(b.id);
    if (pa !== undefined || pb !== undefined) {
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pa - pb;
    }
    return b.lastActivity - a.lastActivity;
  });
}

/* -------------------------------------------------------------------------- */
/*                                 Decryption                                 */
/* -------------------------------------------------------------------------- */

async function decryptEvent(signer: NostrSigner, event: NostrEvent, me: string): Promise<ChatMessage | undefined> {
  if (event.kind === 1059) {
    if (!event.tags.some(([name, value]) => name === 'p' && value === me)) return undefined;
    const rumor = await unwrapGiftWrap(signer, event);
    if (!NIP17_KINDS.has(rumor.kind)) return undefined;
    const participants = getParticipants(rumor);
    if (!participants.includes(me) || participants.length > MAX_GROUP_PARTICIPANTS + 1) return undefined;
    return { ...rumor, protocol: 'nip17', conversationId: conversationIdFromParticipants(participants, me) };
  }

  if (event.kind === DM_KIND.legacy) {
    if (!signer.nip04) return undefined;
    const recipient = event.tags.find(([name]) => name === 'p')?.[1];
    if (!recipient || (event.pubkey !== me && recipient !== me)) return undefined;
    const other = event.pubkey === me ? recipient : event.pubkey;
    const content = await signer.nip04.decrypt(other, event.content);
    return {
      id: event.id,
      pubkey: event.pubkey,
      created_at: event.created_at,
      kind: DM_KIND.legacy,
      tags: event.tags.filter(([name]) => name === 'p' || name === 'e' || name === 't'),
      content,
      protocol: 'nip04',
      conversationId: other === me ? me : other,
    };
  }

  return undefined;
}

type NostrPool = ReturnType<typeof useNostr>['nostr'];

/**
 * Keep a live subscription open (reconnecting if needed) and page through history.
 * Resolves once history is loaded; the live part runs until `signal` aborts.
 */
async function streamFeed(
  nostr: NostrPool,
  opts: {
    relays: string[];
    signal: AbortSignal;
    history: NostrFilter[];
    live: NostrFilter[];
    isKnown: (id: string) => boolean;
    onEvent: (event: NostrEvent) => void | Promise<void>;
  },
): Promise<void> {
  const { relays, signal } = opts;
  void (async () => {
    while (!signal.aborted) {
      try {
        for await (const msg of nostr.req(opts.live, { signal, relays })) {
          if (msg[0] === 'EVENT') void opts.onEvent(msg[2]);
        }
      } catch {
        // Connection dropped; retry below.
      }
      if (signal.aborted) break;
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  })();

  for (const filter of opts.history) {
    let until: number | undefined;
    for (let page = 0; page < 12 && !signal.aborted; page++) {
      const events = await nostr.query([{ ...filter, limit: 300, ...(until !== undefined ? { until } : {}) }], {
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
        relays,
      });
      if (signal.aborted || events.length === 0) break;
      const fresh = events.filter((event) => !opts.isKnown(event.id));
      await Promise.all(fresh.map((event) => opts.onEvent(event)));
      if (fresh.length === 0) break;
      const oldest = Math.min(...events.map((event) => event.created_at));
      if (until !== undefined && oldest >= until) break;
      until = oldest - 1;
    }
  }
}

function showNotification(title: string, body: string, tag: string, onClick: () => void) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const notification = new Notification(title, { body, tag, icon: '/icons/icon-192.png' });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker.
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Provider                                  */
/* -------------------------------------------------------------------------- */

export function DMProvider({ children }: { children: ReactNode }) {
  const { user } = useCurrentUser();
  // Remount the engine per account so no state leaks between logins.
  return (
    <DMEngine key={user?.pubkey ?? 'anonymous'} user={user}>
      {children}
    </DMEngine>
  );
}

function DMEngine({ user, children }: { user: NUser | undefined; children: ReactNode }) {
  const me = user?.pubkey;
  const { nostr } = useNostr();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { config } = useAppContext();
  const { settings } = useChatSettings();
  const { triggerBuzz } = useBuzz();
  const discoveryRelays = useDiscoveryRelays();
  const follows = useFollows(me);
  const myRelays = useQuery({ ...dmRelayInfoQueryOptions(nostr, me ?? '', discoveryRelays), enabled: !!me });

  const [store] = useState(() => new MessageStore());
  // Start reading the on-device cache right away so chats render before any relay answers.
  const [cachedRecords] = useState(() => (me ? loadCachedMessages(me) : Promise.resolve([])));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [status, setStatus] = useState<DMStatus>(me ? 'loading' : 'idle');
  const [prefs, setPrefs] = useState<DMPrefs>(() => loadPrefs(me));
  const [activeConversationId, setActiveConversationId] = useState<string>();
  /** Keys for nostr.buzz groups (persisted; also restored from invites in DM history). */
  const [keyring, setKeyring] = useState<GroupKeyring>(() => loadKeyring(me));
  /** Latest decrypted state per group (`removed` when it's encrypted for a key we don't have). */
  const [groupStates, setGroupStates] = useState<Map<string, GroupState | 'removed'>>(() => new Map());
  /** created_at of the newest group state applied, per group. */
  const groupStateAt = useRef(new Map<string, number>());

  /** Gift wrap / kind 4 ids already handled this session (or cached). */
  const knownIds = useRef(new Set<string>());
  /** Signed kind 4 events kept around so failed legacy sends can be retried. */
  const legacyEvents = useRef(new Map<string, NostrEvent>());
  const seenBuzzes = useRef(new Set<string>());
  const lastBuzzAt = useRef(new Map<string, number>());
  const startedAt = useRef(0);

  useEffect(() => {
    if (me) savePrefs(me, prefs);
  }, [me, prefs]);

  useEffect(() => {
    if (me) saveKeyring(me, keyring);
  }, [me, keyring]);

  const activeGroups = useMemo(() => Object.values(keyring).filter(isActiveGroup), [keyring]);

  /** People who joined a group with an invite link (announced through the current key). */
  const groupJoiners = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const message of snapshot) {
      if (!message.via || !isGroupJoin(message)) continue;
      if (keyring[message.conversationId]?.current !== message.via) continue;
      const list = map.get(message.conversationId) ?? [];
      if (!list.includes(message.pubkey)) list.push(message.pubkey);
      map.set(message.conversationId, list);
    }
    return map;
  }, [snapshot, keyring]);

  const groupContexts = useMemo(() => {
    const map = new Map<string, GroupContext>();
    for (const keys of activeGroups) {
      const state = groupStates.get(keys.id);
      const current = state && state !== 'removed' ? state : undefined;
      const muted = current?.muted ?? {};
      map.set(keys.id, {
        keys,
        view: {
          id: keys.id,
          name: current?.name ?? keys.name ?? 'Group',
          about: current?.about,
          picture: current?.picture,
          members: [...new Set([...(current?.members ?? (me ? [me] : [])), ...(groupJoiners.get(keys.id) ?? [])])],
          admins: current?.admins ?? [],
          muted,
          pinned: current?.pinned ?? [],
          // Admin = holds the group key and is still listed as an admin.
          isAdmin: !!keys.identitySecret && (!current || (!!me && current.admins.includes(me))),
          isMuted: !!me && muted[me] !== undefined,
          removed: state === 'removed',
          loaded: state !== undefined,
        },
      });
    }
    return map;
  }, [activeGroups, groupStates, groupJoiners, me]);

  /** Apply a group state event if it's newer than what we have. */
  const applyGroupState = useCallback((event: NostrEvent, keys: GroupKeys) => {
    if (event.created_at < (groupStateAt.current.get(event.pubkey) ?? 0)) return;
    groupStateAt.current.set(event.pubkey, event.created_at);
    const result = decryptGroupState(event, keys);
    setGroupStates((previous) => new Map(previous).set(event.pubkey, result));
    // Remember the latest name so the chat list shows it right away next time.
    if (result !== 'removed') {
      setKeyring((current) =>
        current[event.pubkey] && current[event.pubkey].name !== result.name
          ? { ...current, [event.pubkey]: { ...current[event.pubkey], name: result.name } }
          : current,
      );
    }
  }, []);

  const rememberInvites = useCallback((messages: ChatMessage[]) => {
    const invites = messages.map(parseInvite).filter((invite) => invite !== undefined);
    if (invites.length > 0) setKeyring((current) => invites.reduce(mergeInvite, current));
  }, []);

  const followSet = useMemo(() => new Set(follows.data ?? []), [follows.data]);

  const writeRelays = useMemo(
    () => uniqueRelays(config.relayMetadata.relays.filter((relay) => relay.write).map((relay) => relay.url)),
    [config.relayMetadata],
  );

  const inboxRelays = myRelays.data?.inbox;
  const readRelaysKey = useMemo(
    () =>
      uniqueRelays([
        ...(inboxRelays?.length ? inboxRelays : DEFAULT_INBOX_RELAYS),
        ...config.relayMetadata.relays.filter((relay) => relay.read).map((relay) => relay.url),
      ]).join('|'),
    [inboxRelays, config.relayMetadata],
  );

  const conversations = useMemo(
    () => (me ? buildConversations(snapshot, me, followSet, prefs, settings.legacyDMs, groupContexts) : []),
    [snapshot, me, followSet, prefs, settings.legacyDMs, groupContexts],
  );

  const conversationMap = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);

  /* ----------------------------- incoming events ---------------------------- */

  const handleIncoming = useEffectEvent((message: ChatMessage) => {
    if (!me || message.pubkey === me) return;
    const now = nowSeconds();
    // Only react to messages that arrived "live", not to history.
    const isFresh = message.created_at >= startedAt.current - 45 && message.created_at >= now - 120;
    if (!isFresh || prefs.muted.includes(message.conversationId)) return;

    const conversation = conversationMap.get(message.conversationId);
    const mutedAt = conversation?.group?.muted[message.pubkey];
    if (mutedAt !== undefined && message.created_at >= mutedAt) return;
    const isKnown =
      followSet.has(message.pubkey) || (conversation ? !conversation.isRequest : false);
    const author = queryClient.getQueryData<{ metadata?: NostrMetadata }>(['nostr', 'author', message.pubkey]);
    const name = displayName(message.pubkey, author?.metadata);
    const open = () => navigate(conversationRoute(message.conversationId));

    if (isBuzz(message)) {
      if (seenBuzzes.current.has(message.id)) return;
      seenBuzzes.current.add(message.id);
      if (!isKnown && !settings.buzzFromStrangers) return;
      triggerBuzz({ from: message.pubkey, conversationId: message.conversationId });
      if (document.visibilityState === 'hidden' && settings.notifications) {
        showNotification(`🐝 ${name}`, 'BUZZ!!!', message.conversationId, open);
      }
      return;
    }

    if (!VISIBLE_KINDS.has(message.kind) || !isKnown || isGroupJoin(message)) return;
    const visible = document.visibilityState === 'visible';
    if (visible && activeConversationId === message.conversationId) return;
    if (settings.messageSound) playMessageSound();
    if (!visible && settings.notifications) {
      const body = settings.notificationPreviews ? messagePreview(message) : 'New message';
      showNotification(name, body, message.conversationId, open);
    }
  });

  /* ------------------------ load history + live updates --------------------- */

  // Hydrate from IndexedDB immediately (doesn't wait for relay discovery).
  useEffect(() => {
    if (!me) return;
    let cancelled = false;
    void cachedRecords.then((records) => {
      if (cancelled) return;
      for (const record of records) knownIds.current.add(record.eventId);
      const messages = records.map((record) => record.message);
      store.upsert(messages, true);
      rememberInvites(messages);
      if (records.length > 0) setStatus('ready');
    });
    return () => {
      cancelled = true;
    };
  }, [me, cachedRecords, store, rememberInvites]);

  useEffect(() => {
    if (!user || !me || myRelays.isLoading) return;

    const signer = user.signer;
    const controller = new AbortController();
    const { signal } = controller;
    const relays = readRelaysKey.split('|').filter(Boolean);
    const limit = createLimiter(user.method === 'nsec' ? 8 : 3);
    const legacy = settings.legacyDMs;
    const pendingCache: { eventId: string; message: ChatMessage }[] = [];

    const flushCache = () => {
      if (pendingCache.length > 0) void saveCachedMessages(me, pendingCache.splice(0));
    };
    const flushTimer = setInterval(flushCache, 1500);
    startedAt.current = nowSeconds();

    const process = async (event: NostrEvent) => {
      if (knownIds.current.has(event.id)) return;
      knownIds.current.add(event.id);
      try {
        const message = await limit(() => decryptEvent(signer, event, me));
        if (!message || signal.aborted) return;
        pendingCache.push({ eventId: event.id, message });
        store.upsert([message]);
        rememberInvites([message]);
        handleIncoming(message);
      } catch (error) {
        if (!signal.aborted) console.debug('Could not decrypt DM', event.id, error);
      }
    };

    const paginate = async (filter: NostrFilter) => {
      let until: number | undefined;
      for (let page = 0; page < 12 && !signal.aborted; page++) {
        const events = await nostr.query([{ ...filter, limit: 300, ...(until !== undefined ? { until } : {}) }], {
          signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
          relays,
        });
        if (signal.aborted || events.length === 0) break;
        const fresh = events.filter((event) => !knownIds.current.has(event.id));
        await Promise.all(fresh.map(process));
        // Everything older is already cached from a previous session.
        if (fresh.length === 0) break;
        const oldest = Math.min(...events.map((event) => event.created_at));
        if (until !== undefined && oldest >= until) break;
        until = oldest - 1;
      }
    };

    const subscribe = async () => {
      const filters: NostrFilter[] = [{ kinds: [1059], '#p': [me], since: nowSeconds() - TWO_DAYS - 600 }];
      if (legacy) {
        const since = nowSeconds() - 60;
        filters.push({ kinds: [DM_KIND.legacy], '#p': [me], since }, { kinds: [DM_KIND.legacy], authors: [me], since });
      }
      while (!signal.aborted) {
        try {
          for await (const msg of nostr.req(filters, { signal, relays })) {
            if (msg[0] === 'EVENT') void process(msg[2]);
          }
        } catch {
          // Connection dropped; retry below.
        }
        if (signal.aborted) break;
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    };

    (async () => {
      // Make sure cached gift wraps are marked as known before asking relays.
      const cached = await cachedRecords;
      if (signal.aborted) return;
      for (const record of cached) knownIds.current.add(record.eventId);

      void subscribe();

      const jobs = [paginate({ kinds: [1059], '#p': [me] })];
      if (legacy) {
        jobs.push(paginate({ kinds: [DM_KIND.legacy], '#p': [me] }), paginate({ kinds: [DM_KIND.legacy], authors: [me] }));
      }
      await Promise.allSettled(jobs);
      flushCache();
      if (!signal.aborted) setStatus('ready');
    })();

    return () => {
      controller.abort();
      clearInterval(flushTimer);
      flushCache();
    };
  }, [user, me, myRelays.isLoading, readRelaysKey, settings.legacyDMs, nostr, store, cachedRecords, rememberInvites]);

  /* ------------------------------ group messages ----------------------------- */

  // Restart the group feed only when the set of group keys or relays changes.
  const groupFeedKey = useMemo(
    () =>
      JSON.stringify(
        activeGroups
          .map((keys) => [keys.id, Object.keys(keys.epochs).sort(), keys.relays])
          .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      ),
    [activeGroups],
  );
  const readActiveGroups = useEffectEvent(() => activeGroups);

  useEffect(() => {
    if (!me || groupFeedKey === '[]') return;
    const groups = readActiveGroups();
    const controller = new AbortController();
    const { signal } = controller;

    // Every epoch key we hold (old ones too, for history) → which group and how to decrypt.
    const epochs = new Map<string, { groupId: string; signer: NSecSigner }>();
    for (const keys of groups) {
      for (const [epoch, { secret }] of Object.entries(keys.epochs)) {
        epochs.set(epoch, { groupId: keys.id, signer: new NSecSigner(fromHex(secret)) });
      }
    }
    const byId = new Map(groups.map((keys) => [keys.id, keys]));
    const relays = uniqueRelays([...groups.flatMap((keys) => keys.relays), ...DEFAULT_INBOX_RELAYS]);
    const groupIds = groups.map((keys) => keys.id);
    const pendingCache: { eventId: string; message: ChatMessage }[] = [];
    const flushCache = () => {
      if (pendingCache.length > 0) void saveCachedMessages(me, pendingCache.splice(0));
    };
    const flushTimer = setInterval(flushCache, 1500);

    const onEvent = async (event: NostrEvent) => {
      if (event.kind === GROUP_STATE_KIND) {
        const keys = byId.get(event.pubkey);
        if (keys) applyGroupState(event, keys);
        return;
      }
      if (event.kind !== 1059 || knownIds.current.has(event.id)) return;
      knownIds.current.add(event.id);
      const epoch = event.tags.find(([name, value]) => name === 'p' && value && epochs.has(value))?.[1];
      const target = epoch ? epochs.get(epoch) : undefined;
      if (!epoch || !target) return;
      try {
        const rumor = await unwrapGiftWrap(target.signer, event);
        if (!NIP17_KINDS.has(rumor.kind)) return;
        if (!rumor.tags.some(([name, value]) => name === 'p' && value === target.groupId)) return;
        const message: ChatMessage = { ...rumor, protocol: 'nip17', conversationId: target.groupId, via: epoch };
        if (signal.aborted) return;
        pendingCache.push({ eventId: event.id, message });
        store.upsert([message]);
        handleIncoming(message);
      } catch (error) {
        if (!signal.aborted) console.debug('Could not decrypt group message', event.id, error);
      }
    };

    void (async () => {
      const cached = await cachedRecords;
      for (const record of cached) knownIds.current.add(record.eventId);
      if (signal.aborted) return;

      const states = await nostr.query(
        [{ kinds: [GROUP_STATE_KIND], authors: groupIds, '#d': [GROUP_STATE_D] }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), relays },
      );
      for (const event of states.sort((a, b) => a.created_at - b.created_at)) await onEvent(event);

      await streamFeed(nostr, {
        relays,
        signal,
        history: [{ kinds: [1059], '#p': [...epochs.keys()] }],
        live: [
          { kinds: [1059], '#p': [...epochs.keys()], since: nowSeconds() - TWO_DAYS - 600 },
          { kinds: [GROUP_STATE_KIND], authors: groupIds, '#d': [GROUP_STATE_D], since: nowSeconds() - 5 },
        ],
        isKnown: (id) => knownIds.current.has(id),
        onEvent,
      });
      flushCache();
    })();

    return () => {
      controller.abort();
      clearInterval(flushTimer);
      flushCache();
    };
  }, [me, groupFeedKey, nostr, store, cachedRecords, applyGroupState]);

  /* ---------------------------------- sending -------------------------------- */

  const relaysFor = useCallback(
    async (pubkey: string, legacy = false): Promise<string[]> => {
      try {
        const info = await queryClient.fetchQuery(dmRelayInfoQueryOptions(nostr, pubkey, discoveryRelays));
        if (!legacy && info.inbox.length > 0) return info.inbox;
        if (info.nip65Read.length > 0) return uniqueRelays([...info.nip65Read, ...DEFAULT_INBOX_RELAYS]);
        if (info.inbox.length > 0) return info.inbox;
      } catch {
        // Fall through to defaults.
      }
      return uniqueRelays([...DEFAULT_INBOX_RELAYS, ...writeRelays]);
    },
    [queryClient, nostr, discoveryRelays, writeRelays],
  );

  /** Seal + gift wrap a rumor for every recipient (including ourselves) and publish. */
  const deliver = useCallback(
    async (rumor: Rumor, conversationId: string): Promise<boolean> => {
      if (!user || !me) return false;
      const signer = user.signer;
      store.patch(rumor.id, { status: 'sending' });

      const others = participantsFromConversationId(conversationId).filter((p) => p !== me);
      const recipients = [...others, me];
      let selfWrapId: string | undefined;

      const results = await Promise.allSettled(
        recipients.map(async (recipient) => {
          if (!signer.nip44) throw new Error(NIP44_UNSUPPORTED);
          const seal = await sealRumor(signer, rumor, recipient);
          const wrap = wrapSeal(seal, recipient);
          if (recipient === me) {
            knownIds.current.add(wrap.id);
            selfWrapId = wrap.id;
          }
          const relays = await relaysFor(recipient);
          await nostr.event(wrap, { relays, signal: AbortSignal.timeout(15_000) });
        }),
      );

      const delivered = results.every((result, index) =>
        // Self-copy failures only matter for "Saved messages".
        recipients[index] === me && others.length > 0 ? true : result.status === 'fulfilled',
      );
      if (!delivered) {
        const failure = results.find((result) => result.status === 'rejected');
        console.warn('DM delivery failed', failure && 'reason' in failure ? failure.reason : undefined);
      }

      store.patch(rumor.id, { status: delivered ? 'sent' : 'failed' });
      const stored = store.get(rumor.id);
      if (delivered && stored) {
        void saveCachedMessages(me, [{ eventId: selfWrapId ?? `local:${rumor.id}`, message: stored }]);
      }
      return delivered;
    },
    [user, me, store, relaysFor, nostr],
  );

  /** nostr.buzz groups: one gift wrap to the group's current epoch key reaches every member. */
  const deliverGroup = useCallback(
    async (rumor: Rumor, groupId: string, override?: GroupKeys): Promise<boolean> => {
      const keys = override ?? keyring[groupId];
      if (!user || !me || !isActiveGroup(keys)) return false;
      const signer = user.signer;
      store.patch(rumor.id, { status: 'sending' });
      try {
        if (!signer.nip44) throw new Error(NIP44_UNSUPPORTED);
        const seal = await sealRumor(signer, rumor, keys.current);
        const wrap = wrapSeal(seal, keys.current);
        knownIds.current.add(wrap.id);
        const relays = uniqueRelays([...keys.relays, ...DEFAULT_INBOX_RELAYS]).slice(0, 6);
        await nostr.event(wrap, { relays, signal: AbortSignal.timeout(15_000) });
        store.patch(rumor.id, { status: 'sent' });
        const stored = store.get(rumor.id);
        if (stored) void saveCachedMessages(me, [{ eventId: wrap.id, message: stored }]);
        return true;
      } catch (error) {
        console.warn('Group delivery failed', error);
        store.patch(rumor.id, { status: 'failed' });
        return false;
      }
    },
    [user, me, keyring, store, nostr],
  );

  const sendRumor = useCallback(
    async (
      conversationId: string,
      kind: number,
      content: string,
      extraTags: string[][],
      opts?: { createdAt?: number; local?: Partial<ChatMessage> },
    ): Promise<boolean> => {
      if (!me) throw new Error('You need to be logged in.');
      const groupKeys = keyring[conversationId];
      if (isActiveGroup(groupKeys)) {
        const rumor = createRumor({
          pubkey: me,
          kind,
          content,
          tags: [['p', conversationId], ...extraTags],
          created_at: opts?.createdAt,
        });
        store.upsert(
          [{ ...rumor, protocol: 'nip17', conversationId, via: groupKeys.current, status: 'sending', ...opts?.local }],
          true,
        );
        return deliverGroup(rumor, conversationId);
      }
      const others = participantsFromConversationId(conversationId).filter((p) => p !== me);
      const pTags = (others.length > 0 ? others : [me]).map((p) => ['p', p]);
      const rumor = createRumor({ pubkey: me, kind, content, tags: [...pTags, ...extraTags], created_at: opts?.createdAt });
      store.upsert([{ ...rumor, protocol: 'nip17', conversationId, status: 'sending', ...opts?.local }], true);
      return deliver(rumor, conversationId);
    },
    [me, keyring, store, deliver, deliverGroup],
  );

  const publishLegacy = useCallback(
    async (event: NostrEvent, other: string) => {
      if (!me) return;
      store.patch(event.id, { status: 'sending' });
      try {
        const relays = uniqueRelays([...(await relaysFor(other, true)), ...writeRelays]);
        await nostr.event(event, { relays, signal: AbortSignal.timeout(15_000) });
        store.patch(event.id, { status: 'sent' });
        const stored = store.get(event.id);
        if (stored) void saveCachedMessages(me, [{ eventId: event.id, message: stored }]);
      } catch (error) {
        console.warn('Legacy DM delivery failed', error);
        store.patch(event.id, { status: 'failed' });
      }
    },
    [me, store, relaysFor, writeRelays, nostr],
  );

  /** NIP-04 reply for 1:1 chats whose other side is still on legacy DMs. */
  const sendLegacy = useCallback(
    async (other: string, content: string, extraTags: string[][]) => {
      if (!user || !me) return;
      const signer = user.signer;
      if (!signer.nip04) throw new Error('Your signer does not support NIP-04 encryption.');
      const ciphertext = await signer.nip04.encrypt(other, content);
      const event = await signer.signEvent({
        kind: DM_KIND.legacy,
        content: ciphertext,
        tags: [['p', other], ...extraTags],
        created_at: nowSeconds(),
      });
      knownIds.current.add(event.id);
      legacyEvents.current.set(event.id, event);
      store.upsert(
        [
          {
            id: event.id,
            pubkey: me,
            created_at: event.created_at,
            kind: DM_KIND.legacy,
            tags: event.tags,
            content,
            protocol: 'nip04',
            conversationId: other,
            status: 'sending',
          },
        ],
        true,
      );
      await publishLegacy(event, other);
    },
    [user, me, store, publishLegacy],
  );

  const shouldUseLegacy = useCallback(
    (conversationId: string): boolean => {
      const conversation = conversationMap.get(conversationId);
      if (!conversation || conversation.isGroup || conversation.isSelf) return false;
      const lastIncoming = conversation.messages.findLast((message) => message.pubkey !== me);
      return lastIncoming?.protocol === 'nip04';
    },
    [conversationMap, me],
  );

  const sendText = useCallback(
    async (conversationId: string, content: string, opts?: SendOptions) => {
      const text = content.trim();
      if (!text) return;
      const tags: string[][] = [];
      if (opts?.replyTo) tags.push(['e', opts.replyTo.id]);
      if (opts?.subject) tags.push(['subject', opts.subject]);
      if (shouldUseLegacy(conversationId)) {
        await sendLegacy(conversationId, text, opts?.replyTo ? [['e', opts.replyTo.id]] : []);
        return;
      }
      await sendRumor(conversationId, DM_KIND.chat, text, tags);
    },
    [shouldUseLegacy, sendLegacy, sendRumor],
  );

  const sendBuzz = useCallback(
    async (conversationId: string) => {
      const now = Date.now();
      if (now - (lastBuzzAt.current.get(conversationId) ?? 0) < BUZZ_COOLDOWN_MS) return;
      lastBuzzAt.current.set(conversationId, now);
      triggerBuzz({ outgoing: true });
      if (shouldUseLegacy(conversationId)) {
        await sendLegacy(conversationId, BUZZ_CONTENT, [['t', BUZZ_TAG]]);
        return;
      }
      await sendRumor(conversationId, DM_KIND.chat, BUZZ_CONTENT, [['t', BUZZ_TAG]]);
    },
    [triggerBuzz, shouldUseLegacy, sendLegacy, sendRumor],
  );

  const sendFile = useCallback(
    async (conversationId: string, file: File, opts?: SendOptions) => {
      if (!user || !me) throw new Error('You need to be logged in.');
      const tempId = `local-${crypto.randomUUID()}`;
      const previewUrl = URL.createObjectURL(file);
      const local = { localPreviewUrl: previewUrl, localPreviewType: file.type };
      store.upsert(
        [
          {
            id: tempId,
            pubkey: me,
            created_at: nowSeconds(),
            kind: DM_KIND.file,
            tags: [
              ['file-type', file.type || 'application/octet-stream'],
              ['size', String(file.size)],
            ],
            content: '',
            protocol: 'nip17',
            conversationId,
            status: 'sending',
            ...local,
          },
        ],
        true,
      );

      try {
        const encrypted = await encryptFile(file);
        const servers = getEffectiveBlossomServers(config.blossomServerMetadata, config.useAppBlossomServers);
        const uploader = new BlossomUploader({ servers, signer: user.signer });
        const [[, url]] = await uploader.upload(encrypted.encrypted);
        store.remove(tempId);

        const tags: string[][] = [
          ['file-type', encrypted.mimeType],
          ['encryption-algorithm', 'aes-gcm'],
          ['decryption-key', encrypted.key],
          ['decryption-nonce', encrypted.nonce],
          ['x', encrypted.x],
          ['ox', encrypted.ox],
          ['size', String(encrypted.size)],
        ];
        if (encrypted.dim) tags.push(['dim', encrypted.dim]);
        if (opts?.replyTo) tags.push(['e', opts.replyTo.id, '', 'reply']);
        if (opts?.subject) tags.push(['subject', opts.subject]);
        await sendRumor(conversationId, DM_KIND.file, url, tags, { local });
      } catch (error) {
        store.patch(tempId, { status: 'failed' });
        throw error;
      }
    },
    [user, me, store, config.blossomServerMetadata, config.useAppBlossomServers, sendRumor],
  );

  const toggleReaction = useCallback(
    async (target: ChatMessage, emoji: string) => {
      const groups = conversationMap.get(target.conversationId)?.reactions.get(target.id);
      const mine = groups?.find((group) => group.emoji === emoji)?.mine;
      const ok = mine
        ? await sendRumor(target.conversationId, DM_KIND.deletion, '', [
            ['e', mine.id],
            ['k', String(DM_KIND.reaction)],
          ])
        : await sendRumor(target.conversationId, DM_KIND.reaction, emoji, [
            ['e', target.id],
            ['k', String(target.kind)],
          ]);
      if (!ok) throw new Error('Reaction could not be delivered.');
    },
    [conversationMap, sendRumor],
  );

  const deleteMessage = useCallback(
    async (target: ChatMessage) => {
      const group = conversationMap.get(target.conversationId)?.group;
      const canModerate = !!group?.isAdmin && !group.removed;
      if ((target.pubkey !== me && !canModerate) || target.protocol !== 'nip17') return;
      if (target.id.startsWith('local-')) {
        store.remove(target.id);
        return;
      }
      const ok = await sendRumor(target.conversationId, DM_KIND.deletion, '', [
        ['e', target.id],
        ['k', String(target.kind)],
      ]);
      if (!ok) throw new Error('Delete could not be delivered.');
    },
    [me, conversationMap, store, sendRumor],
  );

  const editMessage = useCallback(
    async (target: ChatMessage, content: string) => {
      const text = content.trim();
      if (!text || target.pubkey !== me || target.kind !== DM_KIND.chat || target.protocol !== 'nip17') return;
      if (text === target.content) return;
      const keep = target.tags.filter(([name]) => name !== 'p');
      await sendRumor(target.conversationId, DM_KIND.deletion, '', [
        ['e', target.id],
        ['k', String(target.kind)],
      ]);
      await sendRumor(target.conversationId, DM_KIND.chat, text, keep, { createdAt: target.created_at });
    },
    [me, sendRumor],
  );

  const retryMessage = useCallback(
    async (message: ChatMessage) => {
      if (message.id.startsWith('local-')) return;
      if (message.protocol === 'nip04') {
        const event = legacyEvents.current.get(message.id);
        if (event) await publishLegacy(event, message.conversationId);
        return;
      }
      const rumor: Rumor = {
        id: message.id,
        pubkey: message.pubkey,
        created_at: message.created_at,
        kind: message.kind,
        tags: message.tags,
        content: message.content,
      };
      if (message.via) await deliverGroup(rumor, message.conversationId);
      else await deliver(rumor, message.conversationId);
    },
    [publishLegacy, deliver, deliverGroup],
  );

  const discardMessage = useCallback(
    (message: ChatMessage) => {
      if (message.status !== 'failed') return;
      if (message.localPreviewUrl) URL.revokeObjectURL(message.localPreviewUrl);
      store.remove(message.id);
    },
    [store],
  );

  /* ---------------------------------- groups --------------------------------- */

  const publishGroupState = useCallback(
    async (keys: GroupKeys, state: GroupState) => {
      if (!keys.identitySecret) throw new Error('Only admins can edit this group.');
      const event = signGroupState(keys.identitySecret, state);
      await nostr.event(event, {
        relays: uniqueRelays([...keys.relays, ...DEFAULT_INBOX_RELAYS]),
        signal: AbortSignal.timeout(12_000),
      });
      applyGroupState(event, keys);
    },
    [nostr, applyGroupState],
  );

  /** Send a member (or ourselves, as a key backup) the keys for a group over NIP-17. */
  const sendGroupInvite = useCallback(
    (to: string, keys: GroupKeys, name: string, withAdminKey: boolean) => {
      const tags = inviteTags({
        groupId: keys.id,
        epochSecret: keys.epochs[keys.current].secret,
        identitySecret: withAdminKey ? keys.identitySecret : undefined,
        relays: keys.relays,
        name,
      });
      const content = to === me ? `🔑 Keys for the group "${name}"` : `📨 You're invited to "${name}" on nostr.buzz`;
      return sendRumor(to, DM_KIND.chat, content, tags);
    },
    [me, sendRumor],
  );

  const requireAdmin = useCallback(
    (groupId: string): { keys: GroupKeys; state: GroupState } => {
      const keys = keyring[groupId];
      const state = groupStates.get(groupId);
      if (!isActiveGroup(keys) || !keys.identitySecret) throw new Error('Only admins can edit this group.');
      if (!state || state === 'removed') throw new Error('Group info is still loading.');
      if (!me || !state.admins.includes(me)) throw new Error('Only admins can edit this group.');
      return { keys, state };
    },
    [me, keyring, groupStates],
  );

  /** Promote or demote an admin. New admins get the group key over NIP-17. */
  const setGroupAdmin = useCallback(
    async (groupId: string, pubkey: string, admin: boolean) => {
      const { keys, state } = requireAdmin(groupId);
      if (!state.members.includes(pubkey)) throw new Error('Not a member of this group.');
      const admins = admin ? [...new Set([...state.admins, pubkey])] : state.admins.filter((p) => p !== pubkey);
      if (admins.length === 0) throw new Error('A group needs at least one admin.');
      const muted = { ...state.muted };
      if (admin) delete muted[pubkey];
      await publishGroupState(keys, { ...state, admins, muted, updatedAt: Math.max(nowSeconds(), state.updatedAt + 1) });
      if (admin && pubkey !== me) await sendGroupInvite(pubkey, keys, state.name, true);
    },
    [me, requireAdmin, publishGroupState, sendGroupInvite],
  );

  /** Pin or unpin a message for everyone in the group. */
  const setGroupPinned = useCallback(
    async (groupId: string, messageId: string, pin: boolean) => {
      const { keys, state } = requireAdmin(groupId);
      const current = state.pinned ?? [];
      const pinned = pin ? [messageId, ...current.filter((id) => id !== messageId)].slice(0, 20) : current.filter((id) => id !== messageId);
      await publishGroupState(keys, { ...state, pinned, updatedAt: Math.max(nowSeconds(), state.updatedAt + 1) });
    },
    [requireAdmin, publishGroupState],
  );

  /** Stop (or allow) a member from sending messages. */
  const setGroupMuted = useCallback(
    async (groupId: string, pubkey: string, mute: boolean) => {
      const { keys, state } = requireAdmin(groupId);
      if (mute && state.admins.includes(pubkey)) throw new Error('Remove admin rights first.');
      const now = Math.max(nowSeconds(), state.updatedAt + 1);
      const muted = { ...state.muted };
      if (mute) muted[pubkey] = now;
      else delete muted[pubkey];
      await publishGroupState(keys, { ...state, muted, updatedAt: now });
    },
    [requireAdmin, publishGroupState],
  );

  const createGroup = useCallback(
    async (input: { name: string; members: string[]; about?: string; picture?: string }) => {
      if (!me) throw new Error('You need to be logged in.');
      const identity = newKeypair();
      const epoch = newKeypair();
      const now = nowSeconds();
      const name = input.name.trim().slice(0, 80) || 'New group';
      const keys: GroupKeys = {
        id: identity.pubkey,
        identitySecret: identity.secret,
        current: epoch.pubkey,
        epochs: { [epoch.pubkey]: { secret: epoch.secret, since: now } },
        relays: uniqueRelays([...(inboxRelays ?? []), ...DEFAULT_INBOX_RELAYS]).slice(0, 4),
        name,
        joinedAt: now,
      };
      const members = [...new Set([me, ...input.members])];
      setKeyring((current) => ({ ...current, [keys.id]: keys }));
      await publishGroupState(keys, {
        name,
        about: input.about,
        picture: input.picture,
        members,
        admins: [me],
        epoch: epoch.pubkey,
        updatedAt: now,
      });
      await Promise.allSettled([
        sendGroupInvite(me, keys, name, true),
        ...members.filter((p) => p !== me).map((p) => sendGroupInvite(p, keys, name, false)),
      ]);
      return keys.id;
    },
    [me, inboxRelays, publishGroupState, sendGroupInvite],
  );

  const updateGroup = useCallback(
    async (groupId: string, patch: { name?: string; about?: string; picture?: string }) => {
      const { keys, state } = requireAdmin(groupId);
      const name = patch.name !== undefined ? patch.name.trim().slice(0, 80) || state.name : state.name;
      await publishGroupState(keys, {
        ...state,
        ...patch,
        name,
        updatedAt: Math.max(nowSeconds(), state.updatedAt + 1),
      });
      setKeyring((current) => (current[groupId] ? { ...current, [groupId]: { ...current[groupId], name } } : current));
    },
    [requireAdmin, publishGroupState],
  );

  const addGroupMembers = useCallback(
    async (groupId: string, pubkeys: string[]) => {
      const { keys, state } = requireAdmin(groupId);
      const added = pubkeys.filter((p) => !state.members.includes(p));
      if (added.length === 0) return;
      await publishGroupState(keys, {
        ...state,
        members: [...state.members, ...added],
        updatedAt: Math.max(nowSeconds(), state.updatedAt + 1),
      });
      await Promise.allSettled(added.map((p) => sendGroupInvite(p, keys, state.name, false)));
    },
    [requireAdmin, publishGroupState, sendGroupInvite],
  );

  /**
   * Rotate the shared key: everyone still in the group gets the new one, so old invite
   * links (and `removed`, if given) can't read new messages.
   */
  const rotateGroup = useCallback(
    async (groupId: string, removed?: string) => {
      const { keys, state } = requireAdmin(groupId);
      if (removed === me) throw new Error('Use "Leave group" to leave.');
      // Include people who joined by link but aren't in the saved member list yet.
      const known = [...new Set([...state.members, ...(groupContexts.get(groupId)?.view.members ?? [])])];
      const epoch = newKeypair();
      const now = Math.max(nowSeconds(), state.updatedAt + 1);
      const epochs = Object.fromEntries(
        Object.entries(keys.epochs).map(([key, value]) => [key, value.retiredAt ? value : { ...value, retiredAt: now }]),
      );
      const nextKeys: GroupKeys = { ...keys, current: epoch.pubkey, epochs: { ...epochs, [epoch.pubkey]: { secret: epoch.secret, since: now } } };
      const nextState: GroupState = {
        ...state,
        members: known.filter((p) => p !== removed),
        admins: state.admins.filter((p) => p !== removed),
        epoch: epoch.pubkey,
        updatedAt: now,
      };
      setKeyring((current) => ({ ...current, [groupId]: nextKeys }));
      await publishGroupState(nextKeys, nextState);
      await Promise.allSettled([
        sendGroupInvite(me ?? '', nextKeys, nextState.name, true),
        ...nextState.members.filter((p) => p !== me).map((p) => sendGroupInvite(p, nextKeys, nextState.name, false)),
      ]);
    },
    [me, requireAdmin, groupContexts, publishGroupState, sendGroupInvite],
  );

  const removeGroupMember = useCallback((groupId: string, pubkey: string) => rotateGroup(groupId, pubkey), [rotateGroup]);

  /** Admins: make every existing invite link stop working. */
  const resetInviteLink = useCallback((groupId: string) => rotateGroup(groupId), [rotateGroup]);

  /** Any member can share a link to join the group (it carries the current group key). */
  const getInviteLink = useCallback(
    (groupId: string) => {
      const keys = keyring[groupId];
      if (!isActiveGroup(keys)) return undefined;
      const name = groupContexts.get(groupId)?.view.name ?? keys.name;
      return buildInviteLink(window.location.origin, { ...keys, name });
    },
    [keyring, groupContexts],
  );

  /** Join a group from an invite link and say hello so everyone sees the new member. */
  const joinGroup = useCallback(
    async (invite: GroupInvite) => {
      if (!me) throw new Error('You need to be logged in.');
      const existing = keyring[invite.groupId];
      if (isActiveGroup(existing) && existing.epochs[invite.epochPubkey]) return invite.groupId;
      const keys = mergeInvite(keyring, invite)[invite.groupId];
      setKeyring((current) => mergeInvite(current, invite));
      const rumor = createRumor({
        pubkey: me,
        kind: DM_KIND.chat,
        content: GROUP_JOIN_CONTENT,
        tags: [
          ['p', invite.groupId],
          ['t', GROUP_JOIN_TAG],
        ],
      });
      store.upsert([{ ...rumor, protocol: 'nip17', conversationId: invite.groupId, via: keys.current, status: 'sending' }], true);
      await deliverGroup(rumor, invite.groupId, keys);
      return invite.groupId;
    },
    [me, keyring, store, deliverGroup],
  );

  // Admins: write people who joined by link into the encrypted member list.
  const acceptedJoins = useRef(new Set<string>());
  useEffect(() => {
    for (const [groupId, group] of groupContexts) {
      const state = groupStates.get(groupId);
      if (!group.view.isAdmin || !state || state === 'removed') continue;
      const missing = group.view.members.filter((p) => !state.members.includes(p)).sort();
      if (missing.length === 0) continue;
      const key = `${groupId}:${state.updatedAt}:${missing.join(',')}`;
      if (acceptedJoins.current.has(key)) continue;
      acceptedJoins.current.add(key);
      void publishGroupState(group.keys, {
        ...state,
        members: [...state.members, ...missing],
        updatedAt: Math.max(nowSeconds(), state.updatedAt + 1),
      }).catch(() => acceptedJoins.current.delete(key));
    }
  }, [groupContexts, groupStates, publishGroupState]);

  const leaveGroup = useCallback((groupId: string) => {
    setKeyring((current) =>
      current[groupId] ? { ...current, [groupId]: { ...current[groupId], leftAt: nowSeconds() } } : current,
    );
  }, []);

  /* ---------------------------------- prefs ---------------------------------- */

  const markRead = useCallback((conversationId: string) => {
    const now = nowSeconds();
    setPrefs((current) => {
      if ((current.read[conversationId] ?? 0) >= now) return current;
      return { ...current, read: { ...current.read, [conversationId]: now } };
    });
  }, []);

  const toggleMute = useCallback((conversationId: string) => {
    setPrefs((current) => ({
      ...current,
      muted: current.muted.includes(conversationId)
        ? current.muted.filter((id) => id !== conversationId)
        : [...current.muted, conversationId],
    }));
  }, []);

  const togglePin = useCallback((conversationId: string) => {
    setPrefs((current) => ({
      ...current,
      pinned: current.pinned.includes(conversationId)
        ? current.pinned.filter((id) => id !== conversationId)
        : [conversationId, ...current.pinned],
    }));
  }, []);

  const clearLocalCache = useCallback(async () => {
    if (!me) return;
    await clearCachedMessages(me);
    window.location.reload();
  }, [me]);

  /* --------------------------------- context --------------------------------- */

  const getConversation = useCallback(
    (id: string) => conversationMap.get(id) ?? emptyConversation(id, me ?? ''),
    [conversationMap, me],
  );

  const value = useMemo<DMContextValue>(() => {
    let totalUnread = 0;
    let requestCount = 0;
    for (const conversation of conversations) {
      if (conversation.isRequest) requestCount++;
      else if (!prefs.muted.includes(conversation.id)) totalUnread += conversation.unreadCount;
    }
    return {
      enabled: !!me,
      status,
      canEncrypt: !!user?.signer.nip44,
      conversations,
      totalUnread,
      requestCount,
      getConversation,
      activeConversationId,
      setActiveConversationId,
      sendText,
      sendBuzz,
      sendFile,
      toggleReaction,
      deleteMessage,
      editMessage,
      retryMessage,
      discardMessage,
      markRead,
      isMuted: (id) => prefs.muted.includes(id),
      toggleMute,
      isPinned: (id) => prefs.pinned.includes(id),
      togglePin,
      clearLocalCache,
      createGroup,
      updateGroup,
      addGroupMembers,
      removeGroupMember,
      leaveGroup,
      setGroupAdmin,
      setGroupMuted,
      getInviteLink,
      resetInviteLink,
      joinGroup,
      setGroupPinned,
    };
  }, [
    me,
    user,
    status,
    conversations,
    prefs,
    getConversation,
    activeConversationId,
    sendText,
    sendBuzz,
    sendFile,
    toggleReaction,
    deleteMessage,
    editMessage,
    retryMessage,
    discardMessage,
    markRead,
    toggleMute,
    togglePin,
    clearLocalCache,
    createGroup,
    updateGroup,
    addGroupMembers,
    removeGroupMember,
    leaveGroup,
    setGroupAdmin,
    setGroupMuted,
    getInviteLink,
    resetInviteLink,
    joinGroup,
    setGroupPinned,
  ]);

  return <DMContext.Provider value={value}>{children}</DMContext.Provider>;
}
