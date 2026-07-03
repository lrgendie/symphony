import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

/**
 * Her daemon açılışında yeni token üretilir ve `~/.symphony/daemon.token`'a
 * yazılır (PROTOKOL.md §1). Yalnız aynı kullanıcı okuyabilir; istemciler
 * token'ı bu dosyadan okur.
 *
 * Üretim ve dosyaya yazma BİLİNÇLİ olarak ayrıdır (2026-07-03 dersi):
 * dosya ancak port dinlemesi başarılı olduktan sonra yazılır — aksi hâlde
 * EADDRINUSE ile çöken ikinci kopya, çalışan daemon'ın token'ını ezip
 * istemcileri kilitliyordu.
 */
export function generateDaemonToken(): string {
  return randomBytes(32).toString("hex");
}

export function persistDaemonToken(tokenFile: string, token: string): void {
  writeFileSync(tokenFile, token, { mode: 0o600 });
}
