import { createContext } from 'react';

/**
 * - `outgoing`: we are calling and it is ringing on the other side
 * - `incoming`: someone is calling us
 * - `connecting`: accepted, the media connection is being set up
 * - `active`: talking
 * - `ended`: just finished (shown briefly before the screen closes)
 */
export type CallPhase = 'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active' | 'ended';

export interface CallContextValue {
  /** This browser can make calls (WebRTC and a microphone API are present). */
  supported: boolean;
  phase: CallPhase;
  /** Start a call with someone. Does nothing while another call is in progress. */
  startCall(pubkey: string, video: boolean): void;
}

export const CallContext = createContext<CallContextValue | undefined>(undefined);
