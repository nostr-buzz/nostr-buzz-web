/**
 * Voice and video calls: the wire format (see NIP.md) and a small in-app event bus.
 *
 * A call is a WebRTC connection between two people. Only the setup messages travel over
 * Nostr, always sealed and gift-wrapped like any other private message:
 *
 * - the offer (kind 1447) goes in a normal gift wrap (kind 1059): it is stored, so it can
 *   wake a closed app through push and stays in the chat as a call record;
 * - the signals that follow (kind 24837: ringing, answer, reject, hang-up, busy, reconnect)
 *   go in ephemeral gift wraps (kind 21059): they only matter to apps that are open right now.
 *   A caller who gives up also sends the hang-up in a stored wrap, so a closed app's
 *   "incoming call" notification can turn into "missed call".
 *
 * Each side sends its complete connection description once (no trickle ICE), so a call
 * needs three messages in total and works with signers that ask before every operation.
 */
import type { Rumor } from '@/lib/dm/types';

export const CALL_OFFER_KIND = 1447;
export const CALL_SIGNAL_KIND = 24837;
export const EPHEMERAL_WRAP_KIND = 21059;

/** How long a call rings before it counts as missed. */
export const RING_SECONDS = 60;

const CALL_ID = /^[A-Za-z0-9-]{8,64}$/;
const MAX_SDP = 30_000;

/**
 * - `ringing`: the callee's device is ringing
 * - `answer` / `reject` / `busy`: the callee's decision
 * - `hangup`: either side ended (or the caller gave up)
 * - `restart` / `restart-answer`: a fresh connection description after the network changed
 */
export type CallSignalType = 'ringing' | 'answer' | 'reject' | 'hangup' | 'busy' | 'restart' | 'restart-answer';
const SIGNAL_TYPES: readonly string[] = ['ringing', 'answer', 'reject', 'hangup', 'busy', 'restart', 'restart-answer'];

export interface CallOffer {
  callId: string;
  from: string;
  video: boolean;
  sdp: string;
  /** Unix seconds the caller started ringing. */
  createdAt: number;
}

export interface CallSignal {
  callId: string;
  from: string;
  type: CallSignalType;
  /** Present on `answer`, `restart` and `restart-answer`. */
  sdp?: string;
}

const tagValue = (rumor: Pick<Rumor, 'tags'>, name: string) => rumor.tags.find(([n]) => n === name)?.[1];

export function isCallOffer(rumor: Pick<Rumor, 'kind'>): boolean {
  return rumor.kind === CALL_OFFER_KIND;
}

/** True for video calls. */
export function isVideoCall(rumor: Pick<Rumor, 'tags'>): boolean {
  return tagValue(rumor, 'call-type') === 'video';
}

export function callOfferTags(callId: string, video: boolean): string[][] {
  return [
    ['call-id', callId],
    ['call-type', video ? 'video' : 'audio'],
    ['alt', `${video ? 'Video' : 'Voice'} call`],
  ];
}

export function callSignalTags(to: string, callId: string, type: CallSignalType): string[][] {
  return [
    ['p', to],
    ['call-id', callId],
    ['type', type],
    ['alt', 'Call signal'],
  ];
}

export function parseCallOffer(rumor: Rumor): CallOffer | undefined {
  if (rumor.kind !== CALL_OFFER_KIND) return undefined;
  const callId = tagValue(rumor, 'call-id') ?? '';
  if (!CALL_ID.test(callId) || !rumor.content || rumor.content.length > MAX_SDP) return undefined;
  return { callId, from: rumor.pubkey, video: isVideoCall(rumor), sdp: rumor.content, createdAt: rumor.created_at };
}

export function parseCallSignal(rumor: Rumor): CallSignal | undefined {
  if (rumor.kind !== CALL_SIGNAL_KIND) return undefined;
  const callId = tagValue(rumor, 'call-id') ?? '';
  const type = tagValue(rumor, 'type') ?? '';
  if (!CALL_ID.test(callId) || !SIGNAL_TYPES.includes(type) || rumor.content.length > MAX_SDP) return undefined;
  return { callId, from: rumor.pubkey, type: type as CallSignalType, sdp: rumor.content || undefined };
}

/* ---------------------------------- bus ----------------------------------- */

/** What the messaging engine hands to the call screen. */
export type CallEvent = { kind: 'offer'; offer: CallOffer } | { kind: 'signal'; signal: CallSignal };

const listeners = new Set<(event: CallEvent) => void>();

export function emitCallEvent(event: CallEvent): void {
  for (const listener of listeners) listener(event);
}

export function onCallEvent(listener: (event: CallEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
