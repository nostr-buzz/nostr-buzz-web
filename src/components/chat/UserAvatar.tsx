import { Bookmark, UserIcon } from 'lucide-react';
import { Fragment } from 'react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useAuthor } from '@/hooks/useAuthor';
import type { Conversation } from '@/lib/dm/types';
import { displayName } from '@/lib/format';
import { sanitizeUrl } from '@/lib/sanitize';
import { cn } from '@/lib/utils';

/** Fallback avatar colors, all ≥ 4.5:1 against white text. */
const FALLBACK_COLORS = ['#b45309', '#7c3aed', '#0f766e', '#be123c', '#1d4ed8', '#4d7c0f', '#c2410c', '#6d28d9'];

function colorFor(pubkey: string): string {
  let hash = 0;
  for (const char of pubkey.slice(0, 12)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

export function UserAvatar({ pubkey, className }: { pubkey: string; className?: string }) {
  const author = useAuthor(pubkey);
  const metadata = author.data?.metadata;
  const src = sanitizeUrl(metadata?.picture);
  const name = metadata?.display_name?.trim() || metadata?.name?.trim();
  // Only show an initial for real names; "npub1…" would make everyone an "N".
  const initial = name ? [...name][0]?.toUpperCase() : undefined;

  return (
    <Avatar className={cn('size-10', className)}>
      {src && <AvatarImage src={src} alt="" className="object-cover" />}
      <AvatarFallback
        className="font-semibold text-white"
        style={{ backgroundColor: colorFor(pubkey) }}
        aria-hidden="true"
      >
        {initial ?? <UserIcon className="size-1/2 opacity-90" />}
      </AvatarFallback>
    </Avatar>
  );
}

export function ConversationAvatar({ conversation, className }: { conversation: Conversation; className?: string }) {
  if (conversation.isSelf) {
    return (
      <div
        aria-hidden="true"
        className={cn(
          'flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground',
          className,
        )}
      >
        <Bookmark className="size-[45%]" />
      </div>
    );
  }

  if (conversation.isGroup) {
    const [first, second] = conversation.participants;
    return (
      <div aria-hidden="true" className={cn('relative size-10 shrink-0', className)}>
        <UserAvatar pubkey={first} className="absolute top-0 left-0 size-[70%] ring-2 ring-background" />
        <UserAvatar pubkey={second} className="absolute right-0 bottom-0 size-[70%] ring-2 ring-background" />
      </div>
    );
  }

  return <UserAvatar pubkey={conversation.participants[0]} className={cn('shrink-0', className)} />;
}

export function AuthorName({ pubkey, className }: { pubkey: string; className?: string }) {
  const author = useAuthor(pubkey);
  return (
    <span className={className} dir="auto">
      {displayName(pubkey, author.data?.metadata)}
    </span>
  );
}

export function ConversationTitle({ conversation, className }: { conversation: Conversation; className?: string }) {
  if (conversation.isSelf) return <span className={className}>Saved messages</span>;
  if (conversation.subject) {
    return (
      <span className={className} dir="auto">
        {conversation.subject}
      </span>
    );
  }
  if (!conversation.isGroup) return <AuthorName pubkey={conversation.participants[0]} className={className} />;

  const shown = conversation.participants.slice(0, 3);
  const extra = conversation.participants.length - shown.length;
  return (
    <span className={className}>
      {shown.map((pubkey, index) => (
        <Fragment key={pubkey}>
          {index > 0 && ', '}
          <AuthorName pubkey={pubkey} />
        </Fragment>
      ))}
      {extra > 0 && ` +${extra}`}
    </span>
  );
}
