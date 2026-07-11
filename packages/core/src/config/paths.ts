import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

/**
 * ~/.symphony dizin yapısı (GEREKSINIMLER.md §4).
 * SYMPHONY_HOME ortam değişkeni ile taşınabilir (testler ve taşınabilirlik için).
 */
export function getSymphonyHome(): string {
  return process.env["SYMPHONY_HOME"] ?? join(homedir(), ".symphony");
}

export interface SymphonyPaths {
  home: string;
  configFile: string;
  providersFile: string;
  agentsDir: string;
  memoryDir: string;
  /** Kullanıcı profili (ADR-013) — yalnız insan eliyle yazılır, agent'lar salt-okur. */
  profileFile: string;
  /** Arşiv damıtma (M3) taslağı — CLI yazar, canlı `profileFile`'a asla dokunmaz. */
  profileDraftFile: string;
  dataDir: string;
  databaseFile: string;
  logsDir: string;
  daemonTokenFile: string;
  permissionsFile: string;
  mcpServersFile: string;
  /** Faz 4: CLI'nin başlattığı masaüstü sürecinin PID'si — yeniden başlatmayı önler. */
  desktopPidFile: string;
  /** ADR-016 Karar 5 (Dilim Z3): `symphony report`ün yazdığı Türkçe markdown raporları. */
  reportsDir: string;
  /** ADR-017 Karar 4 (Dilim F5): `symphony update`/`rollback`'in sürüm geçmişi ({previous,current,at}). */
  versionsFile: string;
  /** ADR-018 Karar 5 (Dilim D4): güvenilen yama kategorileri ({trusted: string[]}). */
  trustFile: string;
}

export function getSymphonyPaths(home: string = getSymphonyHome()): SymphonyPaths {
  return {
    home,
    configFile: join(home, "config.json"),
    providersFile: join(home, "providers.json"),
    agentsDir: join(home, "agents"),
    memoryDir: join(home, "memory"),
    profileFile: join(home, "memory", "profil.md"),
    profileDraftFile: join(home, "memory", "profil.taslak.md"),
    dataDir: join(home, "data"),
    databaseFile: join(home, "data", "symphony.db"),
    logsDir: join(home, "logs"),
    daemonTokenFile: join(home, "daemon.token"),
    permissionsFile: join(home, "permissions.json"),
    mcpServersFile: join(home, "mcp-servers.json"),
    desktopPidFile: join(home, "desktop.pid"),
    reportsDir: join(home, "reports"),
    versionsFile: join(home, "versions.json"),
    trustFile: join(home, "trust.json"),
  };
}

/** Dizin ağacını (yalnız dizinleri) oluşturur; dosyalar sahipleri tarafından yazılır. */
export function ensureSymphonyHome(home: string = getSymphonyHome()): SymphonyPaths {
  const paths = getSymphonyPaths(home);
  for (const dir of [
    paths.home,
    paths.agentsDir,
    paths.memoryDir,
    paths.dataDir,
    paths.logsDir,
    paths.reportsDir,
  ]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
