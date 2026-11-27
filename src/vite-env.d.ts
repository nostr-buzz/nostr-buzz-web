/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the nostr.buzz push server (see push-server/README.md). */
  readonly VITE_PUSH_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
