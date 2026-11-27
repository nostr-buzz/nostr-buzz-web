import { useSeoMeta } from '@unhead/react';
import { useEffect } from 'react';
import { Outlet, useLocation, useNavigationType } from 'react-router-dom';

import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { Landing } from '@/components/landing/Landing';
import { useChatSettings } from '@/hooks/useChatSettings';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { cn } from '@/lib/utils';
import { trackVisualViewport } from '@/lib/visualViewport';

/**
 * Two-pane messenger layout. On phones only one pane shows at a time:
 * the chat list on "/", the open chat / settings everywhere else.
 */
export function AppShell() {
  const { user } = useCurrentUser();
  const { totalUnread } = useDM();
  const { settings } = useChatSettings();
  const location = useLocation();
  const navigationType = useNavigationType();

  useSeoMeta({
    title: totalUnread > 0 ? `(${totalUnread}) nostr.buzz` : 'nostr.buzz',
    description: 'Private chats on Nostr with a BUZZ.',
  });

  // Keep the composer right on top of the mobile keyboard.
  useEffect(() => (user ? trackVisualViewport() : undefined), [user]);

  // Layout for iPhones that leave an unpainted strip at the bottom (can be turned off in settings).
  useEffect(() => {
    document.documentElement.toggleAttribute('data-fill-screen', settings.fullScreen);
    return () => document.documentElement.removeAttribute('data-fill-screen');
  }, [settings.fullScreen]);

  if (!user) return <Landing />;

  const isHome = location.pathname === '/';
  // Slide panes only for taps inside the app: the system back gesture animates on its own.
  const animate = navigationType === 'PUSH';

  return (
    <div className="app-viewport flex w-full overflow-hidden bg-background">
      <aside
        aria-label="Chats"
        className={cn(
          'h-full w-full min-w-0 flex-col border-r bg-sidebar md:flex md:w-[360px] md:shrink-0 lg:w-[400px]',
          isHome ? 'flex' : 'hidden',
          animate && 'pane-pop',
        )}
      >
        <ChatSidebar />
      </aside>
      <main className={cn('h-full min-w-0 flex-1 flex-col', isHome ? 'hidden md:flex' : 'flex', animate && 'pane-push')}>
        <Outlet />
      </main>
    </div>
  );
}
