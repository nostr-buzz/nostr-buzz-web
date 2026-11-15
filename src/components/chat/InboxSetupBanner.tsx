import { useState } from 'react';

import { BeeMark } from '@/components/brand/Brand';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDMRelayInfo, usePublishInboxRelays } from '@/hooks/useDMRelays';
import { useToast } from '@/hooks/useToast';
import { DEFAULT_INBOX_RELAYS } from '@/lib/dm/relays';

/** Nudges users without a kind 10050 list to publish one, so others can reach them. */
export function InboxSetupBanner() {
  const { user } = useCurrentUser();
  const info = useDMRelayInfo(user?.pubkey);
  const publish = usePublishInboxRelays();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(false);

  if (!user || dismissed || !info.isSuccess || info.data.inbox.length > 0) return null;

  const enable = () => {
    publish.mutate(DEFAULT_INBOX_RELAYS, {
      onSuccess: () => toast({ title: 'Inbox is on 🐝' }),
      onError: (error) => toast({ title: 'Could not publish inbox', description: error.message, variant: 'destructive' }),
    });
  };

  return (
    <div className="mx-3 mb-2 rounded-xl border border-amber-300/70 bg-amber-50 p-3 dark:border-amber-400/20 dark:bg-amber-400/10">
      <div className="flex gap-3">
        <BeeMark className="size-9 shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-semibold">Turn on your inbox</p>
          <p className="text-xs text-muted-foreground">So others can message you.</p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={enable} disabled={publish.isPending}>
          {publish.isPending ? 'Enabling…' : 'Enable inbox'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setDismissed(true)}>
          Later
        </Button>
      </div>
    </div>
  );
}
