/**
 * Yaşayan Küre'nin FİZİKSEL vitalleri — GPU örneklerinden türetilen tek anlam kaynağı.
 * Saf fonksiyon (React/Three.js yok) → birim test edilebilir. LivingScene bunu görsele çevirir.
 * TASARIM.md §2: her hareketin GERÇEK anlamı var — burada anlam = donanım yükü/ısısı/belleği.
 */

import type { GpuSample } from "@symphony/shared";

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
  /** 0..1 ısı: sıcaklıktan normalize; sıcaklık okunamıyorsa yük'e düşer. Rengi ısıtır. */
  heat: number;
}

/** Isı normalizasyon aralığı: boştaki tipik GPU ~35°C, yük altında ~84°C'ye yaklaşır. */
export const TEMP_MIN_C = 35;
export const TEMP_MAX_C = 84;

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
  const heat =
    primary.temperatureC === null
      ? load
      : clamp01((primary.temperatureC - TEMP_MIN_C) / (TEMP_MAX_C - TEMP_MIN_C));
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
