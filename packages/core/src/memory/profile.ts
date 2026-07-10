import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
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

export interface ProfileSnapshot {
  content: string;
  chars: number;
  truncated: boolean;
  updatedAt: number | null;
}

/**
 * REST `GET /api/memory` (Dilim M2) — enjeksiyon için DEĞİL, insan görüntüsü içindir:
 * `content` her zaman dosyanın TAM (kesilmemiş) hâlidir; `truncated` yalnız enjekte
 * edilen kesimin (MAX_PROFILE_CHARS) kullanıcıya bir uyarısıdır.
 */
export function readProfileSnapshot(file: string): ProfileSnapshot {
  if (!existsSync(file)) {
    return { content: PROFILE_SCAFFOLD, chars: PROFILE_SCAFFOLD.length, truncated: false, updatedAt: null };
  }
  const content = readFileSync(file, "utf8");
  return {
    content,
    chars: content.length,
    truncated: content.length > MAX_PROFILE_CHARS,
    updatedAt: Math.round(statSync(file).mtimeMs),
  };
}

/** REST `PUT /api/memory` — insan tarafından TAM değiştirme; agent araç yüzeyinde YOKTUR (ADR-013). */
export function writeProfile(file: string, content: string): ProfileSnapshot {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, "utf8");
  return readProfileSnapshot(file);
}

/**
 * Enjekte edilen profil bloğunun metni (agent + chat yolu ORTAK — tek kaynak, iki yerde
 * ayrı ayrı yazılıp birbirinden sapmasın diye). Canlı gözlemlenen bir hata düzeltildi
 * (2026-07-10): eski başlık yalnız "## Kullanıcı profili (salt-okunur bağlam)" idi — küçük
 * yerel model (qwen3:8b), "ben kimim?" sorusuna profildeki "Adım X" ifadesini KENDİ kimliği
 * sanıp cevapladı. Yeni metin bunu açıkça ayırır: profil KULLANICIYA aittir, modele değil.
 */
export function formatProfileContext(profile: string): string {
  return (
    "## Konuştuğun kullanıcı hakkında bilgi (SENİN kimliğin DEĞİL — yalnızca bağlam)\n" +
    "Aşağıdaki bilgiler karşındaki KULLANICIYA aittir, sana değil. \"Sen kimsin?\" gibi bir " +
    "soruya bu bilgilerle KENDİNİ tanıtma; yalnız kullanıcıyı daha iyi anlamak için kullan.\n" +
    profile
  );
}
