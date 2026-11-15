import { createContext } from 'react';

import type { ChatMessage, Conversation } from '@/lib/dm/types';

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
}

export const DMContext = createContext<DMContextValue | undefined>(undefined);
