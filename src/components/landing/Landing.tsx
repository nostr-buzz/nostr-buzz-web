import { ImageIcon, KeyRound, Lock, Smartphone, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { LoginArea } from '@/components/auth/LoginArea';
import { Bee3D } from '@/components/brand/Bee3D';
import { BeeMark, Logo, Wordmark } from '@/components/brand/Brand';
import { Button } from '@/components/ui/button';
import { useBuzz } from '@/hooks/useBuzz';

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <BeeMark className="size-7" />,
    title: 'Send a BUZZ',
    body: "Friend not answering? Shake their whole screen with the classic buzz sound — just like the good old days.",
  },
  {
    icon: <Lock className="size-6" />,
    title: 'Truly private',
    body: 'NIP-17 gift-wrapped messages hide what you say, who you talk to, and when — even from relays.',
  },
  {
    icon: <Users className="size-6" />,
    title: 'Group chats',
    body: 'Encrypted groups for up to 10 people. No admins, no central server, no one reading along.',
  },
  {
    icon: <ImageIcon className="size-6" />,
    title: 'Encrypted files',
    body: 'Photos, videos and documents are encrypted on your device before they are uploaded.',
  },
  {
    icon: <KeyRound className="size-6" />,
    title: 'Your key, your identity',
    body: 'No phone number, no email. One Nostr key works across every Nostr app you love.',
  },
  {
    icon: <Smartphone className="size-6" />,
    title: 'Made for phones',
    body: 'Fast and fluid on any screen. Add nostr.buzz to your home screen and use it like a native app.',
  },
];

export function Landing() {
  const { triggerBuzz } = useBuzz();

  return (
    <div className="min-h-dvh overflow-x-hidden bg-background">
      <header className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 md:px-8">
        <Logo markClassName="size-9" />
        <LoginArea className="max-w-60" />
      </header>

      <main>
        <section className="relative isolate">
          <div
            aria-hidden="true"
            className="chat-wallpaper absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_top,black_30%,transparent_75%)]"
          />
          <div
            aria-hidden="true"
            className="absolute top-10 left-1/2 -z-10 size-[36rem] -translate-x-1/2 rounded-full bg-amber-300/30 blur-3xl dark:bg-amber-500/10"
          />
          <div className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-10 pb-20 md:grid-cols-[1.1fr_1fr] md:px-8 md:pt-16 md:pb-28">
            <div>
              <p className="inline-flex items-center gap-2 rounded-full border bg-background/80 px-3 py-1 text-sm font-medium shadow-sm backdrop-blur">
                <Lock className="size-3.5 text-amber-600 dark:text-amber-400" /> End-to-end encrypted on Nostr
              </p>
              <h1 className="mt-6 font-display text-5xl leading-[1.04] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl">
                Private chats with a{' '}
                <span className="relative inline-block text-amber-500">
                  BUZZ!
                  <BeeMark className="bee-float absolute top-0 -right-11 size-10 sm:-right-16 sm:size-14" />
                </span>
              </h1>
              <p className="mt-6 max-w-xl text-lg text-muted-foreground md:text-xl">
                nostr.buzz is a fast, beautiful messenger built on Nostr. No phone number, no central server — and
                when they don't answer, you can shake their whole screen.
              </p>
              <div className="mt-9 flex flex-wrap items-center gap-3">
                <LoginArea className="[&_button]:h-12 [&_button]:px-8 [&_button]:text-base" />
                <Button
                  variant="outline"
                  className="h-12 rounded-full px-6 text-base"
                  onClick={() => triggerBuzz({})}
                >
                  <BeeMark className="size-6" /> Feel a buzz
                </Button>
              </div>
              <p className="mt-4 text-sm text-muted-foreground">Free and open. Works with any Nostr key or signer extension.</p>
            </div>

            <PhoneMock />
          </div>
        </section>

        <section aria-labelledby="features" className="mx-auto max-w-6xl px-4 pb-24 md:px-8">
          <h2 id="features" className="text-center font-display text-4xl font-extrabold tracking-tight md:text-5xl">
            Everything you need. <span className="text-amber-600 dark:text-amber-400">Nothing you don't.</span>
          </h2>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <li
                key={feature.title}
                className="rounded-2xl border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md motion-reduce:hover:translate-y-0"
              >
                <span className="flex size-12 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300">
                  {feature.icon}
                </span>
                <h3 className="mt-4 font-display text-xl font-bold">{feature.title}</h3>
                <p className="mt-2 text-lg leading-relaxed text-muted-foreground">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="px-4 pb-24 md:px-8">
          <div className="relative isolate mx-auto max-w-4xl overflow-hidden rounded-3xl bg-stone-950 px-6 py-14 text-center text-stone-50 shadow-xl md:px-16">
            <div aria-hidden="true" className="chat-wallpaper absolute inset-0 -z-10 opacity-40 dark" />
            <Bee3D interactive className="mx-auto size-40" />
            <h2 className="mt-2 font-display text-4xl font-extrabold tracking-tight md:text-5xl">Ready to buzz?</h2>
            <p className="mx-auto mt-4 max-w-lg text-lg text-stone-300">
              Create a key in seconds or log in with the one you already use on Nostr.
            </p>
            <div className="mt-8 flex justify-center">
              <LoginArea className="[&_button]:h-12 [&_button]:px-10 [&_button]:text-base" />
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row md:px-8">
          <Wordmark className="text-base text-foreground" />
          <p>Built on Nostr · NIP-17 private messages · Open source</p>
        </div>
      </footer>
    </div>
  );
}

