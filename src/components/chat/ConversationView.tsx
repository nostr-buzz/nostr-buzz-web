import { ImageUp, Pin, X } from 'lucide-react';
import { type DragEvent, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

import { Composer } from '@/components/chat/Composer';
import { ConversationHeader } from '@/components/chat/ConversationHeader';
import { MessageList } from '@/components/chat/MessageList';
import { ProfileSheet } from '@/components/chat/ProfileSheet';
import { AuthorName } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import { useConversation, useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import { JUMP_TO_MESSAGE_EVENT, messagePreview } from '@/lib/dm/conversation';
import type { ChatMessage, Conversation } from '@/lib/dm/types';
import { cn } from '@/lib/utils';

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
      <PinnedBar conversation={displayed} />
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

/** Telegram-style bar with the group's pinned messages. Tap to jump; it cycles through pins. */
function PinnedBar({ conversation }: { conversation: Conversation }) {
  const { setGroupPinned } = useDM();
  const { toast } = useToast();
  const [index, setIndex] = useState(0);
  const group = conversation.group;
  if (!group || group.pinned.length === 0) return null;

  const pinned = group.pinned
    .map((id) => conversation.messages.find((message) => message.id === id))
    .filter((message): message is ChatMessage => message !== undefined);
  if (pinned.length === 0) return null;

  const current = index % pinned.length;
  const message = pinned[current];

  const jump = () => {
    window.dispatchEvent(new CustomEvent(JUMP_TO_MESSAGE_EVENT, { detail: message.id }));
    setIndex(current + 1);
  };

  const unpin = () => {
    setGroupPinned(group.id, message.id, false).catch((error: unknown) =>
      toast({ title: 'Could not unpin', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }),
    );
  };

  return (
    <div className="z-[5] flex items-center gap-2 border-b bg-background/85 px-3 py-1.5 backdrop-blur-md md:px-4">
      <button type="button" onClick={jump} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg py-1 text-left">
        <span className="flex h-9 flex-col gap-0.5" aria-hidden="true">
          {pinned.slice(0, 4).map((item, i) => (
            <span key={item.id} className={cn('w-0.5 flex-1 rounded-full', i === current % 4 ? 'bg-primary' : 'bg-muted-foreground/30')} />
          ))}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-semibold text-amber-700 dark:text-amber-400">
            Pinned{pinned.length > 1 ? ` ${current + 1}/${pinned.length}` : ''}
          </span>
          <span className="block truncate text-sm" dir="auto">
            <AuthorName pubkey={message.pubkey} className="font-medium" />: {messagePreview(message)}
          </span>
        </span>
      </button>
      {group.isAdmin ? (
        <Button variant="ghost" size="icon-sm" className="shrink-0 rounded-full text-muted-foreground" aria-label="Unpin" onClick={unpin}>
          <X />
        </Button>
      ) : (
        <Pin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}
