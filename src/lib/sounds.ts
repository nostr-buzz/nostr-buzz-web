/**
 * Sound + haptics for nostr.buzz.
 *
 * Browsers only allow audio after a user gesture, so `primeAudio()` is called on
 * the first pointer/key interaction to unlock both the <audio> element and the
 * WebAudio context. Every call here fails silently: sound is never critical.
 */

import type { MessageTone } from '@/contexts/AppContext';

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

/** Each tone is a few notes: [frequency in Hz, start offset in s, length in s]. */
const MESSAGE_TONES: Record<MessageTone, { wave: OscillatorType; notes: [number, number, number][] }> = {
  pop: { wave: 'sine', notes: [[880, 0, 0.22], [1318.5, 0.09, 0.22]] },
  chime: { wave: 'sine', notes: [[659.3, 0, 0.3], [880, 0.12, 0.3], [1174.7, 0.24, 0.45]] },
  ding: { wave: 'triangle', notes: [[1568, 0, 0.7]] },
  drop: { wave: 'sine', notes: [[783.99, 0, 0.18], [523.25, 0.1, 0.3]] },
};

export const MESSAGE_TONE_NAMES = Object.keys(MESSAGE_TONES) as MessageTone[];

/** A soft sound for incoming messages, synthesized so no extra asset is needed. */
export function playMessageSound(tone: MessageTone = 'pop'): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') void ctx.resume();
    const start = ctx.currentTime;
    const { wave, notes } = MESSAGE_TONES[tone] ?? MESSAGE_TONES.pop;
    for (const [frequency, offset, length] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start + offset);
      gain.gain.exponentialRampToValueAtTime(0.18, start + offset + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + length);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start + offset);
      osc.stop(start + offset + length + 0.03);
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
