import { ExternalLink } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { Link, useParams } from 'react-router-dom';

import { BeeMark } from '@/components/brand/Brand';
import { Button } from '@/components/ui/button';
import NotFound from './NotFound';
import { ProfilePage } from './ProfilePage';

export function NIP19Page() {
  const { nip19: identifier } = useParams<{ nip19: string }>();

  if (!identifier) {
    return <NotFound />;
  }

  let decoded;
  try {
    decoded = nip19.decode(identifier);
  } catch {
    return <NotFound />;
  }

  switch (decoded.type) {
    case 'npub':
      return <ProfilePage pubkey={decoded.data} />;

    case 'nprofile':
      return <ProfilePage pubkey={decoded.data.pubkey} />;

    case 'note':
    case 'nevent':
    case 'naddr':
      return <ExternalContent identifier={identifier} />;

    default:
      return <NotFound />;
  }
}

/** nostr.buzz is a messenger, so public posts are handed off to a general Nostr viewer. */
function ExternalContent({ identifier }: { identifier: string }) {
  return (
    <div className="chat-wallpaper flex min-h-dvh items-center justify-center p-6">
      <div className="w-full max-w-md rounded-3xl border bg-background p-8 text-center shadow-lg">
        <BeeMark className="mx-auto size-16" />
        <h1 className="mt-4 font-display text-2xl font-bold">This is a public Nostr post</h1>
        <p className="mt-2 text-muted-foreground">
          nostr.buzz is built for private chats. Open this post in a Nostr viewer instead.
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button asChild className="rounded-full">
            <a href={`https://njump.me/${encodeURIComponent(identifier)}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open on njump.me
            </a>
          </Button>
          <Button asChild variant="outline" className="rounded-full">
            <Link to="/">Back to chats</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
