import { nip19 } from 'nostr-tools';

import { isGroupInvite } from '@/lib/groups/groups';

import { DM_KIND, type Rumor } from './types';

const HEX64 = /^[0-9a-f]{64}$/;

/** Groups bigger than this should use a different scheme (NIP-17 guidance). */
export const MAX_GROUP_PARTICIPANTS = 10;

export const BUZZ_TAG = 'buzz';
export const BUZZ_CONTENT = 'BUZZ!!! 🐝';

/** Everyone in a NIP-17 room: the author plus every `p` tag. */
export function getParticipants(rumor: Pick<Rumor, 'pubkey' | 'tags'>): string[] {
  const set = new Set<string>([rumor.pubkey]);
  for (const [name, value] of rumor.tags) {
    if (name === 'p' && value && HEX64.test(value)) set.add(value);
  }
  return [...set];
}

/** Stable conversation key for a set of participants, from the current user's point of view. */
export function conversationIdFromParticipants(participants: string[], me: string): string {
  const others = [...new Set(participants.filter((p) => p !== me))].sort();
  return others.length > 0 ? others.join(',') : me;
}

/** The pubkeys a conversation id refers to (other participants, or the user for self-chat). */
export function participantsFromConversationId(id: string): string[] {
  return id.split(',').filter((p) => HEX64.test(p));
}

/** Encode a conversation id for use in a URL: npubs joined by commas. */
export function conversationRoute(id: string): string {
  const npubs = participantsFromConversationId(id).map((p) => nip19.npubEncode(p));
  return `/chat/${npubs.join(',')}`;
}

/** Decode a `/chat/:id` param (npub / nprofile / hex, comma separated) into a conversation id. */
export function conversationIdFromRoute(param: string | undefined, me: string): string | undefined {
  if (!param) return undefined;
  const pubkeys: string[] = [];
  for (const part of decodeURIComponent(param).split(',')) {
    const value = part.trim();
    if (!value) continue;
    if (HEX64.test(value)) {
      pubkeys.push(value);
      continue;
    }
    try {
      const decoded = nip19.decode(value);
      if (decoded.type === 'npub') pubkeys.push(decoded.data);
      else if (decoded.type === 'nprofile') pubkeys.push(decoded.data.pubkey);
      else return undefined;
    } catch {
      return undefined;
    }
  }
  if (pubkeys.length === 0) return undefined;
  const id = conversationIdFromParticipants(pubkeys, me);
  if (participantsFromConversationId(id).length > MAX_GROUP_PARTICIPANTS) return undefined;
  return id;
}

export function isBuzz(message: Pick<Rumor, 'kind' | 'tags'>): boolean {
  return message.kind === DM_KIND.chat && message.tags.some(([name, value]) => name === 't' && value === BUZZ_TAG);
}

/** The id of the message this one replies to (first `e` tag), if any. */
export function getReplyTarget(message: Pick<Rumor, 'tags'>): string | undefined {
  const tag = message.tags.find(([name, value]) => name === 'e' && value && HEX64.test(value));
  return tag?.[1];
}

export function getSubject(message: Pick<Rumor, 'tags'>): string | undefined {
  const subject = message.tags.find(([name]) => name === 'subject')?.[1]?.trim();
  return subject || undefined;
}

export function getTagValue(message: Pick<Rumor, 'tags'>, name: string): string | undefined {
  return message.tags.find(([n]) => n === name)?.[1];
}

/** A short, human preview of a message for chat lists and notifications. */
export function messagePreview(message: Pick<Rumor, 'kind' | 'tags' | 'content'>): string {
  if (isBuzz(message)) return '🐝 BUZZ!!!';
  if (isGroupInvite(message)) return '📨 Group invite';
  if (message.kind === DM_KIND.file) {
    const type = getTagValue(message, 'file-type') ?? '';
    if (type.startsWith('image/')) return '📷 Photo';
    if (type.startsWith('video/')) return '🎬 Video';
    if (type.startsWith('audio/')) return '🎵 Audio';
    return '📎 File';
  }
  const text = message.content.replace(/\s+/g, ' ').trim();
  if (/^https:\/\/\S+\.(?:png|jpe?g|gif|webp|avif)(?:\?\S*)?$/i.test(text)) return '📷 Photo';
  return text;
}
