import type { RouterRunRow, RouterTurnStatsRow } from "../db/store.js";
import { classifyTask, type TaskKind } from "./router.js";

/**
 * Router v2 skor hesaplaması (ADR-016 Karar 1+2). SAF — SQLite'a dokunmaz, girdisi
 * `store.runsSince`/`turnStatsSince`/(Dilim Z2'de) `feedbackSince`'in ham satırları.
 */

/** Skor için kanıt sayılan alt sınır: bundan az koşusu olan model hakkında görüş bildirilmez. */
export const MIN_SAMPLES = 3;

/** Öğrenme penceresi (gün) — sabit; gerçek talep doğarsa config anahtarına taşınır. */
export const STATS_WINDOW_DAYS = 30;

export interface FeedbackRow {
  provider: string;
  model: string;
  taskKind: TaskKind;
  verdict: "good" | "bad";
}

export interface RouterStatsEntry {
  runs: number;
  ok: number;
  iyi: number;
  kötü: number;
  avgCostUsd: number;
  avgTurnMs?: number;
}

/** Anahtar `"<provider>::<model>::<taskKind>"` — üç alanlı Map yerine düz string anahtar. */
export type RouterStats = Map<string, RouterStatsEntry>;

/** `router.ts`'in karışım adımında AYNI anahtarla arama yapması için dışa açık. */
export function routerStatsKey(provider: string, model: string, kind: TaskKind): string {
  return `${provider}::${model}::${kind}`;
}

/**
 * Görev türünü sınıflandırıp `(provider, model, taskKind)` başına ham koşu/tur/geri-bildirim
 * sayılarını gruplar. `runRows`/`turnStatsRows`/`feedbackRows` bağımsız kaynaklardan gelir
 * (agent_runs / requests / feedback tabloları) — burada yalnız birleştirilir.
 */
export function computeRouterStats(
  runRows: RouterRunRow[],
  turnStatsRows: RouterTurnStatsRow[],
  feedbackRows: FeedbackRow[],
): RouterStats {
  const stats: RouterStats = new Map();

  const entryFor = (provider: string, model: string, kind: TaskKind): RouterStatsEntry => {
    const key = routerStatsKey(provider, model, kind);
    let entry = stats.get(key);
    if (entry === undefined) {
      entry = { runs: 0, ok: 0, iyi: 0, kötü: 0, avgCostUsd: 0 };
      stats.set(key, entry);
    }
    return entry;
  };

  // Maliyet ortalamasını akan biriktirme yerine toplam/adet ile hesaplamak için ayrı toplam tutulur.
  const costTotals = new Map<string, number>();

  for (const row of runRows) {
    const kind = classifyTask(row.task);
    const key = routerStatsKey(row.provider, row.model, kind);
    const entry = entryFor(row.provider, row.model, kind);
    entry.runs += 1;
    if (row.ok) entry.ok += 1;
    costTotals.set(key, (costTotals.get(key) ?? 0) + row.costUsd);
  }
  for (const [key, entry] of stats) {
    const total = costTotals.get(key) ?? 0;
    entry.avgCostUsd = entry.runs > 0 ? total / entry.runs : 0;
  }

  // Tur hızı sağlayıcı+model bazında gelir (görev türünden bağımsız) — o modelin İÇİNDEKİ
  // her türe aynı ortalama uygulanır (Karar 1: agent_runs süresi insan beklemesi taşır, kullanılmaz).
  for (const turnRow of turnStatsRows) {
    for (const [key, entry] of stats) {
      const [provider, model] = key.split("::");
      if (provider === turnRow.provider && model === turnRow.model) {
        entry.avgTurnMs = turnRow.avgDurationMs;
      }
    }
  }

  for (const feedback of feedbackRows) {
    const entry = entryFor(feedback.provider, feedback.model, feedback.taskKind);
    if (feedback.verdict === "good") entry.iyi += 1;
    else entry.kötü += 1;
  }

  return stats;
}

/**
 * Laplace düzeltmeli skor, açık geri bildirim 2× ağır (ADR-016 Karar 2):
 * effOk = ok + 2·iyi, effRuns = runs + 2·(iyi+kötü), score = (effOk + 1) / (effRuns + 2).
 */
export function scoreOf(entry: RouterStatsEntry): number {
  const effOk = entry.ok + 2 * entry.iyi;
  const effRuns = entry.runs + 2 * (entry.iyi + entry.kötü);
  return (effOk + 1) / (effRuns + 2);
}

/** `runs >= MIN_SAMPLES` değilse kanıt YOK sayılır (soğuk başlangıç garantisi). */
export function hasEnoughEvidence(entry: RouterStatsEntry): boolean {
  return entry.runs >= MIN_SAMPLES;
}
