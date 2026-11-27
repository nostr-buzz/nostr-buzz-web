import { AlertCircle, Bell, BellOff, Check, CheckCheck, Clock, type LucideIcon, Pin, PinOff } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
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
import { claimOpenRow, closeOtherRows, releaseOpenRow, useSwipe } from '@/hooks/useSwipe';
import { conversationRoute, isBuzz, messagePreview } from '@/lib/dm/conversation';
import type { Conversation, DeliveryStatus } from '@/lib/dm/types';
import { formatListTime } from '@/lib/format';
import { hapticTick } from '@/lib/haptics';
import { cn } from '@/lib/utils';

export function DeliveryIcon({ status, className }: { status?: DeliveryStatus; className?: string }) {
  if (status === 'sending') return <Clock className={cn('size-3.5', className)} aria-label="Sending" />;
  if (status === 'failed') return <AlertCircle className={cn('size-3.5 text-destructive', className)} aria-label="Not delivered" />;
  return <Check className={cn('size-3.5', className)} aria-label="Sent" />;
}

/** Width of one swipe action button. */
const ACTION_WIDTH = 76;
/** Dragging the row this far (share of its width) runs the outer action on release. */
const FULL_SWIPE = 0.6;
const EASING = '320ms cubic-bezier(0.2, 0.8, 0.2, 1)';

interface SwipeAction {
  label: string;
  icon: LucideIcon;
  className: string;
  run: () => void;
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

  const frameRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const leadingRef = useRef<HTMLDivElement>(null);
  const trailingRef = useRef<HTMLDivElement>(null);
  /** Current position, where the drag started from, and whether a full swipe is armed. */
  const gesture = useRef({ offset: 0, base: 0, armed: false });

  // Swipe right: pin. Swipe left: mark as read and mute (outer, runs on a full swipe).
  const leading: SwipeAction[] = [
    {
      label: pinned ? 'Unpin' : 'Pin',
      icon: pinned ? PinOff : Pin,
      className: 'bg-amber-500 text-stone-950',
      run: () => togglePin(conversation.id),
    },
  ];
  const trailing: SwipeAction[] = [];
  if (unread > 0) {
    trailing.push({ label: 'Read', icon: CheckCheck, className: 'bg-sky-700 text-white', run: () => markRead(conversation.id) });
  }
  if (!conversation.isSelf) {
    trailing.push({
      label: muted ? 'Unmute' : 'Mute',
      icon: muted ? Bell : BellOff,
      className: 'bg-stone-600 text-white',
      run: () => toggleMute(conversation.id),
    });
  }
  const leadingWidth = leading.length * ACTION_WIDTH;
  const trailingWidth = trailing.length * ACTION_WIDTH;

  /** Move the row (and stretch the buttons it uncovers) without re-rendering. */
  const place = useCallback((offset: number, animate: boolean) => {
    const row = rowRef.current;
    if (!row) return;
    gesture.current.offset = offset;
    row.style.transition = animate ? `transform ${EASING}` : 'none';
    row.style.transform = offset === 0 ? '' : `translate3d(${offset}px, 0, 0)`;
    const sides = [
      [leadingRef.current, Math.max(0, offset)],
      [trailingRef.current, Math.max(0, -offset)],
    ] as const;
    for (const [element, width] of sides) {
      if (!element) continue;
      element.style.transition = animate ? `width ${EASING}, visibility ${EASING}` : 'none';
      element.style.width = `${width}px`;
      element.style.visibility = width > 0 ? 'visible' : 'hidden';
    }
    frameRef.current?.toggleAttribute('data-swipe-open', offset !== 0);
  }, []);

  const close = useCallback(() => {
    place(0, true);
    releaseOpenRow(gesture);
  }, [place]);

  const open = (offset: number) => {
    claimOpenRow(gesture, () => place(0, true));
    place(offset, true);
  };

  const runAction = (action: SwipeAction) => {
    close();
    action.run();
  };

  useSwipe(rowRef, {
    onStart: () => {
      closeOtherRows(gesture);
      gesture.current.base = gesture.current.offset;
      gesture.current.armed = false;
    },
    onMove: (dx) => {
      const state = gesture.current;
      let offset = state.base + dx;
      // Nothing to reveal on that side: resist instead of sliding freely.
      if ((offset > 0 && leadingWidth === 0) || (offset < 0 && trailingWidth === 0)) offset *= 0.15;
      const width = rowRef.current?.offsetWidth ?? 320;
      const hasActions = offset > 0 ? leadingWidth > 0 : trailingWidth > 0;
      const armed = hasActions && Math.abs(offset) > width * FULL_SWIPE;
      if (armed !== state.armed) {
        state.armed = armed;
        hapticTick();
      }
      place(offset, false);
    },
    onEnd: (dx, velocity) => {
      const state = gesture.current;
      const offset = state.base + dx;
      if (state.armed) {
        const action = offset > 0 ? leading[0] : trailing.at(-1);
        if (action) runAction(action);
        else close();
        return;
      }
      if (leadingWidth > 0 && (offset > leadingWidth / 2 || (velocity > 0.4 && offset > 0))) open(leadingWidth);
      else if (trailingWidth > 0 && (offset < -trailingWidth / 2 || (velocity < -0.4 && offset < 0))) open(-trailingWidth);
      else close();
    },
  });

  // A row that goes away must not stay registered as the open one.
  useEffect(() => () => releaseOpenRow(gesture), []);

  const actionButtons = (actions: SwipeAction[]) =>
    actions.map((action) => (
      <button
        key={action.label}
        type="button"
        tabIndex={-1}
        onClick={() => runAction(action)}
        className={cn('flex min-w-0 flex-1 flex-col items-center justify-center gap-1 overflow-hidden text-xs font-semibold', action.className)}
      >
        <action.icon className="size-5 shrink-0" />
        <span className="max-w-full truncate px-1">{action.label}</span>
      </button>
    ));

  return (
    <div ref={frameRef} className="relative overflow-hidden rounded-xl">
      {/* Swipe actions (touch only). The same actions are in the long-press menu. */}
      <div ref={leadingRef} aria-hidden="true" className="invisible absolute inset-y-0 left-0 flex w-0 overflow-hidden">
        {actionButtons(leading)}
      </div>
      <div ref={trailingRef} aria-hidden="true" className="invisible absolute inset-y-0 right-0 flex w-0 overflow-hidden">
        {actionButtons(trailing)}
      </div>

      <div ref={rowRef} className="relative touch-pan-y rounded-xl bg-sidebar will-change-transform motion-reduce:!transition-none">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <Link
              to={conversationRoute(conversation.id)}
              aria-current={active ? 'page' : undefined}
              draggable={false}
              onClick={(event) => {
                // Tapping a row that is swiped open just closes it.
                if (gesture.current.offset !== 0) {
                  event.preventDefault();
                  close();
                }
              }}
              className={cn(
                'group relative flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors outline-none select-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                active ? 'bg-amber-100/70 dark:bg-amber-300/10' : 'hover:bg-accent/70 active:bg-accent',
              )}
            >
              <ConversationAvatar conversation={conversation} className="size-13" />
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
      </div>
    </div>
  );
}
