import type { NostrMetadata } from '@nostrify/nostrify';
import { useQueryClient } from '@tanstack/react-query';
import { Bookmark, LogOut, MessageSquarePlus, Moon, Search, Settings, SquarePen, UserIcon, UserPlus, X } from 'lucide-react';
import { nip19 } from 'nostr-tools';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import AuthDialog from '@/components/auth/AuthDialog';
import { BeeMark, Logo } from '@/components/brand/Brand';
import { ChatListItem } from '@/components/chat/ChatListItem';
import { InboxSetupBanner } from '@/components/chat/InboxSetupBanner';
import { NewChatDialog } from '@/components/chat/NewChatDialog';
import { UserAvatar } from '@/components/chat/UserAvatar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useDM } from '@/hooks/useDM';
import { useLoggedInAccounts } from '@/hooks/useLoggedInAccounts';
import { useLoginActions } from '@/hooks/useLoginActions';
import { useTheme } from '@/hooks/useTheme';
import { conversationRoute } from '@/lib/dm/conversation';
import type { Conversation } from '@/lib/dm/types';
import { displayName, shortNpub } from '@/lib/format';
import { cn } from '@/lib/utils';

type Tab = 'chats' | 'requests';

export function ChatSidebar() {
  const { conversations, status, requestCount, activeConversationId } = useDM();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('chats');
  const [newChatOpen, setNewChatOpen] = useState(false);
  const activeTab: Tab = requestCount === 0 ? 'chats' : tab;

  const visible = useMemo(() => {
    const list = conversations.filter((c) => (activeTab === 'requests' ? c.isRequest : !c.isRequest));
    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    const nameOf = (pubkey: string) => {
      const metadata = queryClient.getQueryData<{ metadata?: NostrMetadata }>(['nostr', 'author', pubkey])?.metadata;
      return [metadata?.display_name, metadata?.name, metadata?.nip05, nip19.npubEncode(pubkey)].join(' ').toLowerCase();
    };
    return list.filter((c: Conversation) => {
      if (c.isSelf && 'saved messages'.includes(needle)) return true;
      if (c.subject?.toLowerCase().includes(needle)) return true;
      if (c.participants.some((p) => nameOf(p).includes(needle))) return true;
      return c.messages.some((m) => m.content.toLowerCase().includes(needle));
    });
  }, [conversations, activeTab, query, queryClient]);

  const loading = status === 'loading' && conversations.length === 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2">
        <MainMenu />
        <Link to="/" className="mr-auto rounded-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Logo markClassName="size-7" />
        </Link>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="New chat" onClick={() => setNewChatOpen(true)}>
          <SquarePen className="size-5" />
        </Button>
      </header>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search chats and messages"
            aria-label="Search chats and messages"
            dir="auto"
            className="h-10 rounded-full border-transparent bg-muted pr-9 pl-9 shadow-none focus-visible:bg-background"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 right-2 flex size-6 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </div>

      {requestCount > 0 && (
        <div role="tablist" aria-label="Chat folders" className="flex gap-1 px-3 pb-2">
          {(['chats', 'requests'] as const).map((value) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={activeTab === value}
              onClick={() => setTab(value)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                activeTab === value ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-accent',
              )}
            >
              {value === 'chats' ? 'Chats' : `Requests · ${requestCount}`}
            </button>
          ))}
        </div>
      )}

      <InboxSetupBanner />

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-28 scrollbar-thin">
        {loading ? (
          <ChatListSkeleton />
        ) : visible.length > 0 ? (
          <ul className="space-y-0.5">
            {activeTab === 'requests' && (
              <li className="px-3 pt-1 pb-2 text-xs text-muted-foreground">
                Messages from people you don't follow. Reply to move them to your chats. Their buzzes won't shake your
                screen.
              </li>
            )}
            {visible.map((conversation) => (
              <li key={conversation.id}>
                <ChatListItem conversation={conversation} active={conversation.id === activeConversationId} />
              </li>
            ))}
          </ul>
        ) : query ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">No chats match “{query}”.</p>
        ) : (
          <EmptyChats onNewChat={() => setNewChatOpen(true)} />
        )}
      </nav>

      <button
        type="button"
        onClick={() => setNewChatOpen(true)}
        aria-label="Start a new chat"
        className="absolute right-5 bottom-[max(1.25rem,env(safe-area-inset-bottom))] flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg shadow-amber-500/30 transition-transform hover:scale-105 active:scale-95 focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:outline-none motion-reduce:transition-none"
      >
        <MessageSquarePlus className="size-6" />
      </button>

      <NewChatDialog open={newChatOpen} onOpenChange={setNewChatOpen} />
    </div>
  );
}

function ChatListSkeleton() {
  return (
    <div className="space-y-1 px-1" aria-busy="true" aria-label="Loading chats">
      {Array.from({ length: 7 }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-2 py-2.5">
          <Skeleton className="size-12 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-4/5" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyChats({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="mx-2 mt-6 rounded-2xl border border-dashed px-6 py-10 text-center">
      <BeeMark className="bee-float mx-auto size-20" />
      <p className="mt-4 font-display text-lg font-bold">No chats yet</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
        Start a private conversation with anyone on Nostr — then give them a BUZZ to say hi.
      </p>
      <Button className="mt-5 rounded-full" onClick={onNewChat}>
        <SquarePen /> New chat
      </Button>
    </div>
  );
}

function MainMenu() {
  const { user, metadata } = useCurrentUser();
  const { otherUsers, setLogin } = useLoggedInAccounts();
  const { logout } = useLoginActions();
  const { setTheme } = useTheme();
  const navigate = useNavigate();
  const [authOpen, setAuthOpen] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  if (!user) return null;
  const npub = nip19.npubEncode(user.pubkey);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Open menu"
            className="shrink-0 rounded-full transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
          >
            <UserAvatar pubkey={user.pubkey} className="size-10" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64 p-1.5">
          <DropdownMenuLabel className="flex items-center gap-3 py-2">
            <UserAvatar pubkey={user.pubkey} className="size-10" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold" dir="auto">
                {displayName(user.pubkey, metadata)}
              </span>
              <span className="block truncate text-xs font-normal text-muted-foreground">{shortNpub(user.pubkey)}</span>
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => navigate(`/${npub}`)}>
            <UserIcon /> My profile
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate(conversationRoute(user.pubkey))}>
            <Bookmark /> Saved messages
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/settings')}>
            <Settings /> Settings
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => setTheme(document.documentElement.classList.contains('dark') ? 'light' : 'dark')}
          >
            <Moon /> Toggle dark mode
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          {otherUsers.map((account) => (
            <DropdownMenuItem key={account.id} onSelect={() => setLogin(account.id)}>
              <UserAvatar pubkey={account.pubkey} className="size-6" />
              <span className="truncate">Switch to {displayName(account.pubkey, account.metadata)}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuItem onSelect={() => setAuthOpen(true)}>
            <UserPlus /> Add account
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmLogout(true)}>
            <LogOut /> Log out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AuthDialog isOpen={authOpen} onClose={() => setAuthOpen(false)} />

      <AlertDialog open={confirmLogout} onOpenChange={setConfirmLogout}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Log out of nostr.buzz?</AlertDialogTitle>
            <AlertDialogDescription>
              If you logged in with a secret key (nsec), make sure it's backed up — you'll need it to get back into
              your chats.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                void logout();
                navigate('/');
              }}
            >
              Log out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
