import { createContext } from 'react';

import type { ChatMessage, Conversation } from '@/lib/dm/types';
import type { GroupInvite } from '@/lib/groups/groups';

export type DMStatus = 'idle' | 'loading' | 'ready';

export interface SendOptions {
  replyTo?: ChatMessage;
  /** NIP-17 `subject` (group name) to attach to this message. */
  subject?: string;
}

export interface DMContextValue {
  /** True once a user is logged in. */
  enabled: boolean;
  status: DMStatus;
  /** False when the signer can't do NIP-44 (sending / reading NIP-17 is impossible). */
  canEncrypt: boolean;
  /** Conversations sorted pinned-first, then by last activity. */
  conversations: Conversation[];
  /** Unread messages across non-request, non-muted chats. */
  totalUnread: number;
  /** Number of conversations in the Requests tab. */
  requestCount: number;
  /** Look up a conversation (returns an empty one for new chats). */
  getConversation(id: string): Conversation;

  activeConversationId?: string;
  setActiveConversationId(id: string | undefined): void;

  sendText(conversationId: string, content: string, opts?: SendOptions): Promise<void>;
  sendBuzz(conversationId: string): Promise<void>;
  sendFile(conversationId: string, file: File, opts?: SendOptions): Promise<void>;
  toggleReaction(target: ChatMessage, emoji: string): Promise<void>;
  deleteMessage(target: ChatMessage): Promise<void>;
  editMessage(target: ChatMessage, content: string): Promise<void>;
  retryMessage(message: ChatMessage): Promise<void>;
  /** Drop a failed local message (e.g. an upload that never finished). */
  discardMessage(message: ChatMessage): void;

  markRead(conversationId: string): void;
  isMuted(conversationId: string): boolean;
  toggleMute(conversationId: string): void;
  isPinned(conversationId: string): boolean;
  togglePin(conversationId: string): void;
  /** Forget decrypted messages cached on this device and reload them from relays. */
  clearLocalCache(): Promise<void>;

  /** Create a group with its own npub. Resolves to the group's pubkey. */
  createGroup(input: { name: string; members: string[]; about?: string; picture?: string }): Promise<string>;
  /** Admins only: change the group's name, description or photo. */
  updateGroup(groupId: string, patch: { name?: string; about?: string; picture?: string }): Promise<void>;
  /** Admins only. */
  addGroupMembers(groupId: string, pubkeys: string[]): Promise<void>;
  /** Admins only. Rotates the group key so the removed member can't read new messages. */
  removeGroupMember(groupId: string, pubkey: string): Promise<void>;
  /** Stop showing / receiving a group on this account. */
  leaveGroup(groupId: string): void;
  /** Admins only: make a member an admin (sends them the group key) or remove admin rights. */
  setGroupAdmin(groupId: string, pubkey: string, admin: boolean): Promise<void>;
  /** Admins only: stop or allow a member to send messages. */
  setGroupMuted(groupId: string, pubkey: string, muted: boolean): Promise<void>;
  /** Any member: a link that lets someone join the group. */
  getInviteLink(groupId: string): string | undefined;
  /** Admins only: make all existing invite links stop working (rotates the group key). */
  resetInviteLink(groupId: string): Promise<void>;
  /** Join a group from an invite link. Resolves to the group id. */
  joinGroup(invite: GroupInvite): Promise<string>;
}

export const DMContext = createContext<DMContextValue | undefined>(undefined);
