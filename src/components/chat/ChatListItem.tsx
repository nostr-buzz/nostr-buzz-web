import { AlertCircle, BellOff, Check, CheckCheck, Clock, Pin, PinOff, Bell } from 'lucide-react';
import { Link } from 'react-router-dom';

import { AuthorName, ConversationAvatar, ConversationTitle } from '@/components/chat/UserAvatar';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { conversationRoute, isBuzz, messagePreview } from '@/lib/dm/conversation';
import type { Conversation, DeliveryStatus } from '@/lib/dm/types';
import { formatListTime } from '@/lib/format';
import { cn } from '@/lib/utils';

export function DeliveryIcon({ status, className }: { status?: DeliveryStatus; className?: string }) {
  if (status === 'sending') return <Clock className={cn('size-3.5', className)} aria-label="Sending" />;
  if (status === 'failed') return <AlertCircle className={cn('size-3.5 text-destructive', className)} aria-label="Not delivered" />;
  return <Check className={cn('size-3.5', className)} aria-label="Sent" />;
}

export function ChatListItem({ conversation, active }: { conversation: Conversation; active: boolean }) {
  const { user } = useCurrentUser();
  const { isMuted, isPinned, toggleMute, togglePin, markRead } = useDM();
  const last = conversation.lastMessage;
  const mine = !!last && last.pubkey === user?.pubkey;
  const muted = isMuted(conversation.id);
  const pinned = isPinned(conversation.id);
  const unread = conversation.unreadCount;
  const buzz = last ? isBuzz(last) : false;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Link
          to={conversationRoute(conversation.id)}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring',
            active ? 'bg-amber-100/70 dark:bg-amber-300/10' : 'hover:bg-accent/70',
          )}
        >
          <ConversationAvatar conversation={conversation} className="size-12" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <ConversationTitle conversation={conversation} className="min-w-0 flex-1 truncate font-semibold" />
              {muted && <BellOff className="size-3.5 shrink-0 opacity-60" aria-label="Muted" />}
              {mine && last && !buzz && (
                <DeliveryIcon status={last.status} className="text-amber-600 dark:text-amber-400" />
              )}
              {last && (
                <time
                  dateTime={new Date(last.created_at * 1000).toISOString()}
                  className="shrink-0 text-xs text-muted-foreground"
                >
                  {formatListTime(last.created_at)}
                </time>
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-2">
              <p
                dir="auto"
                className={cn(
                  'min-w-0 flex-1 truncate text-sm text-muted-foreground',
                  buzz && 'font-semibold text-amber-700 dark:text-amber-400',
                )}
              >
                {last && mine && <span className="text-foreground/80">You: </span>}
                {last && !mine && conversation.isGroup && (
                  <span className="text-foreground/80">
                    <AuthorName pubkey={last.pubkey} />:{' '}
                  </span>
                )}
                {last ? messagePreview(last) : 'No messages yet'}
              </p>
              {unread > 0 ? (
                <span
                  className={cn(
                    'min-w-5 shrink-0 rounded-full px-1.5 text-center text-xs leading-5 font-bold',
                    muted ? 'bg-muted-foreground/30 text-foreground' : 'bg-primary text-primary-foreground',
                  )}
                  aria-label={`${unread} unread`}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              ) : (
                pinned && <Pin className="size-3.5 shrink-0 rotate-45 opacity-60" aria-label="Pinned" />
              )}
            </div>
          </div>
        </Link>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onSelect={() => togglePin(conversation.id)}>
          {pinned ? <PinOff /> : <Pin />}
          {pinned ? 'Unpin' : 'Pin to top'}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => toggleMute(conversation.id)}>
          {muted ? <Bell /> : <BellOff />}
          {muted ? 'Unmute' : 'Mute'}
        </ContextMenuItem>
        {unread > 0 && (
          <ContextMenuItem onSelect={() => markRead(conversation.id)}>
            <CheckCheck />
            Mark as read
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
