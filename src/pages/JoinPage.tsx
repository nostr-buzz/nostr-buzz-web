import { useNostr } from '@nostrify/react';
import { useQuery } from '@tanstack/react-query';
import { useSeoMeta } from '@unhead/react';
import { Link2Off, Loader2, Lock, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';

import { LoginArea } from '@/components/auth/LoginArea';
import { Logo } from '@/components/brand/Brand';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import { conversationRoute } from '@/lib/dm/conversation';
import { DEFAULT_INBOX_RELAYS, uniqueRelays } from '@/lib/dm/relays';
import {
  decryptGroupState,
  GROUP_STATE_D,
  GROUP_STATE_KIND,
  type GroupKeys,
  parseInviteLink,
} from '@/lib/groups/groups';
import { sanitizeUrl } from '@/lib/sanitize';

/** /join/<group npub>#k=…  Opens an invite link and lets the user join the group. */
export default function JoinPage() {
  const { npub } = useParams<{ npub: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { nostr } = useNostr();
  const { user } = useCurrentUser();
  const { joinGroup, getConversation } = useDM();
  const { toast } = useToast();
  const [joining, setJoining] = useState(false);

  const invite = useMemo(() => parseInviteLink(npub, location.hash), [npub, location.hash]);

  // Check the link by decrypting the group's current info with the link's key.
  const check = useQuery({
    queryKey: ['group-invite-link', invite?.groupId ?? '', invite?.epochPubkey ?? ''],
    enabled: !!invite,
    retry: 1,
    queryFn: async ({ signal }) => {
      if (!invite) return { status: 'unknown' as const };
      const events = await nostr.query(
        [{ kinds: [GROUP_STATE_KIND], authors: [invite.groupId], '#d': [GROUP_STATE_D], limit: 1 }],
        { signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]), relays: uniqueRelays([...invite.relays, ...DEFAULT_INBOX_RELAYS]) },
      );
      const latest = events.sort((a, b) => b.created_at - a.created_at)[0];
      if (!latest) return { status: 'unknown' as const };
      const keys: GroupKeys = {
        id: invite.groupId,
        current: invite.epochPubkey,
        epochs: { [invite.epochPubkey]: { secret: invite.epochSecret, since: 0 } },
        relays: invite.relays,
        joinedAt: 0,
      };
      const state = decryptGroupState(latest, keys);
      return state === 'removed' ? { status: 'expired' as const } : { status: 'ok' as const, state };
    },
  });

  const state = check.data?.status === 'ok' ? check.data.state : undefined;
  const name = state?.name ?? invite?.name ?? 'Group';
  const picture = sanitizeUrl(state?.picture);
  const existing = invite && user ? getConversation(invite.groupId).group : undefined;
  const isMember = !!existing && !existing.removed;

  useSeoMeta({ title: `Join ${name} · nostr.buzz`, description: 'Group invite on nostr.buzz.' });

  const join = async () => {
    if (!invite) return;
    setJoining(true);
    try {
      const groupId = await joinGroup(invite);
      navigate(conversationRoute(groupId));
    } catch (error) {
      toast({ title: 'Could not join', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="chat-wallpaper flex min-h-dvh flex-col">
      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4">
        <Link to="/" className="rounded-lg">
          <Logo markClassName="size-7" />
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-3xl border bg-background p-8 text-center">
          {!invite ? (
            <Notice icon={<Link2Off className="size-8" />} title="Invalid invite link" />
          ) : check.isLoading ? (
            <div className="flex flex-col items-center gap-3">
              <Skeleton className="size-24 rounded-full" />
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-24" />
            </div>
          ) : check.data?.status === 'expired' ? (
            <Notice icon={<Link2Off className="size-8" />} title="This link has expired" />
          ) : (
            <>
              {picture ? (
                <img src={picture} alt="" className="mx-auto size-24 rounded-full object-cover" />
              ) : (
                <div className="mx-auto flex size-24 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 to-amber-400 text-stone-900">
                  <Users className="size-10" />
                </div>
              )}
              <p className="mt-4 text-sm text-muted-foreground">You're invited to</p>
              <h1 className="font-display text-2xl font-bold break-words" dir="auto">
                {name}
              </h1>
              {state && <p className="mt-1 text-sm text-muted-foreground">{state.members.length} members</p>}
              {state?.about && (
                <p className="mt-3 text-sm whitespace-pre-wrap" dir="auto">
                  {state.about}
                </p>
              )}

              <div className="mt-6">
                {!user ? (
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-sm text-muted-foreground">Log in to join.</p>
                    <LoginArea className="[&_button]:h-11 [&_button]:px-8" />
                  </div>
                ) : isMember ? (
                  <Button asChild className="h-11 w-full rounded-xl">
                    <Link to={conversationRoute(invite.groupId)}>Open group</Link>
                  </Button>
                ) : (
                  <Button className="h-11 w-full rounded-xl" disabled={joining} onClick={() => void join()}>
                    {joining && <Loader2 className="animate-spin" />} Join group
                  </Button>
                )}
              </div>
              <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3" /> End-to-end encrypted
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function Notice({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex flex-col items-center gap-3">
      <span className="text-muted-foreground">{icon}</span>
      <h1 className="font-display text-xl font-bold">{title}</h1>
      <Button asChild variant="outline" className="mt-2 rounded-full">
        <Link to="/">Back to chats</Link>
      </Button>
    </div>
  );
}
