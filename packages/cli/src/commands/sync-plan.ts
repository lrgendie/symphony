import { join } from "node:path";

/**
 * `symphony sync` beyaz listesi (ADR-017 Karar 3) — SENKRONLANAN TEK kaynak. ASLA senkronlanmayan
 * (`daemon.token`, `data/` [SQLite — makineye özgü], `logs/`, `desktop.pid`, `reports/` [türetilmiş])
 * bu listede YOKTUR; `.gitignore` bunu güçlendirir (beyaz liste DIŞI her şey `*` ile yoksayılır).
 * Anahtarlar zaten OS keychain'inde (ADR-006) — sync anahtarsız güvenlidir.
 */
export const SYNC_WHITELIST = ["config.json", "providers.json", "agents", "memory", "mcp-servers.json"] as const;
export type SyncWhitelistEntry = (typeof SYNC_WHITELIST)[number];

const DIRECTORY_ENTRIES = new Set<string>(["agents", "memory"]);

/**
 * `.gitignore` içeriği — SAF (dosya G/Ç yok). `*` ile HER ŞEY yoksayılır, yalnız beyaz liste
 * negatiflenir. Dizinler (`agents`/`memory`) İKİ negatifle eklenir: `!agents/` dizinin kendisini
 * (yoksa git içine hiç bakmaz), `!agents/**` içeriğini recursive un-ignore eder. `.gitignore`nin
 * KENDİSİ de negatiflenir — aksi halde `*` kuralı kendi dosyasını da yoksayıp `git add
 * .gitignore`yi reddeder ("ignored by one of your .gitignore files").
 */
export function buildGitignoreContent(): string {
  const lines: string[] = ["*", "!.gitignore"];
  for (const entry of SYNC_WHITELIST) {
    if (DIRECTORY_ENTRIES.has(entry)) {
      lines.push(`!${entry}/`, `!${entry}/**`);
    } else {
      lines.push(`!${entry}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

export interface BackupPlanEntry {
  from: string;
  to: string;
}

/**
 * `symphony sync init` yeni-makine akışı: uzakta yapılandırma VARSA, üzerine yazmadan önce
 * çakışan yerel dosyalar `.bak`lanır. SAF — hangi dosyaların VAR OLDUĞUNU çağıran belirler
 * (fs erişimi burada yok), yalnız hedef yolları hesaplar.
 */
export function planLocalBackup(home: string, existingEntries: readonly string[]): BackupPlanEntry[] {
  return existingEntries.map((entry) => ({
    from: join(home, entry),
    to: join(home, `${entry}.bak`),
  }));
}
