import { useEffect, useRef, useState } from 'react';

import { BeeMark } from '@/components/brand/Brand';
import { cn } from '@/lib/utils';

import { BeeScene } from './beeScene';

export interface Bee3DProps {
  className?: string;
  /** Follow the cursor and buzz on click. */
  interactive?: boolean;
  /** Accessible name; the bee is decorative when omitted. */
  label?: string;
}

/** WebGL canvas that hosts the animated 3D bee. Loaded lazily by <Bee3D />. */
export default function Bee3DCanvas({ className, interactive = false, label }: Bee3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    let scene: BeeScene;
    try {
      scene = new BeeScene(canvas, { interactive, reducedMotion, onReady: () => setReady(true) });
    } catch (error) {
      // No WebGL: the PNG bee underneath stays visible.
      console.warn('3D bee unavailable', error);
      return;
    }

    let onScreen = true;
    const sync = () => {
      if (onScreen && document.visibilityState === 'visible') scene.play();
      else scene.pause();
    };

    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      scene.setSize(width, height);
    });
    resize.observe(container);

    const visibility = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      sync();
    });
    visibility.observe(container);
    document.addEventListener('visibilitychange', sync);

    return () => {
      resize.disconnect();
      visibility.disconnect();
      document.removeEventListener('visibilitychange', sync);
      scene.dispose();
    };
  }, [interactive]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', className)}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <BeeMark
        className={cn(
          'absolute inset-0 size-full p-[14%] transition-opacity duration-500',
          ready ? 'opacity-0' : 'opacity-100',
        )}
      />
      <canvas
        ref={canvasRef}
        className={cn(
          'absolute inset-0 size-full transition-opacity duration-500',
          ready ? 'opacity-100' : 'opacity-0',
          interactive && 'cursor-pointer',
        )}
      />
    </div>
  );
}
