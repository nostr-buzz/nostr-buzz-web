import type { NostrMetadata } from '@nostrify/nostrify';
import { nip19 } from 'nostr-tools';

const DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/** "14:05" style time for message bubbles. */
export function formatMessageTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** Compact timestamp for the chat list: time today, weekday this week, otherwise a date. */
export function formatListTime(seconds: number): string {
  const date = new Date(seconds * 1000);
  const today = startOfDay(new Date());
  const day = startOfDay(date);
  if (day === today) return formatMessageTime(seconds);
  if (today - day < 7 * DAY) return date.toLocaleDateString(undefined, { weekday: 'short' });
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { dateStyle: 'short' });
}

/** Date separator label: Today / Yesterday / "Monday, March 3". */
export function formatDayLabel(seconds: number): string {
  const date = new Date(seconds * 1000);
  const today = startOfDay(new Date());
  const day = startOfDay(date);
  if (day === today) return 'Today';
  if (today - day === DAY) return 'Yesterday';
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function dayKey(seconds: number): number {
  return startOfDay(new Date(seconds * 1000));
}

export function shortNpub(pubkey: string): string {
  try {
    const npub = nip19.npubEncode(pubkey);
    return `${npub.slice(0, 10)}…${npub.slice(-4)}`;
  } catch {
    return `${pubkey.slice(0, 8)}…`;
  }
}

export function displayName(pubkey: string, metadata?: NostrMetadata): string {
  const name = metadata?.display_name?.trim() || metadata?.name?.trim();
  return name || shortNpub(pubkey);
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|‍|️|\s)+$/u;

/** True for short emoji-only messages (1–3 emoji), which render big without a bubble. */
export function isEmojiOnly(text: string): boolean {
  const value = text.trim();
  if (!value || value.length > 40 || !EMOJI_ONLY.test(value) || /\d/.test(value)) return false;
  const graphemes = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value.replace(/\s/g, ''))].length
    : [...value.replace(/\s/g, '')].length;
  return graphemes > 0 && graphemes <= 3;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}
