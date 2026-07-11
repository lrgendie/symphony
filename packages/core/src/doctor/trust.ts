import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { PatchSummary } from "@symphony/shared";
import { touchesProtected } from "./protected.js";

/**
 * GÜVEN MERDİVENİ (ADR-018 Karar 5, Faz 8 Dilim D4).
 *
 * `~/.symphony/trust.json` — hangi yama KATEGORİLERİNİN (v1: kategori = hata kodu, D2
 * `pipeline.ts`) doktor→apply akışında insan onayı olmadan uygulanabileceğini tutar. Ayrı bir
 * "başarı puanı" tablosu YOK — sicil `patches` tablosundan (D2/D3) TÜRETİLİR: bu dosya yalnız
 * insanın "bu kategoriye artık güveniyorum" kararının kaydıdır, otomatik hesaplanmaz.
 *
 * SAF: dosya okuma/yazma dışında yan etkisi yok; sicil hesabı salt fonksiyoneldir.
 */
export interface TrustFile {
  trusted: string[];
}

export function readTrust(file: string): TrustFile {
  if (!existsSync(file)) return { trusted: [] };
  const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
  const trusted =
    typeof parsed === "object" &&
    parsed !== null &&
    Array.isArray((parsed as { trusted?: unknown }).trusted)
      ? ((parsed as { trusted: unknown[] }).trusted.filter((x) => typeof x === "string") as string[])
      : [];
  return { trusted };
}

export function writeTrust(file: string, data: TrustFile): void {
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

export function isTrusted(trust: TrustFile, category: string): boolean {
  return trust.trusted.includes(category);
}

export function withTrust(trust: TrustFile, category: string): TrustFile {
  if (trust.trusted.includes(category)) return trust;
  return { trusted: [...trust.trusted, category].sort() };
}

export function withoutTrust(trust: TrustFile, category: string): TrustFile {
  return { trusted: trust.trusted.filter((c) => c !== category) };
}

/**
 * Bir kategorinin sicili: `applied` (canlıya çıktı ve kaldı) sağlıklı sayılır; `reverted`
 * (canlıya çıktı ama watchdog geri aldı) ve `failed` (ana dalda build/test düştü, hiç canlıya
 * çıkmadı) UNHEALTHY sayılır — ikisi de "bu kategoriden bir yama gerçek dünyada sorun çıkardı"
 * demektir. `proposed` (henüz karar verilmemiş) ve `rejected` (insan tercih etmemiş, kod
 * kalitesiyle ilgisiz) sicile GİRMEZ — henüz ya da hiç kanıt üretmediler.
 */
export interface CategoryRecord {
  category: string;
  applied: number;
  unhealthy: number;
  /** `applied + unhealthy` — sicile giren toplam SONUÇLANMIŞ yama sayısı. */
  total: number;
}

export function categoryRecord(patches: readonly PatchSummary[], category: string): CategoryRecord {
  let applied = 0;
  let unhealthy = 0;
  for (const p of patches) {
    if (p.category !== category) continue;
    if (p.state === "applied") applied++;
    else if (p.state === "reverted" || p.state === "failed") unhealthy++;
  }
  return { category, applied, unhealthy, total: applied + unhealthy };
}

/**
 * Kategori GEÇMİŞTE korumalı bir yola dokunmuş mu? (ADR-018 Karar 4: değişmezlere dokunan hiçbir
 * şey blanket-trust ile otomatikleşemez — `patch trust` bu kategoriyi REDDETMELİDİR.)
 */
export function categoryTouchedProtected(patches: readonly PatchSummary[], category: string): boolean {
  return patches.some((p) => p.category === category && touchesProtected(p.files));
}
