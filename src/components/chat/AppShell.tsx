import { useSeoMeta } from '@unhead/react';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

import { ChatSidebar } from '@/components/chat/ChatSidebar';
import { Landing } from '@/components/landing/Landing';
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
  const location = useLocation();

  useSeoMeta({
    title: totalUnread > 0 ? `(${totalUnread}) nostr.buzz` : 'nostr.buzz',
    description: 'Private chats on Nostr with a BUZZ.',
  });

  // Keep the composer right on top of the mobile keyboard.
  useEffect(() => (user ? trackVisualViewport() : undefined), [user]);

  if (!user) return <Landing />;

  const isHome = location.pathname === '/';

  return (
    <div className="app-viewport flex w-full overflow-hidden bg-background">
      <aside
        aria-label="Chats"
        className={cn(
          'h-full w-full min-w-0 flex-col border-r bg-sidebar md:flex md:w-[360px] md:shrink-0 lg:w-[400px]',
          isHome ? 'flex' : 'hidden',
        )}
      >
        <ChatSidebar />
      </aside>
      <main className={cn('h-full min-w-0 flex-1 flex-col', isHome ? 'hidden md:flex' : 'flex')}>
        <Outlet />
      </main>
    </div>
  );
}
