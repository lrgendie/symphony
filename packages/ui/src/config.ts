/**
 * Daemon bağlantı bilgisi (port + token) iki kaynaktan gelebilir:
 *  1. Tauri: Rust tarafı `~/.symphony/daemon.token`'ı okuyup webview'e enjekte eder
 *     (`window.__SYMPHONY__`). Token hiçbir zaman diske/koda gömülmez, dosyadan gelir.
 *  2. Tarayıcı dev: `pnpm --filter @lrgendie/ui dev:token` ile üretilen .env.local
 *     (`VITE_SYMPHONY_TOKEN` / `VITE_SYMPHONY_PORT`) — yalnız geliştirme kolaylığı.
 */

export interface Bootstrap {
  token: string;
  port: number;
}

declare global {
  interface Window {
    __SYMPHONY__?: Bootstrap;
  }
}

export function getBootstrap(): Bootstrap | null {
  // Tauri enjekte etti ama token boşsa (daemon hiç çalışmamış → daemon.token yok):
  // "bağlantı bilgisi yok" say ki UI kullanıcıyı daemon'ı başlatmaya yönlendirsin.
  const injected = window.__SYMPHONY__;
  if (injected !== undefined && injected.token !== "") return injected;
  const token = import.meta.env.VITE_SYMPHONY_TOKEN;
  const port = import.meta.env.VITE_SYMPHONY_PORT;
  if (token !== undefined && token !== "" && port !== undefined) {
    return { token, port: Number(port) };
  }
  return null;
}
