/**
 * A tiny "tick" for touch gestures (a swipe reaching its trigger point).
 *
 * Android: the Vibration API. iOS has no such API, but toggling a native switch control
 * plays the system haptic (iOS 17.4+), so a hidden one is flipped. Fails silently elsewhere.
 */

/**
 * One system haptic tap on iOS: toggle a native switch control that exists only for this
 * moment. A fresh, detached-looking control each time is the form known to work; a
 * reused or styled one does not reliably fire the haptic.
 */
function iosTick(): void {
  const label = document.createElement('label');
  label.ariaHidden = 'true';
  label.style.display = 'none';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.setAttribute('switch', '');
  label.appendChild(input);
  document.head.appendChild(label);
  label.click();
  document.head.removeChild(label);
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
    const taps = Math.max(3, Math.min(10, Math.round(total / 110)));
    iosTick();
    for (let i = 1; i < taps; i++) {
      window.setTimeout(() => {
        try {
          iosTick();
        } catch {
          // Haptics are a nicety.
        }
      }, i * 110);
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
