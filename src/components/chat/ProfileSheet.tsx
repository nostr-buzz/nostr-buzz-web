import { Copy, ExternalLink, Zap } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { Link } from 'react-router-dom';

import { BuzzButton } from '@/components/chat/BuzzButton';
import { MessageText } from '@/components/chat/MessageText';
import { AuthorName, ConversationAvatar, ConversationTitle, UserAvatar } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Switch } from '@/components/ui/switch';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import { conversationIdFromParticipants, conversationRoute } from '@/lib/dm/conversation';
import type { Conversation } from '@/lib/dm/types';
import { displayName } from '@/lib/format';
import { sanitizeUrl } from '@/lib/sanitize';

interface ProfileSheetProps {
  conversation: Conversation;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileSheet({ conversation, open, onOpenChange }: ProfileSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 overflow-y-auto p-0 sm:max-w-md">
        {conversation.isGroup ? (
          <GroupInfo conversation={conversation} onNavigate={() => onOpenChange(false)} />
        ) : (
          <PersonInfo pubkey={conversation.participants[0]} conversation={conversation} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function ChatToggles({ conversation }: { conversation: Conversation }) {
  const { isMuted, toggleMute, isPinned, togglePin } = useDM();
  return (
    <div className="divide-y rounded-xl border">
      {!conversation.isSelf && (
        <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm font-medium">
          Notifications
          <Switch checked={!isMuted(conversation.id)} onCheckedChange={() => toggleMute(conversation.id)} />
        </label>
      )}
      <label className="flex cursor-pointer items-center justify-between gap-4 px-4 py-3 text-sm font-medium">
        Pin chat to top
        <Switch checked={isPinned(conversation.id)} onCheckedChange={() => togglePin(conversation.id)} />
      </label>
    </div>
  );
}

function PersonInfo({ pubkey, conversation }: { pubkey: string; conversation: Conversation }) {
  const author = useAuthor(pubkey);
  const { toast } = useToast();
  const metadata = author.data?.metadata;
  const banner = sanitizeUrl(metadata?.banner);
  const website = sanitizeUrl(metadata?.website);
  const name = conversation.isSelf ? 'Saved messages' : displayName(pubkey, metadata);
  const npub = nip19.npubEncode(pubkey);

  const copy = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} copied` });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  return (
    <>
      <SheetHeader className="sr-only">
        <SheetTitle>{name}</SheetTitle>
        <SheetDescription>Profile and chat settings</SheetDescription>
      </SheetHeader>
      <div className="relative h-36 shrink-0 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-600">
        {banner && <img src={banner} alt="" className="size-full object-cover" />}
      </div>
      <div className="-mt-12 px-6 pb-8">
        <UserAvatar pubkey={pubkey} className="size-24 text-3xl ring-4 ring-background" />
        <h2 className="mt-3 font-display text-2xl font-bold break-words" dir="auto">
          {conversation.isSelf ? displayName(pubkey, metadata) : name}
        </h2>
        {metadata?.nip05 && <p className="truncate text-sm text-muted-foreground">{metadata.nip05}</p>}
        {metadata?.about && <MessageText content={metadata.about} previews={false} className="mt-3 text-sm" />}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {website && (
            <a href={website} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-medium text-amber-700 hover:underline dark:text-amber-400">
              <ExternalLink className="size-3.5" /> {website.replace(/^https:\/\//, '').replace(/\/$/, '')}
            </a>
          )}
          {metadata?.lud16 && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Zap className="size-3.5" /> {metadata.lud16}
            </span>
          )}
        </div>

        <div className="mt-5 flex gap-2">
          {!conversation.isSelf && <BuzzButton conversationId={conversation.id} variant="large" className="flex-1" />}
          <Button variant="outline" className="h-12 rounded-xl" onClick={() => void copy(npub, 'npub')}>
            <Copy /> Copy npub
          </Button>
        </div>

        <div className="mt-6 flex items-center gap-4 rounded-xl border p-4">
          <QRCodeCanvas value={`nostr:${npub}`} size={112} className="shrink-0 rounded-lg bg-white p-1" />
          <p className="min-w-0 font-mono text-xs break-all text-muted-foreground">{npub}</p>
        </div>

        <div className="mt-6">
          <ChatToggles conversation={conversation} />
        </div>

        <Button variant="link" asChild className="mt-4 px-0">
          <Link to={`/${npub}`}>Open full profile</Link>
        </Button>
      </div>
    </>
  );
}

function GroupInfo({ conversation, onNavigate }: { conversation: Conversation; onNavigate: () => void }) {
  const { user } = useCurrentUser();
  const me = user?.pubkey ?? '';
  const members = [me, ...conversation.participants];

  return (
    <>
      <SheetHeader className="items-center border-b px-6 pt-10 pb-6 text-center">
        <ConversationAvatar conversation={conversation} className="size-20" />
        <SheetTitle className="mt-2 font-display text-2xl">
          <ConversationTitle conversation={conversation} />
        </SheetTitle>
        <SheetDescription>{members.length} members</SheetDescription>
        <BuzzButton conversationId={conversation.id} variant="large" className="mt-3 w-full" />
      </SheetHeader>
      <div className="space-y-6 px-6 py-6">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Members</h3>
          <ul className="space-y-1">
            {members.map((pubkey) => (
              <li key={pubkey}>
                <Link
                  to={conversationRoute(conversationIdFromParticipants([pubkey], me))}
                  onClick={onNavigate}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-accent"
                >
                  <UserAvatar pubkey={pubkey} className="size-10" />
                  <span className="min-w-0 flex-1 truncate font-medium">
                    <AuthorName pubkey={pubkey} />
                    {pubkey === me && <span className="ml-1 text-muted-foreground">(you)</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
        <ChatToggles conversation={conversation} />
        <p className="text-xs text-muted-foreground">Changing members starts a new group.</p>
      </div>
    </>
  );
}
