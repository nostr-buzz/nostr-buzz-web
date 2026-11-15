import { ArrowDown, Lock } from 'lucide-react';
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { Bee3D } from '@/components/brand/Bee3D';
import { BuzzButton } from '@/components/chat/BuzzButton';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { ConversationAvatar, ConversationTitle } from '@/components/chat/UserAvatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { getReplyTarget, isBuzz } from '@/lib/dm/conversation';
import type { ChatMessage, Conversation } from '@/lib/dm/types';
import { dayKey, formatDayLabel } from '@/lib/format';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 120;
const GROUP_WINDOW = 5 * 60;

interface MessageListProps {
  conversation: Conversation;
  loading: boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
}

function groupsWith(a: ChatMessage | undefined, b: ChatMessage | undefined): boolean {
  if (!a || !b) return false;
  return (
    a.pubkey === b.pubkey &&
    dayKey(a.created_at) === dayKey(b.created_at) &&
    Math.abs(b.created_at - a.created_at) < GROUP_WINDOW &&
    !isBuzz(a) &&
    !isBuzz(b)
  );
}

export function MessageList({ conversation, loading, onReply, onEdit }: MessageListProps) {
  const { user } = useCurrentUser();
  const me = user?.pubkey ?? '';
  const scrollRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const lastIdRef = useRef<string | undefined>(undefined);
  const heightBeforeLoadRef = useRef<number | null>(null);
  const pendingJumpRef = useRef<string | null>(null);

  const messages = conversation.messages;
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [atBottom, setAtBottom] = useState(true);
  const [seenCount, setSeenCount] = useState(messages.length);

  const visible = useMemo(() => messages.slice(-limit), [messages, limit]);
  const byId = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const hasMore = messages.length > visible.length;
  const lastMessage = messages.at(-1);
  const newCount = atBottom ? 0 : Math.max(0, messages.length - seenCount);

  // Keep the view pinned to the newest message (or to the reader's position when loading older ones).
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;

    if (heightBeforeLoadRef.current !== null) {
      element.scrollTop += element.scrollHeight - heightBeforeLoadRef.current;
      heightBeforeLoadRef.current = null;
    }

    const lastId = lastMessage?.id;
    if (lastIdRef.current === undefined) {
      element.scrollTop = element.scrollHeight;
    } else if (lastId !== lastIdRef.current && (atBottomRef.current || lastMessage?.pubkey === me)) {
      element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
    }
    lastIdRef.current = lastId;

    const jump = pendingJumpRef.current;
    if (jump) {
      pendingJumpRef.current = null;
      highlight(jump);
    }
  }, [lastMessage, me, limit]);

  const onScroll = () => {
    const element = scrollRef.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < 96;
    atBottomRef.current = bottom;
    setAtBottom(bottom);
    if (bottom) setSeenCount(messages.length);
    if (element.scrollTop < 240 && hasMore && heightBeforeLoadRef.current === null) {
      heightBeforeLoadRef.current = element.scrollHeight;
      setLimit((current) => current + PAGE_SIZE);
    }
  };

  const scrollToBottom = () => {
    const element = scrollRef.current;
    element?.scrollTo({ top: element.scrollHeight, behavior: 'smooth' });
  };

  const jumpTo = (id: string) => {
    if (document.getElementById(`msg-${id}`)) {
      highlight(id);
      return;
    }
    const index = messages.findIndex((message) => message.id === id);
    if (index === -1) return;
    pendingJumpRef.current = id;
    setLimit(messages.length - index + 10);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full overflow-y-auto overscroll-contain pb-3 scrollbar-thin"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-label="Messages"
      >
        <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-end">
          {hasMore && (
            <div className="flex justify-center py-3">
              <button
                type="button"
                onClick={() => {
                  heightBeforeLoadRef.current = scrollRef.current?.scrollHeight ?? null;
                  setLimit((current) => current + PAGE_SIZE);
                }}
                className="rounded-full bg-background/80 px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm backdrop-blur hover:bg-background"
              >
                Load earlier messages
              </button>
            </div>
          )}

          {loading && messages.length === 0 ? (
            <MessagesSkeleton />
          ) : messages.length === 0 ? (
            <EmptyConversation conversation={conversation} />
          ) : (
            visible.map((message, index) => {
              const previous = visible[index - 1];
              const next = visible[index + 1];
              const newDay = !previous || dayKey(previous.created_at) !== dayKey(message.created_at);
              const replyId = getReplyTarget(message);
              return (
                <Fragment key={message.id}>
                  {newDay && <DaySeparator seconds={message.created_at} />}
                  <MessageBubble
                    message={message}
                    mine={message.pubkey === me}
                    conversation={conversation}
                    first={!groupsWith(previous, message) || newDay}
                    last={!groupsWith(message, next)}
                    replyTarget={replyId ? byId.get(replyId) : undefined}
                    reactions={conversation.reactions.get(message.id)}
                    edited={conversation.editedIds.has(message.id)}
                    onReply={onReply}
                    onEdit={onEdit}
                    onJump={jumpTo}
                  />
                </Fragment>
              );
            })
          )}
        </div>
      </div>

      {!atBottom && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          aria-label={newCount > 0 ? `${newCount} new messages, scroll to bottom` : 'Scroll to bottom'}
          className="absolute right-4 bottom-4 flex size-11 items-center justify-center rounded-full border bg-background text-foreground shadow-lg transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ArrowDown className="size-5" />
          {newCount > 0 && (
            <span className="absolute -top-2 left-1/2 min-w-5 -translate-x-1/2 rounded-full bg-primary px-1.5 text-center text-xs leading-5 font-bold text-primary-foreground">
              {newCount}
            </span>
          )}
        </button>
      )}
    </div>
  );
}

