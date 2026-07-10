import type { ReportResponse } from "@symphony/shared";
import type { UsageQueryResult } from "../db/store.js";
import { hasEnoughEvidence, scoreOf, type RouterStats } from "../router/stats.js";
import type { TaskKind } from "../router/router.js";

/**
 * Kullanım raporu (ADR-016 Karar 5, Dilim Z3): SAF — SQLite'a/sağlayıcıya dokunmaz, girdisi
 * daemon'un ÇOKTAN çektiği veridir. Bu saflık lokallik kabul maddesinin (rapor üretimi hiçbir
 * provider çağrısı yapmaz) doğrudan kanıtıdır — fonksiyonun elinde `fetch`/adapter erişimi YOK.
 *
 * "İkinci gerçek üretme" (Karar 1/5): model×görev-türü başarı tablosu `routerStats`'tan gelir —
 * bu, `router.suggest`'in (Dilim Z1) kullandığı AYNI `computeRouterStats` fonksiyonunun çıktısıdır,
 * yalnız rolling-window yerine rapor bir `[from,to]` aralığıyla çağırır (bkz. daemon.ts).
 */

const TASK_KIND_LABEL: Record<TaskKind, string> = {
  code: "kod",
  quick: "hızlı özet",
  longContext: "uzun bağlam",
  general: "genel",
};

export interface ReportInput {
  from: number;
  to: number;
  usageByModel: UsageQueryResult;
  usageByDay: UsageQueryResult;
  routerStats: RouterStats;
  topErrors: Array<{ code: string; count: number }>;
  feedback: { good: number; bad: number };
}

export function buildReport(input: ReportInput): ReportResponse {
  const successTable: ReportResponse["successTable"] = [];
  const findings: string[] = [];

  for (const [key, entry] of input.routerStats) {
    const [provider, model, taskKind] = key.split("::") as [string, string, TaskKind];
    const hasEvidence = hasEnoughEvidence(entry);
    successTable.push({
      provider,
      model,
      taskKind,
      runs: entry.runs,
      successRate: entry.runs > 0 ? entry.ok / entry.runs : 0,
      avgCostUsd: entry.avgCostUsd,
      ...(entry.avgTurnMs !== undefined ? { avgTurnMs: entry.avgTurnMs } : {}),
      hasEvidence,
    });
    // Eşik-tabanlı bulgu (ADR-016 Karar 5): yalnız KANITLI ve düşük skorlu çiftler için —
    // az örnekli/kanıtsız satırlar yanıltıcı bir "öneri" üretmesin.
    if (hasEvidence && scoreOf(entry) < 0.5) {
      const pct = Math.round((entry.ok / entry.runs) * 100);
      findings.push(
        `${provider}/${model}, ${TASK_KIND_LABEL[taskKind]} işlerinde son ${entry.runs} koşuda ` +
          `%${pct} başarı — düşük güven, farklı bir model denemeyi düşün.`,
      );
    }
  }
  successTable.sort((a, b) => b.runs - a.runs);

  return {
    from: input.from,
    to: input.to,
    totals: input.usageByModel.totals,
    usageByModel: input.usageByModel.rows,
    usageByDay: input.usageByDay.rows,
    successTable,
    topErrors: input.topErrors,
    feedback: input.feedback,
    findings,
  };
}
