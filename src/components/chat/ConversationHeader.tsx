import { AlertTriangle, ArrowLeft, Bell, BellOff, Copy, Info, Lock, MoreVertical, Pin, PinOff } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { useNavigate } from 'react-router-dom';

import { BuzzButton } from '@/components/chat/BuzzButton';
import { AuthorName, ConversationAvatar, ConversationTitle } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAuthor } from '@/hooks/useAuthor';
import { useDM } from '@/hooks/useDM';
import { useDMRelayInfo } from '@/hooks/useDMRelays';
import { useToast } from '@/hooks/useToast';
import type { Conversation } from '@/lib/dm/types';
import { useOnline } from '@/lib/install';

interface ConversationHeaderProps {
  conversation: Conversation;
  onOpenInfo: () => void;
}

export function ConversationHeader({ conversation, onOpenInfo }: ConversationHeaderProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isMuted, toggleMute, isPinned, togglePin } = useDM();
  const other = !conversation.isGroup && !conversation.isSelf ? conversation.participants[0] : undefined;
  const author = useAuthor(other);
  const relayInfo = useDMRelayInfo(other);
  const muted = isMuted(conversation.id);
  const pinned = isPinned(conversation.id);

  const noInbox = !!other && relayInfo.isSuccess && relayInfo.data.inbox.length === 0 && !conversation.usesLegacy;

  const online = useOnline();
  const subtitle = !online
    ? 'Waiting for network…'
    : conversation.isSelf
    ? 'Private notes'
    : conversation.group?.removed
      ? 'Not a member'
      : conversation.isGroup
      ? `${conversation.participants.length + 1} members`
      : conversation.usesLegacy && conversation.messages.at(-1)?.protocol === 'nip04'
        ? 'Legacy encryption (NIP-04)'
        : author.data?.metadata?.nip05 || 'End-to-end encrypted';

  const copyNpub = async () => {
    if (!other) return;
    try {
      await navigator.clipboard.writeText(nip19.npubEncode(other));
      toast({ title: 'npub copied' });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  return (
    <>
      <header className="app-bar z-10 gap-1.5 border-b bg-background/85 px-2 backdrop-blur-md md:gap-2 md:px-4">
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 rounded-full md:hidden"
          aria-label="Back to chats"
          onClick={() => navigate('/')}
        >
          <ArrowLeft className="size-5" />
        </Button>

        <button
          type="button"
          onClick={onOpenInfo}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          <ConversationAvatar conversation={conversation} className="size-10" />
          <span className="min-w-0">
            <ConversationTitle conversation={conversation} className="block truncate leading-tight font-semibold" />
            <span className="flex items-center gap-1 truncate text-xs text-muted-foreground">
              <Lock className="size-3 shrink-0" />
              <span className="truncate">{subtitle}</span>
            </span>
          </span>
        </button>

        {!conversation.isSelf && !conversation.group?.removed && !conversation.group?.isMuted && (
          <>
            <BuzzButton conversationId={conversation.id} variant="icon" className="sm:hidden" />
            <BuzzButton conversationId={conversation.id} variant="pill" className="hidden sm:inline-flex" />
          </>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="shrink-0 rounded-full" aria-label="Chat options">
              <MoreVertical className="size-5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={onOpenInfo}>
              <Info /> {conversation.isGroup ? 'Group info' : 'View profile'}
            </DropdownMenuItem>
            {other && (
              <DropdownMenuItem onSelect={() => void copyNpub()}>
                <Copy /> Copy npub
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => togglePin(conversation.id)}>
              {pinned ? <PinOff /> : <Pin />} {pinned ? 'Unpin chat' : 'Pin chat'}
            </DropdownMenuItem>
            {!conversation.isSelf && (
              <DropdownMenuItem onSelect={() => toggleMute(conversation.id)}>
                {muted ? <Bell /> : <BellOff />} {muted ? 'Unmute' : 'Mute notifications'}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </header>

      {noInbox && other && (
        <div
          role="note"
          className="flex items-start gap-2 border-b border-amber-300/60 bg-amber-50 px-4 py-2 text-xs text-amber-950 dark:border-amber-400/20 dark:bg-amber-400/10 dark:text-amber-100"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="line-clamp-2">
            <AuthorName pubkey={other} className="font-semibold" /> has no DM inbox. Messages may be delayed.
          </p>
        </div>
      )}
    </>
  );
}
