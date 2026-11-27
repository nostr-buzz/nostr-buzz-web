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

/**
 * A buzz you can feel. `pattern` is the usual vibration pattern (ms on, ms off, …).
 * Android vibrates for real. iOS cannot vibrate from the web, so it gets a quick run of
 * the system's small haptic taps for the same length of time; iOS only plays those while
 * handling a touch, so this mostly helps the person sending the buzz.
 */
export function hapticBuzz(pattern: number[]): void {
  try {
    if (typeof navigator === 'undefined') return;
    if ('vibrate' in navigator) {
      navigator.vibrate(pattern);
      return;
    }
    if (typeof document === 'undefined') return;
    const total = pattern.reduce((sum, part) => sum + part, 0);
    const taps = Math.max(3, Math.min(14, Math.round(total / 70)));
    iosTick();
    for (let i = 1; i < taps; i++) {
      window.setTimeout(() => {
        try {
          iosTick();
        } catch {
          // Haptics are a nicety.
        }
      }, i * 70);
    }
  } catch {
    // Haptics are a nicety.
  }
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
