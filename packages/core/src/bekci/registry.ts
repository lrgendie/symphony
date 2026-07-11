import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Bekçi kayıt defteri (ADR-018 Karar 7, Faz 8 Dilim D6) — `~/.symphony/bekci.json`.
 * Kullanıcının kendi projelerini kaydettiği YERELdosya; `trust.json` (D4) ile AYNI desen:
 * SAF oku/yaz, daemon periyodik okur (yeniden başlatmadan yeni proje görünür).
 */
export interface BekciProject {
  ad: string;
  repoPath: string;
  logFile: string;
  /** Yoksa doğrulama adımı ATLANIR — yama `testOk: false` + dürüst bir özetle kaydedilir. */
  testCommand?: string;
}

export interface BekciRegistry {
  projeler: BekciProject[];
}

export function readBekciRegistry(file: string): BekciRegistry {
  if (!existsSync(file)) return { projeler: [] };
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const raw =
    typeof parsed === "object" && parsed !== null && Array.isArray((parsed as { projeler?: unknown }).projeler)
      ? (parsed as { projeler: unknown[] }).projeler
      : [];
  const projeler = raw.filter((p): p is BekciProject => {
    if (typeof p !== "object" || p === null) return false;
    const r = p as Record<string, unknown>;
    return (
      typeof r["ad"] === "string" &&
      typeof r["repoPath"] === "string" &&
      typeof r["logFile"] === "string" &&
      (r["testCommand"] === undefined || typeof r["testCommand"] === "string")
    );
  });
  return { projeler };
}

export function writeBekciRegistry(file: string, data: BekciRegistry): void {
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function findBekciProject(registry: BekciRegistry, ad: string): BekciProject | null {
  return registry.projeler.find((p) => p.ad === ad) ?? null;
}

/** Ekle ya da (aynı ad varsa) GÜNCELLE — `bekci ekle` tekrar çağrılırsa üstüne yazar. */
export function withBekciProject(registry: BekciRegistry, project: BekciProject): BekciRegistry {
  const rest = registry.projeler.filter((p) => p.ad !== project.ad);
  return { projeler: [...rest, project].sort((a, b) => a.ad.localeCompare(b.ad)) };
}

export function withoutBekciProject(registry: BekciRegistry, ad: string): BekciRegistry {
  return { projeler: registry.projeler.filter((p) => p.ad !== ad) };
}

/**
 * Bir proje adının telemetri/kategori kodu (`BEKCI_<AD>`, büyük harf + güvenli karakterler).
 * `doctor.diagnose()`nin ürettiği kendi-yama kodlarıyla (ör. `AGENT_TOOL_LOOP`) AYNI ad-alanını
 * paylaşır — D4'ün güven merdiveni/D5'in rapor sicili bekçi kategorilerini de OTOMATİK kapsar.
 */
export function bekciErrorCode(ad: string): string {
  const slug = ad
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `BEKCI_${slug.length > 0 ? slug : "BILINMEYEN"}`;
}
