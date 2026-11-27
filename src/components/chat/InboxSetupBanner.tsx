import { Inbox } from 'lucide-react';
import { useState } from 'react';

import { SetupPrompt } from '@/components/chat/SetupPrompt';
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
    <SetupPrompt
      icon={<Inbox className="size-5" />}
      title="Turn on your inbox"
      text="So others can message you."
      action={{ label: publish.isPending ? 'Enabling…' : 'Enable', onClick: enable, disabled: publish.isPending }}
      dismiss={{ label: 'Later', onClick: () => setDismissed(true) }}
    />
  );
}
