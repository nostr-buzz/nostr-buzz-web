/**
 * A tiny "tick" for touch gestures (a swipe reaching its trigger point).
 *
 * Android: the Vibration API. iOS has no such API, but toggling a native switch control
 * plays the system haptic (iOS 17.4+), so a hidden one is flipped. Fails silently elsewhere.
 */

let switchLabel: HTMLLabelElement | undefined;

function iosTick(): void {
  if (!switchLabel) {
    const label = document.createElement('label');
    label.setAttribute('aria-hidden', 'true');
    label.style.cssText = 'position:fixed;left:-100px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    input.tabIndex = -1;
    label.appendChild(input);
    document.body.appendChild(label);
    switchLabel = label;
  }
  switchLabel.click();
}

export function hapticTick(): void {
  try {
    if (typeof navigator === 'undefined') return;
    if ('vibrate' in navigator) {
      navigator.vibrate(8);
      return;
    }
    if (typeof document !== 'undefined') iosTick();
  } catch {
    // Haptics are a nicety.
  }
}
