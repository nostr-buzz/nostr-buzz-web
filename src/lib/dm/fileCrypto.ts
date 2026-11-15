/**
 * AES-GCM helpers for NIP-17 kind 15 file messages.
 *
 * Files are encrypted on-device before upload, so the Blossom server only ever
 * sees ciphertext. The key and nonce travel inside the (encrypted) rumor.
 */

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error('Invalid hex');
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', data)));
}

export interface EncryptedUpload {
  encrypted: File;
  key: string;
  nonce: string;
  /** sha256 of the original file */
  ox: string;
  /** sha256 of the encrypted file */
  x: string;
  mimeType: string;
  size: number;
  dim?: string;
}

async function imageDimensions(file: File): Promise<string | undefined> {
  if (!file.type.startsWith('image/') || typeof createImageBitmap === 'undefined') return undefined;
  try {
    const bitmap = await createImageBitmap(file);
    const dim = `${bitmap.width}x${bitmap.height}`;
    bitmap.close();
    return dim;
  } catch {
    return undefined;
  }
}

export async function encryptFile(file: File): Promise<EncryptedUpload> {
  const plain = await file.arrayBuffer();
  const rawKey = crypto.getRandomValues(new Uint8Array(32));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const key = await crypto.subtle.importKey('raw', rawKey, 'AES-GCM', false, ['encrypt']);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain);

  const [ox, x, dim] = await Promise.all([sha256Hex(plain), sha256Hex(cipher), imageDimensions(file)]);

  return {
    encrypted: new File([cipher], `${x}.bin`, { type: 'application/octet-stream' }),
    key: toHex(rawKey),
    nonce: toHex(nonce),
    ox,
    x,
    mimeType: file.type || 'application/octet-stream',
    size: cipher.byteLength,
    dim,
  };
}

export async function decryptFile(data: ArrayBuffer, keyHex: string, nonceHex: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', fromHex(keyHex), 'AES-GCM', false, ['decrypt']);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromHex(nonceHex) }, key, data);
}
