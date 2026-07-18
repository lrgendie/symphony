import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSymphonyPaths, loadConfig } from "@lrgendie/core";

/**
 * Faz 4: `symphony` başlatılınca masaüstü uygulaması da otomatik açılır (kapalıysa) —
 * "tek komutla canlanır" hedefi. ADR-017 (Faz 7, Dilim F3): artık İKİ yol var — KURULU
 * uygulama (installer'dan) bulunursa doğrudan spawn edilir (hızlı, `desktop:dev`'e gerek
 * yok); bulunamazsa (repo checkout'unda geliştirme) eski `desktop:dev` yoluna düşülür.
 * İkisi de yoksa (paketlenmemiş kurulum + repo dışı) SESSİZCE vazgeçilir — bu bir
 * "nice to have", CLI'nin asıl sohbet/agent akışını asla bloklamaz ya da kırmaz.
 */

/** `pnpm-workspace.yaml`'ı arayarak bu CLI'nin çalıştığı monorepo kökünü bulur (yoksa null). */
export function findRepoRoot(): string | null {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Kurulu masaüstü uygulamasının olası .exe yolları — SAF (fs yok), test edilebilir.
 * Sıra: (1) kullanıcının elle verdiği `config.desktop.appPath`, (2) Tauri'nin Windows
 * bundle'ının bilinen varsayılan kurulum dizinleri (NSIS per-user + WiX per-machine —
 * hangisiyle kurulduğu bilinmez, ikisi de denenir).
 *
 * **ADR-017 F3 CANLI ölçümü (2026-07-10):** `productName` "Symphony" olsa da yürütülebilir
 * dosya `app.exe` adını taşıyor — Cargo paketi `[package] name = "app"` (scaffold varsayılanı,
 * hiç yeniden adlandırılmamış) ve Tauri bundle'ı ikiliyi productName'e göre YENİDEN
 * ADLANDIRMIYOR, yalnız kurulum klasörünü/kısayol adını "Symphony" yapıyor. Kabul: NSIS
 * (`Symphony_0.1.0_x64-setup.exe`, yönetici GEREKTİRMEZ) `/S` ile sessiz kuruldu → gerçek yol
 * `%LOCALAPPDATA%\Symphony\app.exe` doğrulandı. WiX (.msi, per-machine) yönetici hakkı istediği
 * için (Hata 1925) bu makinede doğrulanamadı — Program Files adayı aynı ikiliyi (`app.exe`)
 * varsayarak eklendi, gerçek bir kurulumla teyit EDİLMEDİ. Cargo paketi yeniden adlandırılmadı
 * (F3'ün kapsamı dışı, kozmetik bir iş — ayrı küçük dilim olabilir).
 */
export function candidateInstalledAppPaths(
  configuredAppPath: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  const candidates: string[] = [];
  if (configuredAppPath !== undefined && configuredAppPath.length > 0) {
    candidates.push(configuredAppPath);
  }
  const localAppData = env.LOCALAPPDATA;
  if (localAppData !== undefined && localAppData.length > 0) {
    candidates.push(join(localAppData, "Symphony", "app.exe"));
  }
  candidates.push(join("C:\\Program Files", "Symphony", "app.exe"));
  return candidates;
}

/** Listedeki ilk VAR OLAN yolu döner (yoksa null) — `exists` testte enjekte edilebilir. */
export function findExistingPath(
  candidates: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | null {
  for (const candidate of candidates) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Detached spawn + PID dosyası yazımı — kurulu .exe VE repo-dev yolu tarafından paylaşılır. */
function spawnDetached(
  command: string,
  args: readonly string[],
  cwd: string | undefined,
  home: string | undefined,
  pidFile: string,
): void {
  const child = spawn(command, [...args], {
    ...(cwd !== undefined ? { cwd } : {}),
    detached: true,
    stdio: "ignore",
    // Windows: gizli konsol açmadan arka planda başlat (Oturum 13 dersi — hardware.ts'teki
    // aynı flaş sorununu burada baştan önlüyoruz).
    windowsHide: true,
    env: { ...process.env, ...(home !== undefined ? { SYMPHONY_HOME: home } : {}) },
  });
  child.unref();
  if (child.pid !== undefined) writeFileSync(pidFile, String(child.pid), "utf8");
}

/** En iyi gayret: masaüstü açılamasa/atlanabilirse de CLI akışı kesilmez. */
export function ensureDesktopRunning(home?: string): void {
  try {
    const paths = getSymphonyPaths(home);
    const config = loadConfig(paths);
    if (!config.desktop.autoLaunch) return;

    if (existsSync(paths.desktopPidFile)) {
      const pid = Number(readFileSync(paths.desktopPidFile, "utf8").trim());
      if (Number.isInteger(pid) && isAlive(pid)) return; // zaten çalışıyor
    }

    // 1) Kurulu uygulama (ADR-017 F3) — bulunursa DOĞRUDAN spawn, en hızlı ve en yaygın yol.
    const installedApp = findExistingPath(candidateInstalledAppPaths(config.desktop.appPath));
    if (installedApp !== null) {
      spawnDetached(installedApp, [], undefined, home, paths.desktopPidFile);
      return;
    }

    // 2) Repo checkout'unda geliştirme — eski `desktop:dev` yolu (değişmedi).
    const repoRoot = findRepoRoot();
    if (repoRoot === null) return; // ne kurulu uygulama ne repo checkout'u — vazgeç

    const command = "pnpm --filter @lrgendie/desktop desktop:dev";
    const isWindows = process.platform === "win32";
    spawnDetached(
      isWindows ? "powershell.exe" : "bash",
      isWindows ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command],
      repoRoot,
      home,
      paths.desktopPidFile,
    );
  } catch {
    // Best-effort — hiçbir hata CLI'nin asıl akışını kesmez.
  }
}