function highlight(id: string) {
  const element = document.getElementById(`msg-${id}`);
  if (!element) return;
  element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  element.classList.remove('highlight-flash');
  void element.offsetWidth;
  element.classList.add('highlight-flash');
}

function DaySeparator({ seconds }: { seconds: number }) {
  return (
    <div className="pointer-events-none sticky top-2 z-[1] flex justify-center py-2">
      <span className="rounded-full bg-background/85 px-3 py-1 text-xs font-semibold text-muted-foreground shadow-sm backdrop-blur">
        {formatDayLabel(seconds)}
      </span>
    </div>
  );
}

function MessagesSkeleton() {
  const rows = [
    { mine: false, width: 'w-48' },
    { mine: false, width: 'w-64' },
    { mine: true, width: 'w-40' },
    { mine: false, width: 'w-56' },
    { mine: true, width: 'w-72' },
    { mine: true, width: 'w-32' },
  ];
  return (
    <div className="space-y-2 px-4 py-4" aria-busy="true" aria-label="Loading messages">
      {rows.map((row, index) => (
        <div key={index} className={cn('flex', row.mine ? 'justify-end' : 'justify-start')}>
          <Skeleton className={cn('h-10 rounded-2xl bg-background/70', row.width)} />
        </div>
      ))}
    </div>
  );
}

function EmptyConversation({ conversation }: { conversation: Conversation }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border bg-background/90 p-6 text-center shadow-sm backdrop-blur">
        {conversation.isSelf ? (
          <Bee3D className="mx-auto size-32" />
        ) : (
          <ConversationAvatar conversation={conversation} className="mx-auto size-20" />
        )}
        <h2 className="mt-4 font-display text-xl font-bold">
          <ConversationTitle conversation={conversation} />
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {conversation.isSelf
            ? 'Private notes only you can read.'
            : 'Say hi 👋 or send a BUZZ!'}
        </p>
        {!conversation.isSelf && <BuzzButton conversationId={conversation.id} variant="large" className="mt-5 w-full" />}
        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Lock className="size-3" /> End-to-end encrypted
        </p>
      </div>
    </div>
  );
}
