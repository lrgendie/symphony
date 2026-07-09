import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Kullanıcı profili (ADR-013, ROADMAP öncelik #3): `~/.symphony/memory/profil.md`.
 * Bu modül SAF'tır (dosya G/Ç dışında yan etkisi yok) ve yalnız OKUR — canlı profili
 * yazan tek yol kullanıcının kendisidir; agent'lar/motor buradan asla YAZAMAZ.
 */

/** Enjekte edilen profil metninin üst sınırı (~2K token bütçesi). */
export const MAX_PROFILE_CHARS = 8000;

/** Dosya yoksa bir kez yazılan boş iskelet — yalnız başlıklar, gerçek içerik DEĞİL. */
export const PROFILE_SCAFFOLD = `<!-- Bu dosyayı sen doldurursun; agent'lar yalnız OKUR — ADR-013 -->
# Kullanıcı Profili

## Kimlik

## Üslup ve dil tercihleri

## Teknik tercihler

## Projeler

## Düzeltmeler ve öğrenimler
`;

export interface LoadedProfile {
  text: string;
  truncated: boolean;
}

/**
 * Dosya yok, boş ya da yalnız iskelet (kullanıcı henüz doldurmamış) ise `null` döner —
 * bağlama hiçbir şey enjekte edilmez. Aşım sessizce kesilir (`truncated:true`); loglama
 * çağıranın işidir (bu modül pino'ya bağımlı değil, SAF kalır).
 */
export function loadProfile(file: string): LoadedProfile | null {
  if (!existsSync(file)) return null;
  const trimmed = readFileSync(file, "utf8").trim();
  if (trimmed.length === 0 || trimmed === PROFILE_SCAFFOLD.trim()) return null;
  if (trimmed.length <= MAX_PROFILE_CHARS) return { text: trimmed, truncated: false };
  return { text: trimmed.slice(0, MAX_PROFILE_CHARS), truncated: true };
}

/** Dosya YOKSA yalnız başlıklardan iskelet yazar (daemon açılışı, `ensureDefaultAgent` deseni). */
export function ensureProfileScaffold(file: string): void {
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, PROFILE_SCAFFOLD, "utf8");
}
