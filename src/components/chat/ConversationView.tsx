import { ImageUp } from 'lucide-react';
import { type DragEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Composer } from '@/components/chat/Composer';
import { ConversationHeader } from '@/components/chat/ConversationHeader';
import { MessageList } from '@/components/chat/MessageList';
import { ProfileSheet } from '@/components/chat/ProfileSheet';
import { useConversation, useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import type { ChatMessage } from '@/lib/dm/types';

export function ConversationView({ conversationId }: { conversationId: string }) {
  const conversation = useConversation(conversationId);
  const { setActiveConversationId, markRead, sendFile, status, canEncrypt } = useDM();
  const { toast } = useToast();
  const [searchParams] = useSearchParams();
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    setActiveConversationId(conversationId);
    return () => setActiveConversationId(undefined);
  }, [conversationId, setActiveConversationId]);

  const unread = conversation?.unreadCount ?? 0;
  useEffect(() => {
    if (unread === 0) return;
    const mark = () => {
      if (document.visibilityState === 'visible') markRead(conversationId);
    };
    mark();
    document.addEventListener('visibilitychange', mark);
    return () => document.removeEventListener('visibilitychange', mark);
  }, [unread, conversationId, markRead]);

  if (!conversation) return null;

  const subjectParam = searchParams.get('subject')?.trim().slice(0, 80);
  const pendingSubject = !conversation.subject && conversation.isGroup && subjectParam ? subjectParam : undefined;
  const displayed = pendingSubject ? { ...conversation, subject: pendingSubject } : conversation;

  const onDrop = (event: DragEvent) => {
    event.preventDefault();
    setDragging(false);
    if (!canEncrypt) return;
    for (const file of event.dataTransfer.files) {
      sendFile(conversationId, file, { subject: pendingSubject }).catch((error: unknown) =>
        toast({ title: 'Upload failed', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }),
      );
    }
  };

  return (
    <div
      className="chat-wallpaper relative flex h-full min-h-0 flex-1 flex-col"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false);
      }}
      onDrop={onDrop}
    >
      <ConversationHeader conversation={displayed} onOpenInfo={() => setInfoOpen(true)} />
      <MessageList
        conversation={displayed}
        loading={status === 'loading'}
        onReply={(message) => {
          setEditing(null);
          setReplyTo(message);
        }}
        onEdit={(message) => {
          setReplyTo(null);
          setEditing(message);
        }}
      />
      <Composer
        key={`${conversationId}:${editing?.id ?? ''}`}
        conversation={displayed}
        replyTo={replyTo}
        editing={editing}
        onCancelReply={() => setReplyTo(null)}
        onCancelEdit={() => setEditing(null)}
        subject={pendingSubject}
      />
      <ProfileSheet conversation={displayed} open={infoOpen} onOpenChange={setInfoOpen} />

      {dragging && (
        <div className="pointer-events-none absolute inset-3 z-20 flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-primary bg-background/85 backdrop-blur-sm">
          <ImageUp className="size-10 text-amber-600 dark:text-amber-400" />
          <p className="font-display text-lg font-bold">Drop to send</p>
          <p className="text-sm text-muted-foreground">Encrypted before upload</p>
        </div>
      )}
    </div>
  );
}
