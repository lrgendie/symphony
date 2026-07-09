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
  dataDir: string;
  databaseFile: string;
  logsDir: string;
  daemonTokenFile: string;
  permissionsFile: string;
  mcpServersFile: string;
}

export function getSymphonyPaths(home: string = getSymphonyHome()): SymphonyPaths {
  return {
    home,
    configFile: join(home, "config.json"),
    providersFile: join(home, "providers.json"),
    agentsDir: join(home, "agents"),
    memoryDir: join(home, "memory"),
    profileFile: join(home, "memory", "profil.md"),
    dataDir: join(home, "data"),
    databaseFile: join(home, "data", "symphony.db"),
    logsDir: join(home, "logs"),
    daemonTokenFile: join(home, "daemon.token"),
    permissionsFile: join(home, "permissions.json"),
    mcpServersFile: join(home, "mcp-servers.json"),
  };
}

/** Dizin ağacını (yalnız dizinleri) oluşturur; dosyalar sahipleri tarafından yazılır. */
export function ensureSymphonyHome(home: string = getSymphonyHome()): SymphonyPaths {
  const paths = getSymphonyPaths(home);
  for (const dir of [paths.home, paths.agentsDir, paths.memoryDir, paths.dataDir, paths.logsDir]) {
    mkdirSync(dir, { recursive: true });
  }
  return paths;
}
