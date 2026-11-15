import { useContext, useMemo } from 'react';

import { DMContext, type DMContextValue } from '@/contexts/DMContext';
import type { Conversation } from '@/lib/dm/types';

export function useDM(): DMContextValue {
  const context = useContext(DMContext);
  if (!context) throw new Error('useDM must be used inside <DMProvider>');
  return context;
}

/** A single conversation by id (an empty one for brand-new chats). */
export function useConversation(id: string | undefined): Conversation | undefined {
  const { getConversation } = useDM();
  return useMemo(() => (id ? getConversation(id) : undefined), [getConversation, id]);
}
