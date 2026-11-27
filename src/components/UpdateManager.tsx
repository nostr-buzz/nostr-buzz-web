import { RefreshCw } from 'lucide-react';
import { useEffect, useEffectEvent, useMemo, useSyncExternalStore } from 'react';

import { useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import { applyUpdate, checkForUpdate, consumeJustUpdated, getUpdateState, subscribeUpdate } from '@/lib/appUpdate';

/** How often an open app asks whether a new version is live. */
const CHECK_EVERY_MS = 5 * 60 * 1000;
/** Coming back after this long away applies a waiting update before the user starts anything. */
const AWAY_MS = 20 * 1000;
/** With the app open but untouched for this long, a waiting update is applied. */
const IDLE_MS = 60 * 1000;

function isTyping(): boolean {
  const element = document.activeElement;
  return element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement || (element instanceof HTMLElement && element.isContentEditable);
}

/**
 * Updates the app on its own, at moments nobody notices: while it is in the background,
 * right as the user returns to it, or after a minute of inactivity. Someone in the middle
 * of using it gets a small "Update" pill instead. Nothing is lost: drafts are saved, and an
 * update never interrupts a message that is still being sent.
 */
export function UpdateManager() {
  const { conversations } = useDM();
  const { toast } = useToast();
  const update = useSyncExternalStore(subscribeUpdate, getUpdateState, getUpdateState);

  const sending = useMemo(
    () => conversations.some((conversation) => conversation.messages.slice(-5).some((message) => message.status === 'sending')),
    [conversations],
  );

  const applyQuietly = useEffectEvent(() => {
    if (getUpdateState().available && !sending) applyUpdate(true);
  });

  useEffect(() => {
    if (consumeJustUpdated()) toast({ title: 'nostr.buzz was updated 🐝' });
  }, [toast]);

  useEffect(() => {
    let hiddenAt = document.hidden ? Date.now() : 0;
    let lastActivity = Date.now();

    const check = async () => {
      const available = await checkForUpdate();
      if (available && document.hidden) applyQuietly();
    };

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        // Leaving the app: the best moment to swap versions.
        applyQuietly();
        return;
      }
      const away = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = 0;
      lastActivity = Date.now();
      void checkForUpdate().then((available) => {
        if (available && away >= AWAY_MS && !isTyping()) applyQuietly();
      });
    };

    const onActivity = () => {
      lastActivity = Date.now();
    };

    const first = window.setTimeout(() => void check(), 8000);
    const interval = window.setInterval(() => void check(), CHECK_EVERY_MS);
    const idle = window.setInterval(() => {
      if (!document.hidden && Date.now() - lastActivity >= IDLE_MS && !isTyping()) applyQuietly();
    }, 15_000);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', check);
    window.addEventListener('pointerdown', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    return () => {
      window.clearTimeout(first);
      window.clearInterval(interval);
      window.clearInterval(idle);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', check);
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []);

  if (!update.available) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-[80] flex justify-center px-4 pt-[max(0.75rem,env(safe-area-inset-top))]">
      <button
        type="button"
        onClick={() => applyUpdate()}
        className="pointer-events-auto flex items-center gap-2 rounded-full border border-amber-300/70 bg-primary py-2 pr-4 pl-3 text-sm font-semibold text-primary-foreground shadow-lg transition-transform duration-300 animate-in fade-in slide-in-from-top-4 hover:scale-[1.03] active:scale-95 focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:animate-none motion-reduce:transition-none"
      >
        <RefreshCw className="size-4" />
        New version ready. Tap to update
      </button>
    </div>
  );
}
