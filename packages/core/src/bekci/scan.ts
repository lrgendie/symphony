/**
 * Log tarama (ADR-018 Karar 7, Faz 8 Dilim D6) — SAF: dosya sistemine dokunmaz, daemon'un
 * ÇOKTAN okuduğu yeni satırları işler. LLM'e "bu bir hata mı" SORULMAZ; desen deterministiktir
 * (D1'in `detectRecurring`iyle AYNI felsefe: ucuz, hızlı, şeffaf).
 */
export const BEKCI_ERROR_PATTERN = /(error|exception|traceback|fatal)/i;

/**
 * Eşleşen her satır için ÇEVRESİNDEKİ (öncesi/sonrası `contextRadius` satır) bir kesit üretir —
 * tek satır göstermek bir traceback'in gövdesini kaybeder. `lines` yalnız YENİ eklenen kısımdır
 * (daemon dosya ofsetini tutar); kesit bu pencerenin İÇİNDE kalır, dosyanın tamamına bakılmaz.
 */
export function findMatches(lines: readonly string[], contextRadius = 3): string[] {
  const matches: string[] = [];
  lines.forEach((line, i) => {
    if (!BEKCI_ERROR_PATTERN.test(line)) return;
    const start = Math.max(0, i - contextRadius);
    const end = Math.min(lines.length, i + contextRadius + 1);
    matches.push(lines.slice(start, end).join("\n"));
  });
  return matches;
}

/** Aynı kod için 5 dk içinde ikinci kez YAZILMAZ (spam önlenir). */
export const BEKCI_DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * SAF karar: bu eşleşme telemetriye/`log.entry`ye yazılmalı mı? `lastRecordedAtMs` o kod için
 * en son yazılan zaman (hiç yazılmadıysa `null`); `nowMs` enjekte edilir (test'te sahte zaman).
 */
export function shouldRecordBekciMatch(lastRecordedAtMs: number | null, nowMs: number): boolean {
  return lastRecordedAtMs === null || nowMs - lastRecordedAtMs >= BEKCI_DEBOUNCE_MS;
}
