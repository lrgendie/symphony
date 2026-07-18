/**
 * Yaşayan Küre'nin FİZİKSEL vitalleri — GPU örneklerinden türetilen tek anlam kaynağı.
 * Saf fonksiyon (React/Three.js yok) → birim test edilebilir. LivingScene bunu görsele çevirir.
 * TASARIM.md §2: her hareketin GERÇEK anlamı var — burada anlam = donanım yükü/ısısı/belleği.
 */

import type { GpuSample } from "@lrgendie/shared";

export interface GpuVitals {
  /** Gösterge etiketi için birincil (en yoğun) GPU adı. */
  name: string;
  utilizationPct: number;
  /** VRAM doluluğu 0–100 ("ön bellek şişmesi" — küreyi şişirir). */
  memPct: number;
  memUsedMb: number;
  memTotalMb: number;
  temperatureC: number | null;
  /** 0..1 hesap yükü (util/100) — nabzın hızını/gücünü sürer. */
  load: number;
  /**
   * 0..1 renk ısısı: ÖNCELİKLE yüke bağlı ("kullanım artınca ısın, düşünce soğu").
   * Sıcaklık yalnız GERÇEKTEN kızışınca (termal uyarı eşiği üstü) ek sıcaklık katar —
   * böylece boşta ~50°C idle'da bir laptop GPU'su küreyi turuncuya kaydırmaz.
   */
  heat: number;
}

/** Termal uyarı: bu sıcaklığın ALTINDA renk sıcaklığı yalnız yükten gelir (boşta ısı normaldir). */
export const TEMP_ALERT_C = 72;
/** Termal tavan: bu sıcaklıkta termal katkı 1'e ulaşır. */
export const TEMP_MAX_C = 90;

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

/**
 * En yoğun GPU'yu (kullanıma göre) birincil seçer — küre tek bir nabız gösterir.
 * GPU yoksa null (küre yalnız mood ile sürülür, fiziksel katman kapalı).
 */
export function deriveGpuVitals(gpus: readonly GpuSample[]): GpuVitals | null {
  if (gpus.length === 0) return null;
  const primary = gpus.reduce((a, b) => (b.utilizationPct > a.utilizationPct ? b : a));
  const load = clamp01(primary.utilizationPct / 100);
  const memPct =
    primary.memTotalMb > 0 ? clamp01(primary.memUsedMb / primary.memTotalMb) * 100 : 0;
  // Renk ısısı = yük (ana) ile termal uyarının EN BÜYÜĞÜ. Termal katkı yalnız TEMP_ALERT_C üstünde
  // pozitif olur; boşta ılık GPU (ör. 50°C) rengi ısıtmaz.
  const tempAlert =
    primary.temperatureC === null
      ? 0
      : clamp01((primary.temperatureC - TEMP_ALERT_C) / (TEMP_MAX_C - TEMP_ALERT_C));
  const heat = Math.max(load, tempAlert);
  return {
    name: primary.name,
    utilizationPct: primary.utilizationPct,
    memPct,
    memUsedMb: primary.memUsedMb,
    memTotalMb: primary.memTotalMb,
    temperatureC: primary.temperatureC,
    load,
    heat,
  };
}
