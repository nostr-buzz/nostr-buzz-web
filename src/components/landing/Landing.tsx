import { Lock } from 'lucide-react';

import { LoginArea } from '@/components/auth/LoginArea';
import { Bee3D } from '@/components/brand/Bee3D';
import { Logo } from '@/components/brand/Brand';

/** The page people see before they join: one screen, one message, one button. */
export function Landing() {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex w-full max-w-5xl items-center px-6 pt-[max(1.25rem,env(safe-area-inset-top))]">
        <Logo markClassName="size-8" />
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-6 py-10 text-center">
        <Bee3D interactive label="The nostr.buzz bee" className="size-56 sm:size-64" />

        <h1 className="mt-4 font-display text-5xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl">
          Private chats with a <span className="text-amber-500">BUZZ</span>
        </h1>
        <p className="mt-5 text-lg text-muted-foreground sm:text-xl">No phone number. No email. Just you and your friends.</p>

        <LoginArea className="mt-9 [&_button]:h-13 [&_button]:px-10 [&_button]:text-lg" />

        <p className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground">
          <Lock className="size-3.5" /> End-to-end encrypted on Nostr
        </p>
      </main>

      <footer className="pb-[max(1.25rem,env(safe-area-inset-bottom))] text-center text-sm text-muted-foreground">
        Free and open source
      </footer>
    </div>
  );
}
