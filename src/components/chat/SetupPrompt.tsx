import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';

interface SetupPromptProps {
  /** Shown in a round badge on the left. */
  icon: ReactNode;
  title: string;
  text: string;
  /** The main action, on the far right. Omit for prompts that only inform. */
  action?: { label: string; onClick: () => void; disabled?: boolean };
  /** The quiet "not now" action next to it. */
  dismiss: { label: string; onClick: () => void };
}

/** A one-step setup card at the top of the chat list (inbox, notifications, install). */
export function SetupPrompt({ icon, title, text, action, dismiss }: SetupPromptProps) {
  return (
    <section
      aria-label={title}
      className="mx-3 mb-2 rounded-2xl border border-amber-300/70 bg-amber-50 p-3 dark:border-amber-400/20 dark:bg-amber-400/10"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{title}</p>
          <p className="text-sm text-muted-foreground">{text}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <Button size="sm" variant="ghost" className="h-9 rounded-full px-4" onClick={dismiss.onClick}>
          {dismiss.label}
        </Button>
        {action && (
          <Button size="sm" className="h-9 rounded-full px-5" onClick={action.onClick} disabled={action.disabled}>
            {action.label}
          </Button>
        )}
      </div>
    </section>
  );
}
