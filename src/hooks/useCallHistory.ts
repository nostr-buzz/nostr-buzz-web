import { useMemo } from 'react';

import { useCurrentUser } from '@/hooks/useCurrentUser';
import { isCallOffer, isVideoCall } from '@/lib/calls/protocol';
import type { ChatMessage, Conversation } from '@/lib/dm/types';

export interface CallEntry {
  message: ChatMessage;
  peer: string;
  outgoing: boolean;
  video: boolean;
}

const MAX_ENTRIES = 100;

/** Every call in one-to-one chats, newest first. */
export function useCallHistory(conversations: Conversation[]): CallEntry[] {
  const { user } = useCurrentUser();
  const me = user?.pubkey;
  return useMemo(() => {
    const entries: CallEntry[] = [];
    for (const conversation of conversations) {
      if (conversation.isGroup || conversation.isSelf || conversation.isRequest) continue;
      const peer = conversation.participants[0];
      if (!peer) continue;
      for (const message of conversation.messages) {
        if (isCallOffer(message)) entries.push({ message, peer, outgoing: message.pubkey === me, video: isVideoCall(message) });
      }
    }
    return entries.sort((a, b) => b.message.created_at - a.message.created_at).slice(0, MAX_ENTRIES);
  }, [conversations, me]);
}
