// Tarayıcı dev kolaylığı: çalışan daemon'ın token + port'unu okuyup .env.local'e yazar.
// Yalnız GELİŞTİRME içindir (.env.local gitignore'da); üretimde Tauri token'ı enjekte eder.
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const home = process.env.SYMPHONY_HOME ?? join(homedir(), ".symphony");

let token;
try {
  token = readFileSync(join(home, "daemon.token"), "utf8").trim();
} catch {
  console.error(`daemon.token bulunamadı (${home}). Önce daemon'ı başlat: symphony status`);
  process.exit(1);
}

let port = 7770;
try {
  const cfg = JSON.parse(readFileSync(join(home, "config.json"), "utf8"));
  if (typeof cfg?.daemon?.port === "number") port = cfg.daemon.port;
} catch {
  // config yoksa varsayılan 7770 (constants.ts ile aynı)
}

const out = fileURLToPath(new URL("../.env.local", import.meta.url));
writeFileSync(out, `VITE_SYMPHONY_TOKEN=${token}\nVITE_SYMPHONY_PORT=${port}\n`);
console.log(`.env.local yazıldı → port ${port}, token ${token.slice(0, 8)}…`);
