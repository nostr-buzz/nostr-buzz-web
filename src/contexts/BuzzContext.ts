import { createContext } from 'react';

/** Window event fired on every buzz, so decorative 3D bees can react. */
export const BUZZ_EVENT = 'nostr-buzz:buzz';

export interface BuzzEffectOptions {
  /** Who buzzed (incoming buzzes). */
  from?: string;
  /** Conversation to open when the buzz toast is tapped. */
  conversationId?: string;
  /** True when the current user sent the buzz (gentler feedback, no toast). */
  outgoing?: boolean;
}

export interface BuzzContextValue {
  /** Shake the app, play the buzz sound and vibrate, honoring user settings. */
  triggerBuzz(options: BuzzEffectOptions): void;
}

export const BuzzContext = createContext<BuzzContextValue | undefined>(undefined);
