/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_POLLAR_PUBLISHABLE_KEY?: string;
  readonly VITE_POLLAR_BASE_URL?: string;
  readonly VITE_STELLAR_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
