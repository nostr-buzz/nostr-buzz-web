/// <reference types="vite/client" />

/** Build identifier, also written to /version.json (see vite.config.ts). */
declare const __APP_VERSION__: string;
declare const __APP_BUILT_AT__: string;

interface ImportMetaEnv {
  /** Base URL of the nostr.buzz push server (see push-server/README.md). */
  readonly VITE_PUSH_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
