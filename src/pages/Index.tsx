import { Lock } from 'lucide-react';

import { Bee3D } from '@/components/brand/Bee3D';
import { Wordmark } from '@/components/brand/Brand';

/** Right-hand pane on desktop when no chat is open. (Phones show the chat list instead.) */
const Index = () => {
  return (
    <div className="chat-wallpaper flex flex-1 items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <Bee3D interactive label="The nostr.buzz bee" className="mx-auto size-64" />
        <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">
          Welcome to <Wordmark />
        </h1>
        <p className="mt-3 text-lg text-muted-foreground">
          Pick a chat on the left, or start a new one. Tap the bee to send a BUZZ that shakes their screen.
        </p>
        <p className="mt-6 inline-flex items-center gap-1.5 rounded-full bg-background/80 px-3 py-1 text-sm text-muted-foreground shadow-sm">
          <Lock className="size-3.5" /> Messages are end-to-end encrypted
        </p>
      </div>
    </div>
  );
};

export default Index;
