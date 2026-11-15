import { lazy, Suspense } from 'react';

import { BeeMark } from '@/components/brand/Brand';
import { cn } from '@/lib/utils';

import type { Bee3DProps } from './Bee3DCanvas';

// three.js is big: load it only when a large bee is actually on screen.
const Bee3DCanvas = lazy(() => import('./Bee3DCanvas'));

/**
 * Animated 3D nostr.buzz bee (flapping wings, blinking eyes, follows the cursor).
 * Shows the PNG bee until three.js has loaded and drawn its first frame.
 */
export function Bee3D(props: Bee3DProps) {
  return (
    <Suspense
      fallback={
        <div className={cn('relative', props.className)} aria-hidden="true">
          <BeeMark className="absolute inset-0 size-full p-[14%]" />
        </div>
      }
    >
      <Bee3DCanvas {...props} />
    </Suspense>
  );
}
