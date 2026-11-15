import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { finalizeEvent, generateSecretKey, getEventHash, nip44, verifyEvent } from 'nostr-tools';
import { z } from 'zod';

import type { Rumor } from './types';

const TWO_DAYS = 2 * 24 * 60 * 60;
const HEX64 = /^[0-9a-f]{64}$/;

export const NIP44_UNSUPPORTED =
  'Your signer does not support NIP-44 encryption. Please update your extension or use a different login.';

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** A timestamp up to two days in the past, as NIP-59 recommends for seals and wraps. */
function randomPastTimestamp(): number {
  return nowSeconds() - Math.floor(Math.random() * TWO_DAYS);
}

/** Build an unsigned rumor with a correctly computed id. */
export function createRumor(template: {
  pubkey: string;
  kind: number;
  content: string;
  tags: string[][];
  created_at?: number;
}): Rumor {
  const base = {
    pubkey: template.pubkey,
    created_at: template.created_at ?? nowSeconds(),
    kind: template.kind,
    tags: template.tags,
    content: template.content,
  };
  return { ...base, id: getEventHash(base) };
}

/** Seal (kind 13) a rumor for one recipient, signed by the user's own signer. */
export async function sealRumor(signer: NostrSigner, rumor: Rumor, recipient: string): Promise<NostrEvent> {
  if (!signer.nip44) throw new Error(NIP44_UNSUPPORTED);
  const content = await signer.nip44.encrypt(recipient, JSON.stringify(rumor));
  return signer.signEvent({
    kind: 13,
    content,
    created_at: randomPastTimestamp(),
    tags: [],
  });
}

/** Gift wrap (kind 1059) a seal for one recipient using a fresh, single-use key. */
export function wrapSeal(seal: NostrEvent, recipient: string): NostrEvent {
  const ephemeralKey = generateSecretKey();
  const conversationKey = nip44.v2.utils.getConversationKey(ephemeralKey, recipient);
  const content = nip44.v2.encrypt(JSON.stringify(seal), conversationKey);
  const wrap = finalizeEvent(
    {
      kind: 1059,
      content,
      created_at: randomPastTimestamp(),
      tags: [['p', recipient]],
    },
    ephemeralKey,
  );
  ephemeralKey.fill(0);
  return wrap;
}

const sealSchema = z.object({
  id: z.string(),
  pubkey: z.string().regex(HEX64),
  created_at: z.number().int(),
  kind: z.literal(13),
  tags: z.array(z.array(z.string())),
  content: z.string(),
  sig: z.string(),
});

const rumorSchema = z.object({
  pubkey: z.string().regex(HEX64),
  created_at: z.number().int().nonnegative(),
  kind: z.number().int().nonnegative(),
  tags: z.array(z.array(z.string())),
  content: z.string(),
});

/**
 * Unwrap a NIP-17 gift wrap with the user's signer and return the inner rumor.
 *
 * Verifies the seal signature and that the rumor author matches the seal signer
 * (otherwise anyone could impersonate anyone). The rumor id is always recomputed
 * so a malicious sender cannot collide with another message's id.
 */
export async function unwrapGiftWrap(signer: NostrSigner, wrap: NostrEvent): Promise<Rumor> {
  if (!signer.nip44) throw new Error(NIP44_UNSUPPORTED);

  const sealJson = await signer.nip44.decrypt(wrap.pubkey, wrap.content);
  const seal = sealSchema.parse(JSON.parse(sealJson));
  if (!verifyEvent(seal)) throw new Error('Invalid seal signature');

  const rumorJson = await signer.nip44.decrypt(seal.pubkey, seal.content);
  const parsed = rumorSchema.parse(JSON.parse(rumorJson));
  if (parsed.pubkey !== seal.pubkey) throw new Error('Rumor author does not match seal signer');

  const base = {
    pubkey: parsed.pubkey,
    created_at: parsed.created_at,
    kind: parsed.kind,
    tags: parsed.tags,
    content: parsed.content,
  };
  return { ...base, id: getEventHash(base) };
}

/** Run async tasks with at most `concurrency` in flight (signers hate floods). */
export function createLimiter(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];

  const next = () => {
    if (active >= concurrency) return;
    const run = queue.shift();
    if (run) {
      active++;
      run();
    }
  };

  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
  };
}
