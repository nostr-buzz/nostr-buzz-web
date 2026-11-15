import { useEffect, useState } from 'react';

import { BeeMark } from '@/components/brand/Brand';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useDM } from '@/hooks/useDM';
import { useToast } from '@/hooks/useToast';
import { cn } from '@/lib/utils';

const COOLDOWN_MS = 8000;

interface BuzzButtonProps {
  conversationId: string;
  /** `icon`: round icon button · `pill`: compact labelled · `large`: full-width call to action */
  variant?: 'icon' | 'pill' | 'large';
  className?: string;
  onBuzzed?: () => void;
}

/** Sends a BUZZ!!! that shakes the other person's app. Has a short cooldown. */
export function BuzzButton({ conversationId, variant = 'pill', className, onBuzzed }: BuzzButtonProps) {
  const { sendBuzz, canEncrypt } = useDM();
  const { toast } = useToast();
  const [coolingDown, setCoolingDown] = useState(false);

  useEffect(() => {
    if (!coolingDown) return;
    const timer = window.setTimeout(() => setCoolingDown(false), COOLDOWN_MS);
    return () => window.clearTimeout(timer);
  }, [coolingDown]);

  const disabled = coolingDown || !canEncrypt;

  const handleClick = () => {
    if (disabled) return;
    setCoolingDown(true);
    onBuzzed?.();
    sendBuzz(conversationId).catch((error: unknown) => {
      toast({
        title: 'Buzz failed',
        description: error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      });
    });
  };

  const ring = coolingDown && (
    <svg className="pointer-events-none absolute inset-0 size-full -rotate-90" viewBox="0 0 40 40" aria-hidden="true">
      <circle
        cx="20"
        cy="20"
        r="18"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        pathLength={100}
        className="buzz-cooldown-ring text-amber-700/70 dark:text-amber-200/70"
        style={{ animationDuration: `${COOLDOWN_MS}ms` }}
      />
    </svg>
  );

  const label = coolingDown ? 'Wait a moment' : 'Send a BUZZ';

  if (variant === 'large') {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        aria-label={label}
        className={cn(
          'group relative inline-flex h-12 items-center justify-center gap-2 overflow-hidden rounded-xl bg-primary px-6 font-display text-base font-bold text-primary-foreground shadow-md shadow-amber-500/25 transition-all hover:-translate-y-0.5 hover:shadow-lg active:translate-y-0 disabled:pointer-events-none disabled:opacity-60 focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:outline-none',
          className,
        )}
      >
        <BeeMark className="size-7 transition-transform group-hover:rotate-12 group-active:scale-90" />
        {coolingDown ? 'Buzzed!' : 'BUZZ!'}
      </button>
    );
  }

  const button = (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'group relative inline-flex shrink-0 items-center justify-center rounded-full font-display font-bold transition-all focus-visible:ring-4 focus-visible:ring-ring/40 focus-visible:outline-none disabled:cursor-not-allowed',
        variant === 'icon'
          ? 'size-10 hover:bg-accent'
          : 'h-10 gap-1.5 bg-primary pr-4 pl-2 text-sm text-primary-foreground shadow-sm shadow-amber-500/30 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0',
        coolingDown && 'opacity-70',
        className,
      )}
    >
      {variant === 'icon' && ring}
      <BeeMark className={cn('size-7 transition-transform group-hover:rotate-12 group-active:scale-90', !coolingDown && 'motion-safe:group-hover:bee-wiggle')} />
      {variant === 'pill' && <span>{coolingDown ? 'Buzzed' : 'Buzz'}</span>}
    </button>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent>{canEncrypt ? label : 'Encryption not supported'}</TooltipContent>
    </Tooltip>
  );
}
