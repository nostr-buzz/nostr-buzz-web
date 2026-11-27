import { MoreVertical, PlusSquare, Share } from 'lucide-react';
import type { ReactNode } from 'react';

import { BeeMark } from '@/components/brand/Brand';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { isIOS } from '@/lib/push/client';

/**
 * How to install the app where the browser has no install prompt of its own
 * (Safari on iPhone and iPad, and browsers that hide the option in a menu).
 */
export function InstallHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const ios = isIOS();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="items-center text-center sm:text-center">
          <BeeMark className="size-16" />
          <DialogTitle className="font-display text-xl">Install nostr.buzz</DialogTitle>
          <DialogDescription>Full screen, on your home screen, with notifications.</DialogDescription>
        </DialogHeader>
        <ol className="space-y-3">
          {ios ? (
            <>
              <Step number={1} icon={<Share className="size-5" />}>
                Tap <b>Share</b> in Safari's toolbar.
              </Step>
              <Step number={2} icon={<PlusSquare className="size-5" />}>
                Choose <b>Add to Home Screen</b>.
              </Step>
              <Step number={3}>
                Open it from your home screen.
              </Step>
            </>
          ) : (
            <>
              <Step number={1} icon={<MoreVertical className="size-5" />}>
                Open your browser's menu.
              </Step>
              <Step number={2} icon={<PlusSquare className="size-5" />}>
                Choose <b>Install app</b> or <b>Add to Home screen</b>.
              </Step>
            </>
          )}
        </ol>
      </DialogContent>
    </Dialog>
  );
}

function Step({ number, icon, children }: { number: number; icon?: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-xl bg-muted px-3 py-3">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">{number}</span>
      <span className="min-w-0 flex-1">{children}</span>
      {icon && <span className="shrink-0 text-muted-foreground">{icon}</span>}
    </li>
  );
}