function PhoneMock() {
  return (
    <div className="relative mx-auto w-full max-w-[20rem] pt-24 sm:pt-28">
      <Bee3D
        interactive
        label="The nostr.buzz bee"
        className="absolute top-0 -left-14 z-10 size-48 sm:-left-36 sm:size-64 lg:-top-4 lg:-left-48 lg:size-72"
      />
      <div aria-hidden="true" className="phone-buzzrounded-[2.75rem] border-[10px] border-stone-900 bg-stone-900 shadow-2xl shadow-amber-900/20 dark:border-stone-700">
        <div className="overflow-hidden rounded-[2rem] bg-background">
          <div className="flex items-center gap-3 border-b bg-background px-4 py-3">
            <span className="flex size-9 items-center justify-center rounded-full bg-violet-600 font-semibold text-white">A</span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">Ava</p>
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Lock className="size-2.5" /> End-to-end encrypted
              </p>
            </div>
            <BeeMark className="ml-auto size-7" />
          </div>
          <div className="chat-wallpaper space-y-2 px-3 py-4 text-sm">
            <Bubble>Are you coming tonight? 🎉</Bubble>
            <Bubble mine>Running a bit late 😅</Bubble>
            <Bubble>The cake is getting cold…</Bubble>
            <div className="flex justify-center py-1">
              <span className="flex items-center gap-1.5 rounded-full border border-amber-300/80 bg-amber-100 py-0.5 pr-3 pl-1 text-xs font-semibold text-amber-950 dark:border-amber-400/30 dark:bg-amber-400/15 dark:text-amber-100">
                <BeeMark className="size-5" /> Ava sent you a BUZZ!!!
              </span>
            </div>
            <Bubble mine>OK OK I'm on my way!! 🏃‍♀️</Bubble>
            <div className="flex justify-end">
              <span className="text-4xl">🐝</span>
            </div>
          </div>
          <div className="flex items-center gap-2 border-t px-3 py-2.5">
            <span className="h-9 flex-1 rounded-full border bg-card" />
            <span className="flex size-9 items-center justify-center rounded-full bg-primary">
              <BeeMark className="size-6" />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Bubble({ children, mine = false }: { children: ReactNode; mine?: boolean }) {
  return (
    <div className={mine ? 'flex justify-end' : 'flex justify-start'}>
      <span
        className={
          mine
            ? 'max-w-[80%] rounded-2xl rounded-br-md bg-bubble-out px-3 py-1.5 text-bubble-out-foreground shadow-sm'
            : 'max-w-[80%] rounded-2xl rounded-bl-md bg-bubble-in px-3 py-1.5 text-bubble-in-foreground shadow-sm'
        }
      >
        {children}
      </span>
    </div>
  );
}
