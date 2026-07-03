import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

/**
 * Her daemon açılışında yeni token üretilir ve `~/.symphony/daemon.token`'a
 * yazılır (PROTOKOL.md §1). Yalnız aynı kullanıcı okuyabilir; istemciler
 * token'ı bu dosyadan okur.
 */
export function issueDaemonToken(tokenFile: string): string {
  const token = randomBytes(32).toString("hex");
  writeFileSync(tokenFile, token, { mode: 0o600 });
  return token;
}
