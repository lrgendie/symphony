/**
 * Ajan uyduları — SAF (React/Three.js YOK), rng enjekte edilir → deterministik birim test
 * (`pulses.ts` ile AYNI desen). TASARIM.md §2'nin öngördüğü "tesseract canlı mimari haritası"
 * fikrinin somutlaşması: her AKTİF koşu tesseract'ın etrafında kendi uydusuyla temsil edilir
 * (Faz 4 "her agent'ın kendi yaşam formu" maddesi). Bu modül HANGİ koşunun uydusu olduğunu ve
 * doğuş/ölüm (patla-sön) ilerlemesini tutar; yörünge trigonometrisi (motes ile AYNI desen)
 * TesseractScene.tsx'te kalır.
 */

export type SatelliteKind = "top" | "child";
export type SatelliteMood = "thinking" | "executing" | "awaiting" | "done" | "failed";

export interface SatelliteInput {
  runId: string;
  /** `parentRunId !== undefined` — ADR-014 devretme hiyerarşisi. */
  isChild: boolean;
  /** `ActiveRun.state` (protokol string'i) — `mapSatelliteMood` ile mood'a çevrilir. */
  state: string;
}

export interface SatelliteEntry {
  runId: string;
  kind: SatelliteKind;
  /** [0, 2π) — çember üstünde SABİT başlangıç açısı; koşu ömrü boyunca değişmez (kimlik). */
  angleSeed: number;
  /** 0..1 doğuş ilerlemesi (fade-in). */
  spawnT: number;
  /** null = canlı; sayı = ölüm/patlama ilerlemesi 0..1 (1'e varınca sistemden silinir). */
  dieT: number | null;
  mood: SatelliteMood;
}

export interface SatelliteSystem {
  readonly entries: Map<string, SatelliteEntry>;
}

/** ADR-014'ün `MAX_CHILD_RUNS` sigortasıyla AYNI sayı — sahne kalabalıklaşmasın. */
export const MAX_SATELLITES = 8;
const SPAWN_TAU = 0.4;
/** "Patla-sön" ölüm animasyonunun toplam süresi (saniye). */
const DIE_DURATION = 0.6;

export type Rng = () => number;

export function createSatelliteSystem(): SatelliteSystem {
  return { entries: new Map() };
}

/** `AgentRunState` (protokol) → uydu mood'u. Bilinmeyen/gelecek state'ler "thinking" sayılır. */
export function mapSatelliteMood(state: string): SatelliteMood {
  if (state === "executing_tool") return "executing";
  if (state === "awaiting_permission" || state === "awaiting_user") return "awaiting";
  if (state === "failed") return "failed";
  if (state === "completed" || state === "cancelled") return "done";
  return "thinking";
}

/**
 * Aktif koşu listesiyle sistemi eşitler: yeni koşu → yeni uydu (spawnT=0, sabit rastgele açı);
 * hâlâ aktif → mood güncellenir, ölüm iptal edilir (yeniden görülürse "diriliş"); artık aktif
 * DEĞİLSE (bitti/kayboldu) → ölüm animasyonu başlar (anında SİLİNMEZ, `advanceSatellites` bitirir).
 * Kapasiteyi aşan koşular sessizce dışarıda bırakılır — çağıran EN YENİ `MAX_SATELLITES` koşuyu
 * baştan sıralamalı (görsel `runs` listesi zaten bu sırayla gelir).
 */
export function syncSatellites(sys: SatelliteSystem, active: readonly SatelliteInput[], rng: Rng): void {
  const seen = new Set<string>();
  for (const input of active.slice(0, MAX_SATELLITES)) {
    seen.add(input.runId);
    const mood = mapSatelliteMood(input.state);
    const existing = sys.entries.get(input.runId);
    if (existing === undefined) {
      sys.entries.set(input.runId, {
        runId: input.runId,
        kind: input.isChild ? "child" : "top",
        angleSeed: rng() * Math.PI * 2,
        spawnT: 0,
        dieT: null,
        mood,
      });
    } else {
      existing.mood = mood;
      existing.dieT = null;
    }
  }
  for (const entry of sys.entries.values()) {
    if (!seen.has(entry.runId) && entry.dieT === null) entry.dieT = 0;
  }
}

export interface AdvanceSatellitesResult {
  /** Bu adımda ölüm animasyonu TAMAMLANIP sistemden silinen uydu sayısı. */
  despawned: number;
}

/** dt saniye ilerletir: doğuş yükselir (SPAWN_TAU), ölüm ilerler (DIE_DURATION) → 1'de silinir. */
export function advanceSatellites(sys: SatelliteSystem, dt: number): AdvanceSatellitesResult {
  let despawned = 0;
  for (const [id, entry] of sys.entries) {
    if (entry.spawnT < 1) entry.spawnT = Math.min(1, entry.spawnT + dt / SPAWN_TAU);
    if (entry.dieT !== null) {
      entry.dieT += dt / DIE_DURATION;
      if (entry.dieT >= 1) {
        sys.entries.delete(id);
        despawned += 1;
      }
    }
  }
  return { despawned };
}
