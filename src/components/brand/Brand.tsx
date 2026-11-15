import { cn } from '@/lib/utils';

/** The nostr.buzz bee mascot. Decorative by default. */
export function BeeMark({ className, wiggle = false }: { className?: string; wiggle?: boolean }) {
  return (
    <img
      src="/bee.png"
      alt=""
      width={384}
      height={384}
      draggable={false}
      className={cn('select-none object-contain', wiggle && 'bee-wiggle', className)}
    />
  );
}

/** "nostr.buzz" wordmark with the honey-colored ".buzz". */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('font-display font-extrabold tracking-tight', className)}>
      nostr<span className="text-amber-600 dark:text-amber-400">.buzz</span>
    </span>
  );
}

export function Logo({ className, markClassName }: { className?: string; markClassName?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <BeeMark className={cn('size-8', markClassName)} />
      <Wordmark className="text-xl" />
    </span>
  );
}
