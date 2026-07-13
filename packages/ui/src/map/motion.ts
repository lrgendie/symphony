/**
 * Bağlam haritası — yaşayan katmanın SAF matematiği (ADR-019 Karar 5, Dilim H5, TASARIM §5).
 * DOM/zamanlayıcı yok — tümü `(zaman) → değer` biçiminde saf fonksiyon, `scene/tesseract/
 * pulses.ts`in deseniyle AYNI ruh (canlı hesap, test edilebilir çekirdek). Her fonksiyonun tek
 * bir görsel anlamı var (TASARIM §5: "her animasyonun anlamı var, süs yok"):
 *  - `springScale`  → yeni düğüm doğuşu (elastik büyüme, hafif sıçrama)
 *  - `fadeOpacity`  → katlanan/kaybolan düğümün süzülüşü
 *  - `isRecentEdge` → son 24 saatte dokunulmuş kenarları işaretler (akış nabzı adayı)
 *  - `dashOffset`   → o kenarlarda akan kesikli çizgi animasyonu
 */

/** Yeni düğüm doğuş animasyonu süresi (ms). */
export const SPRING_DURATION_MS = 500;
/** Katlanan/kaybolan düğümün süzülme süresi (ms). */
export const FADE_DURATION_MS = 600;
/** "Son 24 saat" penceresi — akış nabzı adaylığı için. */
export const RECENT_EDGE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Akış nabzının hızı (piksel/saniye) — göze batmayan, "canlı" hissettiren yavaş bir akış. */
export const DASH_SPEED_PX_PER_SEC = 16;
/** SVG `stroke-dasharray` deseni — akış nabzı çizilen kenarlarda kullanılır. */
export const DASH_PATTERN = "4 4";

/**
 * Yeni doğan bir düğümün ölçek (0..~1.08..1) eğrisi — kritik-altı sönümlü sinüs: hızla büyür,
 * hafifçe sıçrar (aşırı sıçrama), yerine oturur. `ageMs<=0` → 0 (henüz doğmadı/tam o an),
 * `ageMs>=durationMs` → tam 1 (doğum bitti, kalıcı boyut).
 */
export function springScale(ageMs: number, durationMs: number = SPRING_DURATION_MS): number {
  if (ageMs >= durationMs) return 1;
  if (ageMs <= 0) return 0;
  const t = ageMs / durationMs;
  const decay = Math.exp(-6 * t);
  return 1 - decay * Math.cos(t * Math.PI * 2.2);
}

/**
 * Katlanan/kaybolan bir düğümün opaklığı (1→0, doğrusal) — `elapsedMs`, düğümün grafta
 * görünmez olduğu andan bu yana geçen süre. `durationMs` sonunda çağıran taraf düğümü render'dan
 * TAMAMEN kaldırmalı (0 döner ama düğüm ASLA negatif opaklıkla "var" gösterilmemeli).
 */
export function fadeOpacity(elapsedMs: number, durationMs: number = FADE_DURATION_MS): number {
  if (elapsedMs >= durationMs) return 0;
  if (elapsedMs <= 0) return 1;
  return 1 - elapsedMs / durationMs;
}

/**
 * Bir kenar "son 24 saat" akış nabzına aday mı — uçlarından EN AZ BİRİNİN `at`'i `nowMs`ten
 * `windowMs` içindeyse evet (gelecekteki bir `at`, ör. saat kayması, de "yeni" sayılır —
 * negatif fark reddedilmez, `Math.abs` kullanılmaz: yalnız GEÇMİŞE doğru pencere ölçülür ama
 * `at > nowMs` durumunda fark negatif çıkar ve `<` testi zaten true kalır).
 */
export function isRecentEdge(
  fromAt: number,
  toAt: number,
  nowMs: number,
  windowMs: number = RECENT_EDGE_WINDOW_MS,
): boolean {
  return nowMs - fromAt < windowMs || nowMs - toAt < windowMs;
}

/**
 * SVG `stroke-dashoffset` değeri — zamanla azalan (negatif yönde büyüyen) bir kayma, kesikli
 * çizginin akıyormuş hissi vermesi için. Yönü ÖNEMSİZ (görsel bir akış hissi), yalnız sürekli
 * ve tek yönlü olması yeterli.
 */
export function dashOffset(nowMs: number, speedPxPerSec: number = DASH_SPEED_PX_PER_SEC): number {
  return -((nowMs / 1000) * speedPxPerSec);
}
