import type { GroupView } from '@/lib/groups/groups';

/** Which DM scheme a message arrived through. */
export type DMProtocol = 'nip17' | 'nip04';

/** An unsigned Nostr event (a NIP-59 "rumor"). */
export interface Rumor {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

/** Local-only delivery state for messages sent from this device. */
export type DeliveryStatus = 'sending' | 'sent' | 'failed';

/** A decrypted message (or reaction / deletion) that belongs to a conversation. */
export interface ChatMessage extends Rumor {
  protocol: DMProtocol;
  /**
   * Conversation key: the sorted, comma-joined pubkeys of everyone in the room
   * except the current user (or the user's own pubkey for "Saved messages").
   */
  conversationId: string;
  /** Delivery state for messages composed on this device. Never persisted. */
  status?: DeliveryStatus;
  /** For nostr.buzz groups: the epoch pubkey the message was wrapped to. */
  via?: string;
  /** Object URL for a file that is still uploading. Never persisted. */
  localPreviewUrl?: string;
  /** MIME type of a file that is still uploading. Never persisted. */
  localPreviewType?: string;
}

/** Rumor kinds this client understands inside NIP-17 gift wraps. */
export const DM_KIND = {
  legacy: 4,
  deletion: 5,
  reaction: 7,
  chat: 14,
  file: 15,
  /** A voice or video call offer (see lib/calls/protocol.ts). */
  call: 1447,
} as const;

/** Kinds that render as a bubble in the timeline. */
export const VISIBLE_KINDS: ReadonlySet<number> = new Set([DM_KIND.legacy, DM_KIND.chat, DM_KIND.file, DM_KIND.call]);

export interface ReactionGroup {
  emoji: string;
  pubkeys: string[];
  /** The current user's reaction rumor for this emoji (used to toggle it off). */
  mine?: ChatMessage;
}

export interface Conversation {
  id: string;
  /** Everyone except the current user (or just the user for "Saved messages"). */
  participants: string[];
  isSelf: boolean;
  isGroup: boolean;
  /** Visible messages, oldest first. Deleted messages are removed and edits applied. */
  messages: ChatMessage[];
  /** Reactions keyed by the id of the message they target. */
  reactions: Map<string, ReactionGroup[]>;
  /** Ids of messages that replaced an earlier (deleted) message with the same timestamp. */
  editedIds: Set<string>;
  lastMessage?: ChatMessage;
  lastActivity: number;
  unreadCount: number;
  subject?: string;
  /**
   * True when the user never replied and follows none of the participants.
   * Shown in the "Requests" tab, and buzzes from them don't shake the app by default.
   */
  isRequest: boolean;
  usesLegacy: boolean;
  /** Set for nostr.buzz groups (groups with their own npub). */
  group?: GroupView;
}
