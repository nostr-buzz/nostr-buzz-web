import type { NostrMetadata } from '@nostrify/nostrify';
import { useNostrLogin } from '@nostrify/react/login';
import { useQueryClient } from '@tanstack/react-query';
import { nip19 } from 'nostr-tools';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';

import { useChatSettings } from '@/hooks/useChatSettings';
import type { Conversation } from '@/lib/dm/types';
import { displayName } from '@/lib/format';
import { type GroupKeys, type GroupView, toHex } from '@/lib/groups/groups';
import {
  getDelivery,
  isIOS,
  isStandalone,
  notificationPermission,
  notificationsSupported,
  PUSH_NAVIGATE_EVENT,
  PUSH_SERVER,
  type PushDelivery,
  setUnreadBadge,
  subscribeDelivery,
  syncPush,
  writePushState,
} from '@/lib/push/client';
import type { PushState } from '@/lib/push/store';

const MAX_NAMES = 400;
/** The push server accepts at most this many relays per device. */
const MAX_PUSH_RELAYS = 8;

interface PushSyncInput {
  /** Active account, if any. */
  me: string | undefined;
  conversations: Conversation[];
  follows: ReadonlySet<string>;
  /** Muted conversation ids. */
  muted: string[];
  /** Groups the user is in. */
  groups: ReadonlyMap<string, { keys: GroupKeys; view: GroupView }>;
  /** Relays the app reads DMs from. */
  relays: string[];
  totalUnread: number;
}

/** The secret key of an nsec login (already stored on this device), as hex. */
function useLocalSecret(me: string | undefined): string | undefined {
  const { logins } = useNostrLogin();
  return useMemo(() => {
    const login = logins[0];
    if (!me || !login || login.pubkey !== me || login.type !== 'nsec') return undefined;
    try {
      const decoded = nip19.decode(login.data.nsec);
      return decoded.type === 'nsec' ? toHex(decoded.data) : undefined;
    } catch {
      return undefined;
    }
  }, [logins, me]);
}

/**
 * Keeps notifications working for the signed-in account: mirrors what the service worker
 * needs to decrypt and label a push, registers this device with the push server, opens
 * chats tapped in a notification and keeps the app icon badge current.
 */
export function usePushSync({ me, conversations, follows, muted, groups, relays, totalUnread }: PushSyncInput): void {
  const { settings } = useChatSettings();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const secret = useLocalSecret(me);

  // A tapped notification asks the already open app to show a chat.
  useEffect(() => {
    const listener = (event: Event) => {
      const url = (event as CustomEvent<unknown>).detail;
      if (typeof url === 'string') navigate(url);
    };
    window.addEventListener(PUSH_NAVIGATE_EVENT, listener);
    return () => window.removeEventListener(PUSH_NAVIGATE_EVENT, listener);
  }, [navigate]);

  // Mirror account context for the service worker.
  useEffect(() => {
    if (!me) {
      void writePushState(undefined);
      return;
    }
    const timer = setTimeout(() => {
      const names: PushState['names'] = {};
      const known = new Set(follows);
      const remember = (pubkey: string) => {
        if (names[pubkey] || Object.keys(names).length >= MAX_NAMES) return;
        const metadata = queryClient.getQueryData<{ metadata?: NostrMetadata }>(['nostr', 'author', pubkey])?.metadata;
        names[pubkey] = { name: displayName(pubkey, metadata), picture: metadata?.picture };
      };
      for (const conversation of conversations) {
        if (conversation.isRequest) continue;
        for (const pubkey of conversation.participants) {
          known.add(pubkey);
          remember(pubkey);
        }
      }

      const groupKeys: PushState['groups'] = {};
      const groupMuted: PushState['groupMuted'] = {};
      for (const [groupId, { keys, view }] of groups) {
        names[groupId] = { name: view.name, picture: view.picture };
        groupMuted[groupId] = view.muted;
        for (const [epoch, value] of Object.entries(keys.epochs)) {
          groupKeys[epoch] = { secret: value.secret, groupId, retiredAt: value.retiredAt };
        }
      }

      void writePushState({
        me,
        secret,
        enabled: settings.notifications,
        previews: settings.notificationPreviews,
        sound: settings.notificationSound,
        buzzFromStrangers: settings.buzzFromStrangers,
        muted,
        known: [...known],
        names,
        groups: groupKeys,
        groupMuted,
      });
    }, 800);
    return () => clearTimeout(timer);
  }, [me, secret, conversations, follows, muted, groups, settings.notifications, settings.notificationPreviews, settings.notificationSound, settings.buzzFromStrangers, queryClient]);

  // What the push server should watch: the user, plus the live key of every unmuted group.
  const target = useMemo(() => {
    if (!me) return undefined;
    const watch = [me];
    const groupRelays: string[] = [];
    for (const [groupId, { keys, view }] of groups) {
      if (view.removed || muted.includes(groupId)) continue;
      watch.push(keys.current);
      groupRelays.push(...keys.relays);
    }
    return JSON.stringify({
      enabled: settings.notifications,
      push: settings.pushNotifications,
      owner: me,
      watch,
      relays: [...new Set([...relays, ...groupRelays])].slice(0, MAX_PUSH_RELAYS),
      legacy: settings.legacyDMs,
    });
  }, [me, groups, muted, relays, settings.notifications, settings.pushNotifications, settings.legacyDMs]);

  useEffect(() => {
    const timer = setTimeout(() => void syncPush(target ? JSON.parse(target) : undefined), target ? 1500 : 0);
    return () => clearTimeout(timer);
  }, [target]);

  useEffect(() => {
    setUnreadBadge(me ? totalUnread : 0);
  }, [me, totalUnread]);
}

function subscribePermission(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  window.addEventListener('focus', listener);
  return () => {
    document.removeEventListener('visibilitychange', listener);
    window.removeEventListener('focus', listener);
  };
}

export interface PushStatus {
  /** This browser can show notifications at all. */
  supported: boolean;
  /** iPhone / iPad in a browser tab: notifications need the app on the home screen. */
  needsInstall: boolean;
  permission: NotificationPermission;
  delivery: PushDelivery;
  /** This build knows a push server (required for notifications with the app closed). */
  serverConfigured: boolean;
}

export function usePushStatus(): PushStatus {
  const delivery = useSyncExternalStore(subscribeDelivery, getDelivery, getDelivery);
  const permission = useSyncExternalStore(subscribePermission, notificationPermission, () => 'default' as const);
  const supported = notificationsSupported();
  return {
    supported,
    needsInstall: !supported && isIOS() && !isStandalone(),
    permission,
    delivery,
    serverConfigured: PUSH_SERVER !== '',
  };
}
