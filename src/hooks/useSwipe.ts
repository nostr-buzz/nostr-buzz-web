import { type RefObject, useEffect, useEffectEvent } from 'react';

export interface SwipeHandlers {
  /** A horizontal drag was recognised. Return false to refuse it. */
  onStart?: () => boolean | void;
  /** Finger moved: `dx` is the distance from where the drag was recognised. */
  onMove: (dx: number) => void;
  /** Finger lifted. `velocity` is in px/ms, negative when moving left. */
  onEnd: (dx: number, velocity: number) => void;
}

/** How far the finger must travel before a drag counts as a swipe. */
const SLOP = 10;

/**
 * Horizontal swipe gestures for touch screens.
 *
 * The element should have `touch-action: pan-y` so the browser keeps vertical scrolling
 * and leaves sideways drags to us. Handlers are called outside React rendering: move the
 * element by writing styles directly, so a swipe never re-renders the list.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, handlers: SwipeHandlers, enabled = true): void {
  const start = useEffectEvent(() => handlers.onStart?.());
  const move = useEffectEvent((dx: number) => handlers.onMove(dx));
  const end = useEffectEvent((dx: number, velocity: number) => handlers.onEnd(dx, velocity));

  useEffect(() => {
    const element = ref.current;
    if (!element || !enabled) return;

    let pointer: number | undefined;
    let swiping = false;
    let originX = 0;
    let originY = 0;
    let lastX = 0;
    let lastT = 0;
    let velocity = 0;

    const reset = () => {
      pointer = undefined;
      swiping = false;
    };

    // The tap that ends a swipe must not open the chat underneath.
    const swallowClick = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'mouse' || !event.isPrimary || pointer !== undefined) return;
      pointer = event.pointerId;
      swiping = false;
      originX = lastX = event.clientX;
      originY = event.clientY;
      lastT = event.timeStamp;
      velocity = 0;
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerId !== pointer) return;
      const dx = event.clientX - originX;
      const dy = event.clientY - originY;
      if (!swiping) {
        if (Math.abs(dy) > SLOP && Math.abs(dy) >= Math.abs(dx)) {
          reset();
          return;
        }
        if (Math.abs(dx) < SLOP || Math.abs(dx) < Math.abs(dy) * 1.5) return;
        if (start() === false) {
          reset();
          return;
        }
        swiping = true;
        // Start from here, so the row doesn't jump by the slop distance.
        originX = event.clientX;
        try {
          element.setPointerCapture(event.pointerId);
        } catch {
          // The pointer is already gone.
        }
      }
      const elapsed = event.timeStamp - lastT;
      if (elapsed > 0) {
        const instant = (event.clientX - lastX) / elapsed;
        velocity = velocity * 0.6 + instant * 0.4;
      }
      lastX = event.clientX;
      lastT = event.timeStamp;
      move(event.clientX - originX);
    };

    const finish = (event: PointerEvent, cancelled: boolean) => {
      if (event.pointerId !== pointer) return;
      const wasSwiping = swiping;
      const dx = event.clientX - originX;
      reset();
      if (!wasSwiping) return;
      element.addEventListener('click', swallowClick, { capture: true, once: true });
      setTimeout(() => element.removeEventListener('click', swallowClick, { capture: true }), 350);
      // A finger resting before release should not count as a flick.
      const resting = event.timeStamp - lastT > 80;
      end(cancelled ? 0 : dx, cancelled || resting ? 0 : velocity);
    };

    const onUp = (event: PointerEvent) => finish(event, false);
    const onCancel = (event: PointerEvent) => finish(event, true);

    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onCancel);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onCancel);
      element.removeEventListener('click', swallowClick, { capture: true });
    };
  }, [ref, enabled]);
}

/* ------------------------------ one open row ------------------------------ */

/** Only one list row stays swiped open at a time, like in native lists. */
let openRow: { owner: object; close: () => void } | undefined;

/** Close whichever row is open, unless it belongs to `owner`. */
export function closeOtherRows(owner?: object): void {
  if (!openRow || openRow.owner === owner) return;
  const { close } = openRow;
  openRow = undefined;
  close();
}

/** Mark `owner`'s row as the open one (closing any other). */
export function claimOpenRow(owner: object, close: () => void): void {
  closeOtherRows(owner);
  openRow = { owner, close };
}

export function releaseOpenRow(owner: object): void {
  if (openRow?.owner === owner) openRow = undefined;
}

if (typeof document !== 'undefined') {
  // Touching anywhere else, or scrolling the list, closes the open row.
  document.addEventListener(
    'pointerdown',
    (event) => {
      const inside = event.target instanceof Element && event.target.closest('[data-swipe-open]');
      if (!inside) closeOtherRows();
    },
    { capture: true, passive: true },
  );
  document.addEventListener('scroll', () => closeOtherRows(), { capture: true, passive: true });
}
