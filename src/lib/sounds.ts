/**
 * Sound + haptics for nostr.buzz.
 *
 * Browsers only allow audio after a user gesture, so `primeAudio()` is called on
 * the first pointer/key interaction to unlock both the <audio> element and the
 * WebAudio context. Every call here fails silently: sound is never critical.
 */

const BUZZ_SOUND_URL = '/sounds/buzz.mp3';

let buzzAudio: HTMLAudioElement | undefined;
let audioContext: AudioContext | undefined;

function getBuzzAudio(): HTMLAudioElement | undefined {
  if (typeof Audio === 'undefined') return undefined;
  if (!buzzAudio) {
    buzzAudio = new Audio(BUZZ_SOUND_URL);
    buzzAudio.preload = 'auto';
  }
  return buzzAudio;
}

function getAudioContext(): AudioContext | undefined {
  if (typeof window === 'undefined' || typeof window.AudioContext === 'undefined') return undefined;
  audioContext ??= new window.AudioContext();
  return audioContext;
}

/** Unlock audio playback. Safe to call many times. */
export function primeAudio(): void {
  try {
    getBuzzAudio()?.load();
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') void ctx.resume();
  } catch {
    // Audio is optional.
  }
}

export function playBuzzSound(): void {
  const audio = getBuzzAudio();
  if (!audio) return;
  try {
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    // Autoplay blocked or unsupported.
  }
}

/** A soft two-note "pop" for incoming messages, synthesized so no extra asset is needed. */
export function playMessageSound(): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime;
    const notes: [number, number][] = [
      [880, 0],
      [1318.5, 0.09],
    ];
    for (const [frequency, offset] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + 0.25);
    }
  } catch {
    // Audio is optional.
  }
}

export function vibrate(pattern: number | number[]): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    // Unsupported (e.g. iOS Safari).
  }
}

export const BUZZ_VIBRATION = [120, 60, 120, 60, 120, 60, 300];
