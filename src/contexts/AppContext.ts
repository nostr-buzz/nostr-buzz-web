import { createContext } from "react";

export type Theme = "dark" | "light" | "system";

export interface RelayMetadata {
  /** List of relays with read/write permissions */
  relays: { url: string; read: boolean; write: boolean }[];
  /** Unix timestamp of when the relay list was last updated */
  updatedAt: number;
}

/** Blossom server list metadata (BUD-03 / kind 10063), mirroring RelayMetadata for parity. */
export interface BlossomServerMetadata {
  /** Ordered list of Blossom server URLs (most trusted/reliable first per BUD-03). */
  servers: string[];
  /** Unix timestamp of when the server list was last updated (from kind 10063 created_at). */
  updatedAt: number;
}

/** nostr.buzz chat preferences (sounds, notifications, privacy). */
export interface ChatSettings {
  /** Play a soft sound for incoming messages. */
  messageSound: boolean;
  /** Play the buzz sound when buzzed (and when buzzing). */
  buzzSound: boolean;
  /** Shake the app when buzzed. */
  buzzShake: boolean;
  /** Vibrate on supported phones when buzzed. */
  vibrate: boolean;
  /** Show desktop notifications while the tab is in the background. */
  notifications: boolean;
  /** Include message text in desktop notifications. */
  notificationPreviews: boolean;
  /** Also load legacy NIP-04 (kind 4) direct messages. */
  legacyDMs: boolean;
  /** Let people you don't follow (message requests) shake your app. */
  buzzFromStrangers: boolean;
  /** Enter sends, Shift+Enter adds a new line (desktop). */
  enterToSend: boolean;
}

export interface AppConfig {
  /** nostr.buzz chat preferences. Missing keys fall back to defaults. */
  chat?: Partial<ChatSettings>;
  /** Current theme */
  theme: Theme;
  /** NIP-65 relay list metadata */
  relayMetadata: RelayMetadata;
  /** User's kind 10063 Blossom server list. */
  blossomServerMetadata: BlossomServerMetadata;
  /**
   * When true, the app's default Blossom servers are merged with the user's
   * servers (app servers first, deduped). When false, only the user's servers
   * are used.
   */
  useAppBlossomServers: boolean;
}

export interface AppContextType {
  /** Current application configuration */
  config: AppConfig;
  /** Update configuration using a callback that receives current config and returns new config */
  updateConfig: (updater: (currentConfig: Partial<AppConfig>) => Partial<AppConfig>) => void;
}

export const AppContext = createContext<AppContextType | undefined>(undefined);
