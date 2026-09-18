/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of an external image host (`{base}/gifts/{icon}.png`, `{base}/packs/{sprite}.png`). */
  readonly VITE_ASSET_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
