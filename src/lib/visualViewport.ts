/**
 * Native-messenger keyboard handling for the chat shell on phones.
 *
 * Mobile browsers (iOS Safari above all) keep `100dvh` at full height when the on-screen
 * keyboard opens, scroll the page to reveal the focused field, and let the finger drag the
 * page around while the keyboard is up. All of that makes a fixed chat layout jump and shake.
 * While the shell is mounted this module:
 *
 * - mirrors the visual viewport into `--vv-height` / `--vv-top` (see `.app-viewport`), so the
 *   shell always fills exactly the visible area and the composer sits on the keyboard;
 * - sets `data-keyboard` on <html> while the keyboard is open (drops the bottom safe-area padding);
 * - locks the page itself: inside the shell only real scroll areas (message list, chat list...)
 *   move with the finger, and any stray page scroll snaps back;
 * - focuses the composer (`data-keyboard-anchor`) without letting iOS scroll the page.
 *
 * Dialogs and sheets live outside the shell, so iOS keeps revealing their fields as usual.
 */

const SCROLLABLE = /(auto|scroll)/;
const TEXT_INPUT = /^(text|search|url|email|tel|password|number)$/;

function inShell(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest('.app-viewport') !== null;
}

function isTextField(target: EventTarget | null): target is HTMLTextAreaElement | HTMLInputElement {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && TEXT_INPUT.test(target.type);
}

/** The nearest ancestor that can actually scroll along the gesture's axis. */
function scrollArea(target: EventTarget | null, vertical: boolean): HTMLElement | null {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement)) continue;
    const style = getComputedStyle(el);
    if (vertical ? SCROLLABLE.test(style.overflowY) && el.scrollHeight > el.clientHeight + 1 : SCROLLABLE.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      return el;
    }
  }
  return null;
}

export function trackVisualViewport(): () => void {
  const root = document.documentElement;
  const viewport = window.visualViewport;
  root.setAttribute('data-app-shell', '');

  // Installed app (home screen): no browser toolbar, so the shell can use the full screen.
  const standalone =
    window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

  // Tallest height seen per width, so the keyboard is detected even when the layout viewport shrinks too.
  const tallest = new Map<number, number>();
  const update = () => {
    if (!viewport || viewport.scale > 1.01) return; // pinch zoom: keep the current layout
    const width = Math.round(viewport.width);
    const height = viewport.height;
    const max = Math.max(tallest.get(width) ?? 0, height);
    tallest.set(width, max);
    const keyboard = max - height > 150;
    root.toggleAttribute('data-keyboard', keyboard);
    // In the installed app, with the keyboard closed, the shell fills the full screen (100dvh).
    // iOS reports a shorter visual viewport there, which left an empty band under the composer.
    if (standalone && !keyboard) {
      root.style.removeProperty('--vv-height');
      root.style.removeProperty('--vv-top');
      return;
    }
    root.style.setProperty('--vv-height', `${height}px`);
    root.style.setProperty('--vv-top', `${viewport.offsetTop}px`);
  };

  // The page never scrolls: the shell is fixed. Undo anything iOS does on its own,
  // unless it is revealing a field in a dialog (those sit outside the shell).
  const resetScroll = () => {
    const focused = document.activeElement;
    if (isTextField(focused) && !inShell(focused)) return;
    if (window.scrollY !== 0 || window.scrollX !== 0) window.scrollTo(0, 0);
  };
  // Keep a focused field of the shell (e.g. in settings) visible inside its own pane.
  const revealFocused = () => {
    const focused = document.activeElement;
    if (isTextField(focused) && inShell(focused) && root.hasAttribute('data-keyboard')) {
      focused.scrollIntoView({ block: 'nearest' });
    }
  };
  const onViewportChange = () => {
    resetScroll();
    update();
    revealFocused();
  };

  let lastX = 0;
  let lastY = 0;
  let moved = false;
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    lastX = touch.clientX;
    lastY = touch.clientY;
    moved = false;
  };

  // Let only real scroll areas follow the finger, and never chain past their edges into the page.
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1 || !event.cancelable || !inShell(event.target)) return;
    const touch = event.touches[0];
    const dx = touch.clientX - lastX;
    const dy = touch.clientY - lastY;
    lastX = touch.clientX;
    lastY = touch.clientY;
    if (dx === 0 && dy === 0) return;
    moved = true;
    if (event.target instanceof Element && event.target.closest('input[type="range"], audio, video')) return;

    const vertical = Math.abs(dy) >= Math.abs(dx);
    const area = scrollArea(event.target, vertical);
    if (!area) {
      event.preventDefault();
      return;
    }
    if (vertical) {
      const atTop = area.scrollTop <= 0;
      const atBottom = area.scrollTop + area.clientHeight >= area.scrollHeight - 1;
      if ((dy > 0 && atTop) || (dy < 0 && atBottom)) event.preventDefault();
    }
  };

  // iOS scrolls the page to reveal a field as the keyboard opens. Focus it while it is
  // moved far above the screen, so iOS sees nothing to reveal and the layout stays put.
  const onTouchEnd = (event: TouchEvent) => {
    const field = event.target;
    if (moved || !event.cancelable || !isTextField(field) || !field.hasAttribute('data-keyboard-anchor')) return;
    if (field === document.activeElement || field.disabled || field.readOnly) return;
    event.preventDefault();
    field.style.transform = 'translateY(-99999px)';
    field.focus({ preventScroll: true });
    if (field instanceof HTMLTextAreaElement) field.setSelectionRange(field.value.length, field.value.length);
    requestAnimationFrame(() => requestAnimationFrame(() => field.style.removeProperty('transform')));
  };

  update();
  viewport?.addEventListener('resize', onViewportChange);
  viewport?.addEventListener('scroll', onViewportChange);
  window.addEventListener('scroll', resetScroll);
  document.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
  document.addEventListener('touchmove', onTouchMove, { passive: false, capture: true });
  document.addEventListener('touchend', onTouchEnd, { passive: false, capture: true });

  return () => {
    viewport?.removeEventListener('resize', onViewportChange);
    viewport?.removeEventListener('scroll', onViewportChange);
    window.removeEventListener('scroll', resetScroll);
    document.removeEventListener('touchstart', onTouchStart, { capture: true });
    document.removeEventListener('touchmove', onTouchMove, { capture: true });
    document.removeEventListener('touchend', onTouchEnd, { capture: true });
    root.style.removeProperty('--vv-height');
    root.style.removeProperty('--vv-top');
    root.removeAttribute('data-keyboard');
    root.removeAttribute('data-app-shell');
  };
}
