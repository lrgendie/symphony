import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getSymphonyPaths, loadConfig } from "@symphony/core";

/**
 * Faz 4: `symphony` başlatılınca masaüstü uygulaması da otomatik açılır (kapalıysa) —
 * "tek komutla canlanır" hedefi. Paketleme (Faz 7 — installer) henüz YOK; tek çalışan yol
 * bu repo checkout'undan `desktop:dev` (Tauri dev). Bu yüzden monorepo kökü bulunamazsa
 * (paketlenmiş/npm kurulumu) SESSİZCE vazgeçilir — bu bir "nice to have", CLI'nin asıl
 * sohbet/agent akışını asla bloklamaz ya da kıramaz (her hata yutulur).
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

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

    const repoRoot = findRepoRoot();
    if (repoRoot === null) return; // paketlenmiş kurulum (Faz 7) henüz yok

    const command = "pnpm --filter @symphony/desktop desktop:dev";
    const isWindows = process.platform === "win32";
    const child = spawn(
      isWindows ? "powershell.exe" : "bash",
      isWindows ? ["-NoProfile", "-NonInteractive", "-Command", command] : ["-c", command],
      {
        cwd: repoRoot,
        detached: true,
        stdio: "ignore",
        // Windows: gizli konsol açmadan arka planda başlat (Oturum 13 dersi — hardware.ts'teki
        // aynı flaş sorununu burada baştan önlüyoruz).
        windowsHide: true,
        env: { ...process.env, ...(home !== undefined ? { SYMPHONY_HOME: home } : {}) },
      },
    );
    child.unref();
    if (child.pid !== undefined) writeFileSync(paths.desktopPidFile, String(child.pid), "utf8");
  } catch {
    // Best-effort — hiçbir hata CLI'nin asıl akışını kesmez.
  }
}
