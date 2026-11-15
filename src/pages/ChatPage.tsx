import { MessageCircleX } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';

import { ConversationView } from '@/components/chat/ConversationView';
import { Button } from '@/components/ui/button';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { conversationIdFromRoute, MAX_GROUP_PARTICIPANTS } from '@/lib/dm/conversation';

export default function ChatPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useCurrentUser();
  if (!user) return null;

  const conversationId = conversationIdFromRoute(id, user.pubkey);
  if (!conversationId) {
    return (
      <div className="chat-wallpaper flex flex-1 items-center justify-center p-6">
        <div className="max-w-sm rounded-3xl border border-dashed bg-background/90 p-8 text-center">
          <MessageCircleX className="mx-auto size-10 text-muted-foreground" />
          <h1 className="mt-3 font-display text-xl font-bold">Chat not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">Invalid link (max {MAX_GROUP_PARTICIPANTS} people).</p>
          <Button asChild className="mt-5 rounded-full">
            <Link to="/">Back to chats</Link>
          </Button>
        </div>
      </div>
    );
  }

  return <ConversationView key={conversationId} conversationId={conversationId} />;
}
