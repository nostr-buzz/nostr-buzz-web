import type { NostrEvent } from '@nostrify/nostrify';
import { finalizeEvent, generateSecretKey, getPublicKey, nip44 } from 'nostr-tools';
import { z } from 'zod';

import { uniqueRelays } from '@/lib/dm/relays';

/**
 * nostr.buzz groups with their own npub.
 *
 * - identity key: the group's permanent npub. Held by admins; signs the group state.
 * - epoch key: shared with all members (via NIP-17 invites). Messages are gift-wrapped
 *   to the epoch pubkey, so every member can read them. Removing a member rotates it.
 * - state: kind 30078 (d = "nostr-buzz-group") signed by the identity key, content
 *   NIP-44 encrypted between the identity key and the current epoch key.
 */

export const GROUP_STATE_KIND = 30078;
export const GROUP_STATE_D = 'nostr-buzz-group';
export const GROUP_INVITE_TAG = 'buzz-group-invite';

const HEX64 = /^[0-9a-f]{64}$/;

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function newKeypair(): { secret: string; pubkey: string } {
  const secret = generateSecretKey();
  return { secret: toHex(secret), pubkey: getPublicKey(secret) };
}

export function pubkeyOf(secretHex: string): string {
  return getPublicKey(fromHex(secretHex));
}

/* -------------------------------------------------------------------------- */
/*                                   Keyring                                  */
/* -------------------------------------------------------------------------- */

export interface GroupEpoch {
  secret: string;
  /** When this epoch was introduced (unix seconds). */
  since: number;
  /** When a newer epoch replaced it; later messages through it are ignored. */
  retiredAt?: number;
}

export interface GroupKeys {
  id: string;
  /** Identity secret: only admins have it. */
  identitySecret?: string;
  current: string;
  epochs: Record<string, GroupEpoch>;
  relays: string[];
  name?: string;
  joinedAt: number;
  leftAt?: number;
}

export type GroupKeyring = Record<string, GroupKeys>;

const epochSchema = z.object({ secret: z.string().regex(HEX64), since: z.number(), retiredAt: z.number().optional() });
const keysSchema = z.object({
  id: z.string().regex(HEX64),
  identitySecret: z.string().regex(HEX64).optional(),
  current: z.string().regex(HEX64),
  epochs: z.record(z.string(), epochSchema),
  relays: z.array(z.string()),
  name: z.string().optional(),
  joinedAt: z.number(),
  leftAt: z.number().optional(),
});
const keyringSchema = z.record(z.string(), keysSchema);

const keyringKey = (pubkey: string) => `nostr-buzz:groups:${pubkey}`;

export function loadKeyring(pubkey: string | undefined): GroupKeyring {
  if (!pubkey) return {};
  try {
    const raw = localStorage.getItem(keyringKey(pubkey));
    if (raw) return keyringSchema.parse(JSON.parse(raw));
  } catch {
    // Corrupt storage: keys come back from the invites in DM history.
  }
  return {};
}

export function saveKeyring(pubkey: string, keyring: GroupKeyring) {
  try {
    localStorage.setItem(keyringKey(pubkey), JSON.stringify(keyring));
  } catch {
    // Storage blocked: invites in DM history still restore the keys.
  }
}

export function isActiveGroup(keys: GroupKeys | undefined): keys is GroupKeys {
  return !!keys && !keys.leftAt;
}

/* -------------------------------------------------------------------------- */
/*                                   Invites                                  */
/* -------------------------------------------------------------------------- */

export interface GroupInvite {
  groupId: string;
  epochSecret: string;
  epochPubkey: string;
  identitySecret?: string;
  relays: string[];
  name?: string;
  createdAt: number;
}

export function inviteTags(params: {
  groupId: string;
  epochSecret: string;
  identitySecret?: string;
  relays: string[];
  name: string;
}): string[][] {
  return [
    ['t', GROUP_INVITE_TAG],
    ['group', params.groupId],
    ['group-name', params.name],
    ['group-key', params.epochSecret],
    ...(params.identitySecret ? [['group-admin-key', params.identitySecret]] : []),
    ...params.relays.map((url) => ['relay', url]),
  ];
}

export function isGroupInvite(message: { tags: string[][] }): boolean {
  return message.tags.some(([name, value]) => name === 't' && value === GROUP_INVITE_TAG);
}

const tagValue = (tags: string[][], name: string) => tags.find(([n]) => n === name)?.[1];

