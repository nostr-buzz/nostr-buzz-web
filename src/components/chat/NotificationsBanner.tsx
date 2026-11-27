import { BellRing, Share } from 'lucide-react';
import { useState } from 'react';

import { SetupPrompt } from '@/components/chat/SetupPrompt';
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

  if (push.needsInstall) {
    return (
      <SetupPrompt
        icon={<Share className="size-5" />}
        title="Install for notifications"
        text="Tap Share, then Add to Home Screen."
        dismiss={{ label: 'Got it', onClick: dismiss }}
      />
    );
  }

  return (
    <SetupPrompt
      icon={<BellRing className="size-5" />}
      title="Turn on notifications"
      text="Never miss a message or a buzz."
      action={{ label: 'Turn on', onClick: () => void enable(), disabled: asking }}
      dismiss={{ label: 'Later', onClick: dismiss }}
    />
  );
}
