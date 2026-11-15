/**
 * Mobile browsers (iOS Safari above all) keep `100dvh` at full height when the on-screen
 * keyboard opens and pan the page instead. Mirror the visual viewport into CSS variables so
 * the messenger can sit exactly on top of the keyboard, like a native chat app.
 *
 * Sets on <html>:
 * - `--vv-height` / `--vv-top`: the visible area (see `.app-viewport` in index.css)
 * - `data-keyboard`: present while the keyboard is open (drops the bottom safe-area padding)
 */
export function trackVisualViewport(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};

  const root = document.documentElement;
  // Tallest height seen per width, so the keyboard is detected even when the layout viewport shrinks too.
  const tallest = new Map<number, number>();

  const update = () => {
    if (viewport.scale > 1.01) return; // pinch zoom: keep the current layout
    const width = Math.round(viewport.width);
    const height = viewport.height;
    const max = Math.max(tallest.get(width) ?? 0, height);
    tallest.set(width, max);
    root.style.setProperty('--vv-height', `${height}px`);
    root.style.setProperty('--vv-top', `${viewport.offsetTop}px`);
    root.toggleAttribute('data-keyboard', max - height > 150);
  };

  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  return () => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
    root.style.removeProperty('--vv-height');
    root.style.removeProperty('--vv-top');
    root.removeAttribute('data-keyboard');
  };
}
