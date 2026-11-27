import { Copy, MoreHorizontal, Pencil, Phone, Pin, PinOff, Reply, RotateCw, Trash2, Users, Video } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { type ComponentType, type ReactNode, useRef, useState } from 'react';
import { Link } from 'react-router-dom';

import { BeeMark } from '@/components/brand/Brand';
import { DeliveryIcon } from '@/components/chat/ChatListItem';
import { EncryptedFile } from '@/components/chat/EncryptedFile';
import { MessageText } from '@/components/chat/MessageText';
import { AuthorName, UserAvatar } from '@/components/chat/UserAvatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useCalls } from '@/hooks/useCalls';
import { useDM } from '@/hooks/useDM';
import { useSwipe } from '@/hooks/useSwipe';
import { useToast } from '@/hooks/useToast';
import { isCallOffer, isVideoCall } from '@/lib/calls/protocol';
import { conversationRoute, isBuzz, messagePreview } from '@/lib/dm/conversation';
import { isGroupInvite, isGroupJoin, parseInvite } from '@/lib/groups/groups';
import { nowSeconds } from '@/lib/dm/nip17';
import { type ChatMessage, type Conversation, DM_KIND, type ReactionGroup } from '@/lib/dm/types';
import { formatMessageTime, isEmojiOnly } from '@/lib/format';
import { hapticTick } from '@/lib/haptics';
import { cn } from '@/lib/utils';

const QUICK_REACTIONS =['👍', '❤️', '😂', '🔥', '😮', '😢', '🐝'];
/** Swipe a message this far to the left to reply to it. */
const REPLY_SWIPE = 56;

interface MessageBubbleProps {
  message: ChatMessage;
  mine: boolean;
  conversation: Conversation;
  /** First message of a run from the same author. */
  first: boolean;
  /** Last message of a run from the same author. */
  last: boolean;
  replyTarget?: ChatMessage;
  reactions?: ReactionGroup[];
  edited: boolean;
  onReply: (message: ChatMessage) => void;
  onEdit: (message: ChatMessage) => void;
  onJump: (id: string) => void;
}

interface MenuKit {
  Item: ComponentType<{
    onSelect?: (event: Event) => void;
    className?: string;
    variant?: 'default' | 'destructive';
    'aria-label'?: string;
    children?: ReactNode;
  }>;
  Separator: ComponentType<{ className?: string }>;
}

const CONTEXT_KIT: MenuKit = { Item: ContextMenuItem, Separator: ContextMenuSeparator };
const DROPDOWN_KIT: MenuKit = { Item: DropdownMenuItem, Separator: DropdownMenuSeparator };

