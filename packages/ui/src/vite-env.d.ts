/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Tarayıcı dev modu: `pnpm --filter @lrgendie/ui dev:token` bunu .env.local'e yazar. */
  readonly VITE_SYMPHONY_TOKEN?: string;
  readonly VITE_SYMPHONY_PORT?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
