import { BellRing, Share } from 'lucide-react';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { useChatSettings } from '@/hooks/useChatSettings';
import { usePushStatus } from '@/hooks/usePushSync';
import { useToast } from '@/hooks/useToast';
import { requestNotificationPermission } from '@/lib/push/client';

const DISMISSED_KEY = 'nostr-buzz:notifications-prompt';

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === 'dismissed';
  } catch {
    return false;
  }
}

/** Asks once, from the chat list, to turn notifications on (or to install the app on iOS). */
export function NotificationsBanner() {
  const { settings, updateSettings } = useChatSettings();
  const push = usePushStatus();
  const { toast } = useToast();
  const [dismissed, setDismissed] = useState(wasDismissed);
  const [asking, setAsking] = useState(false);

  if (dismissed) return null;
  if (!push.supported && !push.needsInstall) return null;
  if (push.supported && (push.permission === 'denied' || (settings.notifications && push.permission === 'granted'))) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_KEY, 'dismissed');
    } catch {
      // Asking again next time is fine.
    }
  };

  const enable = async () => {
    setAsking(true);
    const permission = await requestNotificationPermission();
    setAsking(false);
    if (permission === 'granted') {
      updateSettings({ notifications: true });
      toast({ title: 'Notifications are on 🐝' });
    } else if (permission === 'denied') {
      toast({ title: 'Notifications are blocked', description: 'Allow them in your browser settings.', variant: 'destructive' });
      dismiss();
    }
  };

  return (
    <div className="mx-3 mb-2 rounded-xl border border-amber-300/70 bg-amber-50 p-3 dark:border-amber-400/20 dark:bg-amber-400/10">
      <div className="flex gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          {push.needsInstall ? <Share className="size-4.5" /> : <BellRing className="size-4.5" />}
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{push.needsInstall ? 'Install for notifications' : 'Turn on notifications'}</p>
          <p className="text-xs text-muted-foreground">
            {push.needsInstall ? 'Tap Share, then Add to Home Screen.' : 'Never miss a message or a buzz.'}
          </p>
        </div>
      </div>
      <div className="mt-3 flex gap-2">
        {!push.needsInstall && (
          <Button size="sm" onClick={() => void enable()} disabled={asking}>
            Turn on
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={dismiss}>
          {push.needsInstall ? 'Got it' : 'Later'}
        </Button>
      </div>
    </div>
  );
}
