/**
 * DEĞİŞMEZLER — koddaki karşılığı (ADR-018 Karar 4, ROADMAP Faz 8 "asla otomatikleşmez").
 *
 * Bu yollara dokunan bir yama HİÇBİR güven kaydıyla (Dilim D4) otomatik uygulanamaz:
 * `symphony patch apply` yine çalışır ama DAİMA açık insan onayı ister ve `patch trust` bu
 * kategorileri reddeder. Gerekçe: kendini geliştiren bir sistemin kendi FRENLERİNİ kendi
 * başına gevşetebilmesi, tüm güvenlik zincirini anlamsız kılar.
 *
 * **Liste kendini de korur** (`protected.ts` kendi içinde) — aksi hâlde ilk yama bu dosyayı
 * boşaltıp sonraki tüm yamalara serbest geçiş açabilirdi.
 *
 * SAF: dosya sistemine dokunmaz, yalnız yol dizesi karşılaştırır.
 */

export const PROTECTED_PATHS: readonly string[] = [
  // Güncelleyici çekirdek (ADR-017 Karar 4): sürüm/rollback zinciri.
  "packages/cli/src/commands/update.ts",
  // Yama uygulama zincirinin KENDİSİ (D3) — bir yama kendi kapısını açamaz.
  "packages/cli/src/commands/patch.ts",
  // İzin sistemi (SPEC-AGENT §5/§8): araç çalıştırmanın TEK kapısı.
  "packages/core/src/agent/permissions.ts",
  "packages/core/src/agent/engine.ts",
  "packages/core/src/agent/jail.ts",
  // Anahtar yönetimi (ADR-006): API anahtarları OS keychain'inde.
  "packages/core/src/secrets/",
  // Daemon token'ı (kimlik doğrulamanın kökü).
  "packages/core/src/server/token.ts",
  // Bu listenin KENDİSİ.
  "packages/core/src/doctor/protected.ts",
];

/** Yol ayracını normalize eder (git `\` DEĞİL `/` verir ama Windows'tan gelen yollar karışabilir). */
function normalize(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Verilen dosyalardan korumalı bir yola dokunanları döner (boş dizi = temiz).
 * Dizin girdileri (`.../secrets/`) ÖNEK olarak eşleşir; dosya girdileri TAM eşleşir.
 */
export function protectedMatches(files: readonly string[]): string[] {
  const hits: string[] = [];
  for (const raw of files) {
    const file = normalize(raw);
    const protectedHit = PROTECTED_PATHS.some((entry) =>
      entry.endsWith("/") ? file.startsWith(entry) : file === entry,
    );
    if (protectedHit) hits.push(file);
  }
  return hits;
}

/** Kısayol: yama korumalı bir yola dokunuyor mu? */
export function touchesProtected(files: readonly string[]): boolean {
  return protectedMatches(files).length > 0;
}
