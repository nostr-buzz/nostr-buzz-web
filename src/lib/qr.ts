import { nip19 } from 'nostr-tools';

import { parseInviteLink } from '@/lib/groups/groups';

const HEX64 = /^[0-9a-f]{64}$/;
const BECH32_PROFILE = /^(npub1|nprofile1)[023456789acdefghjklmnpqrstuvwxyz]+$/;

/** What a scanned QR code means to nostr.buzz. */
export type ScannedCode =
  /** Someone's profile: open a chat with them. */
  | { type: 'profile'; pubkey: string }
  /** A group invite link: an in-app path to open. */
  | { type: 'invite'; path: string };

function profileFromBech32(value: string): string | undefined {
  if (!BECH32_PROFILE.test(value)) return undefined;
  try {
    const decoded = nip19.decode(value);
    if (decoded.type === 'npub') return decoded.data;
    if (decoded.type === 'nprofile') return decoded.data.pubkey;
  } catch {
    // Not a valid identifier.
  }
  return undefined;
}

/**
 * Understand the text inside a QR code: `nostr:npub…`, a bare npub / nprofile / hex pubkey,
 * a profile link from nostr.buzz or another Nostr site, or a nostr.buzz group invite link.
 * Secret keys and anything else are refused.
 */
export function parseScannedCode(raw: string): ScannedCode | undefined {
  const text = raw.trim();
  if (!text || text.length > 2048) return undefined;

  const bare = text.replace(/^(web\+)?nostr:/i, '');
  if (HEX64.test(bare)) return { type: 'profile', pubkey: bare };
  const direct = profileFromBech32(bare.toLowerCase());
  if (direct) return { type: 'profile', pubkey: direct };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;

  const segments = url.pathname.split('/').filter(Boolean);
  const ours = url.host === 'nostr.buzz' || (typeof location !== 'undefined' && url.host === location.host);
  if (ours && segments[0] === 'join' && parseInviteLink(segments[1], url.hash)) {
    return { type: 'invite', path: `/join/${segments[1]}${url.hash}` };
  }

  // Profile links: nostr.buzz/npub…, njump.me/npub…, primal.net/p/npub… and the like.
  for (const segment of segments) {
    const pubkey = profileFromBech32(decodeURIComponent(segment).toLowerCase());
    if (pubkey) return { type: 'profile', pubkey };
  }
  return undefined;
}

/* --------------------------------- decoding -------------------------------- */

interface Detector {
  detect(source: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}

interface DetectorConstructor {
  new (options: { formats: string[] }): Detector;
  getSupportedFormats(): Promise<string[]>;
}

let detector: Promise<Detector | undefined> | undefined;

/** The browser's built-in barcode reader (fast, off the main thread) where it exists. */
function nativeDetector(): Promise<Detector | undefined> {
  detector ??= (async () => {
    try {
      const Constructor = (globalThis as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
      if (!Constructor || !(await Constructor.getSupportedFormats()).includes('qr_code')) return undefined;
      return new Constructor({ formats: ['qr_code'] });
    } catch {
      return undefined;
    }
  })();
  return detector;
}

let jsQR: Promise<typeof import('jsqr').default> | undefined;

/** Longest side of the frame handed to the JavaScript decoder. */
const MAX_SIDE = 800;

/**
 * Read a QR code from a camera frame or a photo. Returns its text, or `undefined`.
 * `canvas` is scratch space for the JavaScript decoder (Safari, Firefox).
 */
export async function decodeQr(
  source: HTMLVideoElement | ImageBitmap,
  canvas: HTMLCanvasElement,
  photo = false,
): Promise<string | undefined> {
  const width = source instanceof HTMLVideoElement ? source.videoWidth : source.width;
  const height = source instanceof HTMLVideoElement ? source.videoHeight : source.height;
  if (!width || !height) return undefined;

  const native = await nativeDetector();
  if (native) {
    try {
      const [found] = await native.detect(source);
      if (found?.rawValue) return found.rawValue;
      if (!photo) return undefined;
    } catch {
      // Fall through to the JavaScript decoder.
    }
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return undefined;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  jsQR ??= import('jsqr').then((module) => module.default);
  const decode = await jsQR;
  return decode(image.data, image.width, image.height, { inversionAttempts: photo ? 'attemptBoth' : 'dontInvert' })?.data || undefined;
}