export function MessageBubble(props: MessageBubbleProps) {
  const { message, mine, conversation, first, last, replyTarget, reactions, edited, onReply, onEdit, onJump } = props;
  const { toggleReaction, deleteMessage, retryMessage, discardMessage, setGroupPinned } = useDM();
  const { toast } = useToast();
  const calls = useCalls();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isNip17 = message.protocol === 'nip17';
  const isLocal = message.id.startsWith('local-');
  const canReact = isNip17 && !isLocal && message.status !== 'failed';
  const canEdit = mine && isNip17 && message.kind === DM_KIND.chat && !isBuzz(message) && message.status !== 'sending';
  // Group admins can delete anyone's message.
  const canModerate = !!conversation.group?.isAdmin && !conversation.group.removed;
  const canDelete = (mine || canModerate) && isNip17 && message.status !== 'sending';
  const isPinned = !!conversation.group?.pinned.includes(message.id);
  const groupId = conversation.group?.id;
  const canPin = canModerate && isNip17 && !isLocal && !message.status;
  const canReply = !isLocal && message.status !== 'failed';

  // Swipe left to reply (touch). The row follows the finger, then springs back.
  const rowRef = useRef<HTMLDivElement>(null);
  const replyHintRef = useRef<HTMLSpanElement>(null);
  const swipeArmed = useRef(false);
  const slideRow = (distance: number, animate: boolean) => {
    const row = rowRef.current;
    const hint = replyHintRef.current;
    if (!row || !hint) return;
    const progress = Math.min(1, distance / REPLY_SWIPE);
    row.style.transition = animate ? 'transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    row.style.transform = distance > 0 ? `translate3d(${-distance}px, 0, 0)` : '';
    hint.style.transition = animate ? 'opacity 200ms ease-out, transform 200ms ease-out' : 'none';
    hint.style.opacity = String(progress);
    // The hint rides inside the row, so move it back by the same distance to keep it at the screen edge.
    hint.style.transform = `translate3d(${distance}px, 0, 0) scale(${0.5 + progress * 0.5})`;
  };
  useSwipe(
    rowRef,
    {
      onStart: () => {
        swipeArmed.current = false;
      },
      onMove: (dx) => {
        const pull = Math.max(0, -dx);
        // Follow the finger up to the trigger point, then resist.
        const distance = pull <= REPLY_SWIPE ? pull : Math.min(96, REPLY_SWIPE + (pull - REPLY_SWIPE) * 0.25);
        const armed = pull >= REPLY_SWIPE;
        if (armed !== swipeArmed.current) {
          swipeArmed.current = armed;
          hapticTick();
        }
        slideRow(distance, false);
      },
      onEnd: () => {
        slideRow(0, true);
        if (swipeArmed.current) onReply(message);
        swipeArmed.current = false;
      },
    },
    canReply && !isCallOffer(message),
  );

  const react = (emoji: string) => {
    toggleReaction(message, emoji).catch((error: unknown) =>
      toast({ title: 'Reaction failed', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }),
    );
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      toast({ title: 'Copied' });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  const remove = () => {
    deleteMessage(message).catch((error: unknown) =>
      toast({ title: 'Delete failed', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }),
    );
  };

  const menu = (kit: MenuKit) => {
    const { Item, Separator } = kit;
    return (
      <>
        {canReact && (
          <>
            <div className="flex gap-0.5 p-1" role="group" aria-label="Quick reactions">
              {QUICK_REACTIONS.map((emoji) => (
                <Item
                  key={emoji}
                  onSelect={() => react(emoji)}
                  aria-label={`React with ${emoji}`}
                  className="size-9 justify-center rounded-full p-0 text-xl"
                >
                  {emoji}
                </Item>
              ))}
            </div>
            <Separator />
          </>
        )}
        {canReply && (
          <Item onSelect={() => onReply(message)}>
            <Reply /> Reply
          </Item>
        )}
        {canPin && groupId && (
          <Item
            onSelect={() =>
              setGroupPinned(groupId, message.id, !isPinned).catch((error: unknown) =>
                toast({ title: 'Could not update pin', description: error instanceof Error ? error.message : undefined, variant: 'destructive' }),
              )
            }
          >
            {isPinned ? <PinOff /> : <Pin />} {isPinned ? 'Unpin' : 'Pin'}
          </Item>
        )}
        {message.kind !== DM_KIND.file && message.content && (
          <Item onSelect={() => void copy()}>
            <Copy /> Copy text
          </Item>
        )}
        {canEdit && (
          <Item onSelect={() => onEdit(message)}>
            <Pencil /> Edit
          </Item>
        )}
        {message.status === 'failed' && !isLocal && (
          <Item onSelect={() => void retryMessage(message)}>
            <RotateCw /> Retry sending
          </Item>
        )}
        {message.status === 'failed' && (
          <Item variant="destructive" onSelect={() => discardMessage(message)}>
            <Trash2 /> Discard
          </Item>
        )}
        {canDelete && message.status !== 'failed' && (
          <Item variant="destructive" onSelect={() => setConfirmDelete(true)}>
            <Trash2 /> Delete for everyone
          </Item>
        )}
      </>
    );
  };

  const confirmDialog = (
    <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete for everyone?</AlertDialogTitle>
          <AlertDialogDescription>Some apps may still show it.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={remove}>
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  /* ---------------------------------- calls ---------------------------------- */
  if (isCallOffer(message)) {
    const video = isVideoCall(message);
    const other = !conversation.isGroup && !conversation.isSelf ? conversation.participants[0] : undefined;
    return (
      <div id={`msg-${message.id}`} className="flex justify-center px-4 py-2">
        <div className="flex max-w-full items-center gap-2 rounded-full border bg-background/90 py-1 pr-1.5 pl-3 text-sm">
          {video ? <Video className="size-4 shrink-0 text-amber-600 dark:text-amber-400" /> : <Phone className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />}
          <span className="min-w-0 truncate">
            {mine ? 'Outgoing' : 'Incoming'} {video ? 'video' : 'voice'} call
          </span>
          <time className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{formatMessageTime(message.created_at)}</time>
          {other && calls.supported ? (
            <button
              type="button"
              onClick={() => calls.startCall(other, video)}
              className="shrink-0 rounded-full bg-primary px-3 py-1 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {mine ? 'Call again' : 'Call back'}
            </button>
          ) : (
            <span className="w-1.5" aria-hidden="true" />
          )}
        </div>
      </div>
    );
  }

  /* --------------------------- joined by invite link -------------------------- */
  if (isGroupJoin(message)) {
    return (
      <div id={`msg-${message.id}`} className="flex justify-center px-4 py-1.5">
        <span className="max-w-full truncate rounded-full bg-background/80 px-3 py-1 text-xs text-muted-foreground" dir="auto">
          {mine ? 'You' : <AuthorName pubkey={message.pubkey} className="font-semibold" />} joined the group
        </span>
      </div>
    );
  }

  /* ------------------------------ group invites ------------------------------ */
  if (isGroupInvite(message)) {
    const invite = parseInvite(message);
    return (
      <div id={`msg-${message.id}`} className="flex justify-center px-4 py-2">
        <div className="flex max-w-full items-center gap-2 rounded-full border bg-background/90 py-1.5 pr-1.5 pl-3 text-sm">
          <Users className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="min-w-0 truncate" dir="auto">
            {mine ? 'You sent an invite to' : 'Invite to'} <b>{invite?.name ?? 'a group'}</b>
          </span>
          {invite && (
            <Link
              to={conversationRoute(invite.groupId)}
              className="shrink-0 rounded-full bg-primary px-3 py-0.5 font-semibold text-primary-foreground hover:bg-primary/90"
            >
              Open
            </Link>
          )}
        </div>
      </div>
    );
  }

  /* -------------------------------- BUZZ!!! -------------------------------- */
  if (isBuzz(message)) {
    const fresh = nowSeconds() - message.created_at < 20;
    return (
      <div id={`msg-${message.id}`} className="flex justify-center px-4 py-2">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                'flex items-center gap-2 rounded-full border border-amber-300/80 bg-amber-100 py-1 pr-4 pl-1.5 text-sm font-semibold text-amber-950 shadow-sm select-none dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-100',
                fresh && 'buzz-bubble-fresh',
              )}
            >
              <BeeMark className="size-7" wiggle={fresh} />
              <span dir="auto">
                {mine ? 'You sent a BUZZ!!!' : (
                  <>
                    <AuthorName pubkey={message.pubkey} /> sent you a BUZZ!!!
                  </>
                )}
              </span>
              <time className="shrink-0 text-xs font-normal whitespace-nowrap opacity-75">{formatMessageTime(message.created_at)}</time>
              {mine && <DeliveryIcon status={message.status} className="opacity-75" />}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">{menu(CONTEXT_KIT)}</ContextMenuContent>
        </ContextMenu>
        {confirmDialog}
      </div>
    );
  }

  /* ------------------------------ regular bubble ----------------------------- */
  const emojiOnly = message.kind !== DM_KIND.file && isEmojiOnly(message.content);
  const isPhoto = message.kind === DM_KIND.file && (message.tags.find(([name]) => name === 'file-type')?.[1] ?? '').startsWith('image/');
  const showAuthor = conversation.isGroup && !mine && first;
  const showAvatar = conversation.isGroup && !mine;

  const meta = (
    <span
      className={cn(
        'ml-auto flex shrink-0 translate-y-0.5 items-center gap-1 self-end text-[11px] leading-none whitespace-nowrap select-none',
        emojiOnly ? 'rounded-full bg-background/80 px-2 py-1 text-muted-foreground shadow-sm' : 'text-bubble-meta',
      )}
    >
      {isPinned && <Pin className="size-3" aria-label="Pinned" />}
      {edited && <span>edited</span>}
      <time dateTime={new Date(message.created_at * 1000).toISOString()}>{formatMessageTime(message.created_at)}</time>
      {mine && <DeliveryIcon status={message.status} className="size-3.5" />}
      {message.protocol === 'nip04' && <span title="Legacy NIP-04 encryption">· v1</span>}
    </span>
  );

  return (
    <div
      ref={rowRef}
      id={`msg-${message.id}`}
      className={cn(
        'group relative flex touch-pan-y items-end gap-2 rounded-lg px-2 motion-reduce:!transition-none md:px-4',
        mine ? 'justify-end' : 'justify-start',
        first ? 'mt-2' : 'mt-0.5',
      )}
    >
      <span
        ref={replyHintRef}
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-background/90 text-foreground opacity-0 shadow-sm"
      >
        <Reply className="size-4" />
      </span>
      {showAvatar &&
        (last ? (
          <Link to={`/${nip19.npubEncode(message.pubkey)}`} className="shrink-0 rounded-full" aria-label="Open profile">
            <UserAvatar pubkey={message.pubkey} className="size-8" />
          </Link>
        ) : (
          <span className="w-8 shrink-0" aria-hidden="true" />
        ))}

      {mine && <ActionsButton>{menu(DROPDOWN_KIT)}</ActionsButton>}

      <div className={cn('flex max-w-[min(85%,36rem)] min-w-0 flex-col', mine ? 'items-end' : 'items-start')}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              className={cn(
                'message-in relative max-w-full select-none md:select-text',
                !emojiOnly && [
                  'rounded-2xl px-3 py-1.5 shadow-sm',
                  mine ? 'bg-bubble-out text-bubble-out-foreground' : 'bg-bubble-in text-bubble-in-foreground',
                  last && (mine ? 'rounded-br-md' : 'rounded-bl-md'),
                ],
                message.kind === DM_KIND.file && (isPhoto ? 'p-1' : 'p-1.5'),
              )}
            >
              {showAuthor && (
                <AuthorName
                  pubkey={message.pubkey}
                  className={cn('block truncate text-sm font-semibold text-amber-700 dark:text-amber-400', message.kind === DM_KIND.file && 'px-1.5 pt-0.5')}
                />
              )}

              {replyTarget && (
                <button
                  type="button"
                  onClick={() => onJump(replyTarget.id)}
                  className={cn(
                    'mb-1 block w-full min-w-0 rounded-md border-l-[3px] border-amber-500 px-2 py-1 text-left text-sm',
                    mine ? 'bg-amber-900/10 dark:bg-black/20' : 'bg-amber-500/10',
                  )}
                >
                  <AuthorName pubkey={replyTarget.pubkey} className="block truncate text-xs font-semibold text-amber-700 dark:text-amber-400" />
                  <span className="block truncate opacity-80" dir="auto">
                    {messagePreview(replyTarget)}
                  </span>
                </button>
              )}

              {isPhoto ? (
                // Photos fill the bubble; the time sits on the picture, as in native messengers.
                <div className="relative">
                  <EncryptedFile message={message} />
                  <span className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] leading-none whitespace-nowrap text-white backdrop-blur-sm select-none">
                    {isPinned && <Pin className="size-3" aria-label="Pinned" />}
                    <time dateTime={new Date(message.created_at * 1000).toISOString()}>{formatMessageTime(message.created_at)}</time>
                    {mine && <DeliveryIcon status={message.status} className="size-3.5" />}
                  </span>
                </div>
              ) : message.kind === DM_KIND.file ? (
                <div className="flex flex-col gap-1">
                  <EncryptedFile message={message} />
                  <span className="px-1.5 pb-0.5">{meta}</span>
                </div>
              ) : emojiOnly ? (
                <div className="flex flex-col items-end gap-1">
                  <p className="text-5xl leading-tight" aria-label={message.content}>
                    {message.content}
                  </p>
                  {meta}
                </div>
              ) : (
                <div className="flex flex-wrap items-end gap-x-2 text-base leading-snug">
                  <MessageText content={message.content} className="min-w-0 grow" />
                  {meta}
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
            {menu(CONTEXT_KIT)}
          </ContextMenuContent>
        </ContextMenu>

        {reactions && reactions.length > 0 && (
          <div className={cn('mt-1 flex flex-wrap gap-1', mine ? 'justify-end' : 'justify-start')}>
            {reactions.map((group) => (
              <button
                key={group.emoji}
                type="button"
                onClick={() => react(group.emoji)}
                aria-pressed={!!group.mine}
                aria-label={`${group.emoji} ${group.pubkeys.length}`}
                className={cn(
                  'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  group.mine
                    ? 'border-amber-400 bg-amber-100 text-amber-950 dark:border-amber-400/60 dark:bg-amber-400/20 dark:text-amber-50'
                    : 'border-border bg-background/90 hover:bg-accent',
                )}
              >
                <span>{group.emoji}</span>
                {group.pubkeys.length > 1 && <span className="text-xs font-semibold">{group.pubkeys.length}</span>}
              </button>
            ))}
          </div>
        )}

        {message.status === 'failed' && (
          <div className="mt-1 flex gap-3 text-xs font-medium text-destructive">
            <span>Not delivered</span>
            {!isLocal && (
              <button type="button" className="underline underline-offset-2" onClick={() => void retryMessage(message)}>
                Retry
              </button>
            )}
            <button type="button" className="underline underline-offset-2" onClick={() => discardMessage(message)}>
              Discard
            </button>
          </div>
        )}
      </div>

      {!mine && <ActionsButton>{menu(DROPDOWN_KIT)}</ActionsButton>}
      {confirmDialog}
    </div>
  );
}

function ActionsButton({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Message actions"
          className="mb-1 hidden size-8 shrink-0 items-center justify-center rounded-full text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-background/80 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-[state=open]:opacity-100 md:flex"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </DropdownMenuTrigger>
      {/* Don't pull focus back to the trigger: "Reply"/"Edit" move it to the composer. */}
      <DropdownMenuContent className="w-56" onCloseAutoFocus={(event) => event.preventDefault()}>
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
