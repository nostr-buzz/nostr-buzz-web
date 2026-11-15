import { lazy, Suspense } from 'react';

import { cn } from '@/lib/utils';

import type { Bee3DProps } from './Bee3DCanvas';

// Start downloading three.js as soon as the app loads, so the bee is ready by the
// time it scrolls into view. There is deliberately no static image placeholder:
// the bee "pops in" with its own entrance animation once the scene is ready.
const bee3DModule = import('./Bee3DCanvas');
const Bee3DCanvas = lazy(() => bee3DModule);

/**
 * Animated 3D nostr.buzz bee (flapping wings, blinking eyes, follows the cursor).
 * Reserves its space while three.js loads, then animates in.
 */
export function Bee3D(props: Bee3DProps) {
  return (
    <Suspense fallback={<div className={cn('relative', props.className)} aria-hidden="true" />}>
      <Bee3DCanvas {...props} />
    </Suspense>
  );
}
