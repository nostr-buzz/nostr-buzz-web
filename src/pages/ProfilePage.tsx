import { useSeoMeta } from '@unhead/react';
import { ArrowLeft, Copy, ExternalLink, MessageCircle, Pencil, Zap } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { LoginArea } from '@/components/auth/LoginArea';
import { Logo } from '@/components/brand/Brand';
import { BuzzButton } from '@/components/chat/BuzzButton';
import { EditProfileDialog } from '@/components/chat/EditProfileDialog';
import { MessageText } from '@/components/chat/MessageText';
import { UserAvatar } from '@/components/chat/UserAvatar';
import { Button } from '@/components/ui/button';
import { QRCodeCanvas } from '@/components/ui/qrcode';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { conversationIdFromParticipants, conversationRoute } from '@/lib/dm/conversation';
import { displayName } from '@/lib/format';
import { sanitizeUrl } from '@/lib/sanitize';

export function ProfilePage({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [editOpen, setEditOpen] = useState(false);

  const metadata = author.data?.metadata;
  const name = displayName(pubkey, metadata);
  const npub = nip19.npubEncode(pubkey);
  const banner = sanitizeUrl(metadata?.banner);
  const website = sanitizeUrl(metadata?.website);
  const isMe = user?.pubkey === pubkey;
  const conversationId = user ? conversationIdFromParticipants([pubkey], user.pubkey) : undefined;

  useSeoMeta({
    title: `${name} · nostr.buzz`,
    description: metadata?.about?.slice(0, 160) || `Send ${name} a private message or a BUZZ on nostr.buzz.`,
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(npub);
      toast({ title: 'npub copied' });
    } catch {
      toast({ title: 'Could not copy', variant: 'destructive' });
    }
  };

  return (
    <div className="min-h-dvh bg-background">
      <header className="mx-auto flex max-w-3xl items-center gap-2 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Back" onClick={() => navigate(-1)}>
          <ArrowLeft className="size-5" />
        </Button>
        <Link to="/" className="mr-auto rounded-lg">
          <Logo markClassName="size-7" />
        </Link>
        {!user && <LoginArea className="max-w-60" />}
      </header>

      <main className="mx-auto max-w-3xl px-4 pb-16">
        <article className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <div className="h-40 bg-gradient-to-br from-amber-200 via-amber-400 to-amber-600 md:h-56">
            {banner && <img src={banner} alt="" className="size-full object-cover" />}
          </div>
          <div className="px-6 pb-8">
            <div className="-mt-14 flex items-end justify-between gap-4">
              <UserAvatar pubkey={pubkey} className="size-28 text-4xl ring-4 ring-card" />
              {isMe && (
                <Button variant="outline" className="rounded-full" onClick={() => setEditOpen(true)}>
                  <Pencil /> Edit profile
                </Button>
              )}
            </div>

            {author.isLoading ? (
              <div className="mt-4 space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-4 h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            ) : (
              <>
                <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight break-words md:text-4xl" dir="auto">
                  {name}
                </h1>
                {metadata?.nip05 && <p className="mt-1 text-muted-foreground">{metadata.nip05}</p>}
                {metadata?.about && <MessageText content={metadata.about} previews={false} className="mt-4 text-lg" />}
                <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2">
                  {website && (
                    <a
                      href={website}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1.5 font-medium text-amber-700 hover:underline dark:text-amber-400"
                    >
                      <ExternalLink className="size-4" /> {website.replace(/^https:\/\//, '').replace(/\/$/, '')}
                    </a>
                  )}
                  {metadata?.lud16 && (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Zap className="size-4" /> {metadata.lud16}
                    </span>
                  )}
                </div>
              </>
            )}

            <div className="mt-6 flex flex-wrap gap-3">
              {user && conversationId ? (
                <>
                  <Button asChild className="h-12 rounded-xl px-6 text-base">
                    <Link to={conversationRoute(conversationId)}>
                      <MessageCircle /> {isMe ? 'Saved messages' : 'Message'}
                    </Link>
                  </Button>
                  {!isMe && (
                    <BuzzButton
                      conversationId={conversationId}
                      variant="large"
                      className="bg-stone-900 text-amber-300 dark:bg-amber-300 dark:text-stone-950"
                      onBuzzed={() => navigate(conversationRoute(conversationId))}
                    />
                  )}
                </>
              ) : (
                <p className="text-muted-foreground">Join to message {name}.</p>
              )}
              <Button variant="outline" className="h-12 rounded-xl" onClick={() => void copy()}>
                <Copy /> Copy npub
              </Button>
            </div>

            <div className="mt-8 flex flex-col items-center gap-4 rounded-2xl border p-5 sm:flex-row">
              <QRCodeCanvas value={`nostr:${npub}`} size={144} className="shrink-0 rounded-xl bg-white p-1.5" />
              <div className="min-w-0 text-center sm:text-left">
                <p className="font-semibold">Scan to chat</p>
                <p className="mt-1 font-mono text-xs break-all text-muted-foreground">{npub}</p>
              </div>
            </div>
          </div>
        </article>
      </main>

      {isMe && <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} />}
    </div>
  );
}