export function parseInvite(message: { tags: string[][]; created_at: number }): GroupInvite | undefined {
  if (!isGroupInvite(message)) return undefined;
  const groupId = tagValue(message.tags, 'group');
  const epochSecret = tagValue(message.tags, 'group-key');
  if (!groupId || !HEX64.test(groupId) || !epochSecret || !HEX64.test(epochSecret)) return undefined;
  let identitySecret = tagValue(message.tags, 'group-admin-key');
  try {
    if (identitySecret && (!HEX64.test(identitySecret) || pubkeyOf(identitySecret) !== groupId)) identitySecret = undefined;
    return {
      groupId,
      epochSecret,
      epochPubkey: pubkeyOf(epochSecret),
      identitySecret,
      relays: uniqueRelays(message.tags.filter(([n]) => n === 'relay').map(([, url]) => url ?? '')).slice(0, 5),
      name: tagValue(message.tags, 'group-name')?.slice(0, 80),
      createdAt: message.created_at,
    };
  } catch {
    return undefined;
  }
}

/** Add an invite's keys to the keyring. Returns the same object when nothing changed. */
export function mergeInvite(keyring: GroupKeyring, invite: GroupInvite): GroupKeyring {
  const existing = keyring[invite.groupId];
  const epochs: Record<string, GroupEpoch> = { ...(existing?.epochs ?? {}) };
  if (!epochs[invite.epochPubkey]) epochs[invite.epochPubkey] = { secret: invite.epochSecret, since: invite.createdAt };

  // The newest epoch is current; each older one retires when the next one appears.
  const ordered = Object.entries(epochs).sort((a, b) => a[1].since - b[1].since);
  ordered.forEach(([key, epoch], index) => {
    const next = ordered[index + 1];
    epochs[key] = next ? { ...epoch, retiredAt: next[1].since } : { secret: epoch.secret, since: epoch.since };
  });

  const rejoined = existing?.leftAt !== undefined && invite.createdAt > existing.leftAt;
  const next: GroupKeys = {
    id: invite.groupId,
    identitySecret: existing?.identitySecret ?? invite.identitySecret,
    current: ordered[ordered.length - 1][0],
    epochs,
    relays: invite.relays.length > 0 ? invite.relays : (existing?.relays ?? []),
    name: invite.name ?? existing?.name,
    joinedAt: existing?.joinedAt ?? invite.createdAt,
    leftAt: rejoined ? undefined : existing?.leftAt,
  };
  if (existing && JSON.stringify(existing) === JSON.stringify(next)) return keyring;
  return { ...keyring, [invite.groupId]: next };
}

/* -------------------------------------------------------------------------- */
/*                                    State                                   */
/* -------------------------------------------------------------------------- */

export interface GroupState {
  name: string;
  about?: string;
  picture?: string;
  members: string[];
  admins: string[];
  epoch: string;
  updatedAt: number;
}

const stateSchema = z.object({
  name: z.string().max(120),
  about: z.string().max(1000).optional(),
  picture: z.string().max(2000).optional(),
  members: z.array(z.string().regex(HEX64)).max(200),
  admins: z.array(z.string().regex(HEX64)),
  epoch: z.string().regex(HEX64),
  updatedAt: z.number(),
});

/** Sign the group state with the identity key, encrypted for the state's epoch. */
export function signGroupState(identitySecret: string, state: GroupState): NostrEvent {
  const key = nip44.v2.utils.getConversationKey(fromHex(identitySecret), state.epoch);
  return finalizeEvent(
    {
      kind: GROUP_STATE_KIND,
      created_at: state.updatedAt,
      tags: [
        ['d', GROUP_STATE_D],
        ['alt', 'Encrypted nostr.buzz group info'],
      ],
      content: nip44.v2.encrypt(JSON.stringify(state), key),
    },
    fromHex(identitySecret),
  );
}

/** Decrypt a group state with any epoch key we hold. `removed` = encrypted for an epoch we don't have. */
export function decryptGroupState(event: NostrEvent, keys: GroupKeys): GroupState | 'removed' {
  const epochs = [keys.current, ...Object.keys(keys.epochs).filter((key) => key !== keys.current)];
  for (const epoch of epochs) {
    const secret = keys.epochs[epoch]?.secret;
    if (!secret) continue;
    try {
      const key = nip44.v2.utils.getConversationKey(fromHex(secret), event.pubkey);
      const state = stateSchema.parse(JSON.parse(nip44.v2.decrypt(event.content, key)));
      return { ...state, updatedAt: event.created_at };
    } catch {
      // Try the next epoch.
    }
  }
  return 'removed';
}

/** What the UI needs to know about a group. */
export interface GroupView {
  id: string;
  name: string;
  about?: string;
  picture?: string;
  members: string[];
  admins: string[];
  isAdmin: boolean;
  /** The current state is encrypted for a newer key: we were removed. */
  removed: boolean;
  /** The state has been fetched at least once. */
  loaded: boolean;
}
