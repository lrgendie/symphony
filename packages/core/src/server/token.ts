import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/**
 * Daemon token'ı: mümkünse diskteki GEÇERLİ token yeniden kullanılır (`loadExistingToken`),
 * yoksa yeni üretilir (`generateDaemonToken`). Yeniden kullanım, daemon yeniden başladığında
 * bağlı istemcilerin (masaüstü/CLI) token'ının geçersizleşip kopmasını önler (2026-07-07 dersi:
 * her açılışta yeni token → AUTH_TOKEN_INVALID; masaüstü daemon restart'ında kopuyordu).
 *
 * Dosya yalnız aynı kullanıcı okuyabilir (mode 0600) ve dinleme BAŞARILI olunca yazılır
 * (tek-kopya kilidinin ikinci yarısı — 2026-07-03 dersi: EADDRINUSE ile çöken ikinci kopya
 * çalışan daemon'ın token'ını ezmesin). Yeniden kullanım bu değişmezi güçlendirir.
 */
export function generateDaemonToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Diskteki token'ı okuyup doğrular (32 bayt hex = 64 karakter). Dosya yoksa ya da bozuk/kısa
 * ise null döner → çağıran yeni token üretir (geçersiz bir token'la kilitlenmeyi önler).
 */
export function loadExistingToken(tokenFile: string): string | null {
  try {
    const raw = readFileSync(tokenFile, "utf8").trim();
    return /^[0-9a-f]{64}$/.test(raw) ? raw : null;
  } catch {
    return null;
  }
}

export function persistDaemonToken(tokenFile: string, token: string): void {
  writeFileSync(tokenFile, token, { mode: 0o600 });
}
