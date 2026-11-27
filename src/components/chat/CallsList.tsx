import { ArrowDownLeft, ArrowUpRight, Phone, Video } from 'lucide-react';
import { Link } from 'react-router-dom';

import { AuthorName, UserAvatar } from '@/components/chat/UserAvatar';
import type { CallEntry } from '@/hooks/useCallHistory';
import { useCalls } from '@/hooks/useCalls';
import { conversationRoute } from '@/lib/dm/conversation';
import { formatListTime } from '@/lib/format';
import { cn } from '@/lib/utils';

/** The app's own call log: who, which way, when, and a button to call again. */
export function CallsList({ entries }: { entries: CallEntry[] }) {
  const calls = useCalls();
  const canCall = calls.supported && calls.phase === 'idle';

  if (entries.length === 0) {
    return <p className="px-4 py-10 text-center text-sm text-muted-foreground">No calls yet.</p>;
  }

  return (
    <ul className="space-y-0.5">
      {entries.map(({ message, peer, outgoing, video }) => (
        <li key={message.id} className="flex items-center gap-1 rounded-xl pr-1 hover:bg-accent/70">
          <Link
            to={conversationRoute(peer)}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-3 py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <UserAvatar pubkey={peer} className="size-13" />
            <span className="min-w-0 flex-1">
              <AuthorName pubkey={peer} className="block truncate font-semibold" />
              <span className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                {outgoing ? (
                  <ArrowUpRight className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                ) : (
                  <ArrowDownLeft className="size-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden="true" />
                )}
                <span className="truncate">
                  {outgoing ? 'Outgoing' : 'Incoming'} {video ? 'video' : 'voice'} call
                </span>
              </span>
            </span>
            <time dateTime={new Date(message.created_at * 1000).toISOString()} className="shrink-0 text-xs text-muted-foreground">
              {formatListTime(message.created_at)}
            </time>
          </Link>
          <button
            type="button"
            disabled={!canCall}
            aria-label={`${video ? 'Video' : 'Voice'} call`}
            onClick={() => calls.startCall(peer, video)}
            className={cn(
              'flex size-11 shrink-0 items-center justify-center rounded-full text-amber-600 transition-colors hover:bg-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none dark:text-amber-400',
              !canCall && 'opacity-40',
            )}
          >
            {video ? <Video className="size-5" /> : <Phone className="size-5" />}
          </button>
        </li>
      ))}
    </ul>
  );
}
