import type { DoctorCandidate, ReportResponse, ReportSelfDevCategory } from "@symphony/shared";
import type { AgentModelUsageRow, PatchEntry } from "../db/store.js";
import type { UsageQueryResult } from "../db/store.js";
import { categoryRecord } from "../doctor/trust.js";
import { suggestAgentModelUpdates, type UnpinnedAgentDefinition } from "./agent-suggestions.js";
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

/** `report/markdown.ts`in "Başarı tablosu" bölümü de AYNI etiketleri kullanır (üçüncü kopya yok). */
export const TASK_KIND_LABEL: Record<TaskKind, string> = {
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
  /**
   * Kendini geliştirme (ADR-018 Karar 5/6, Dilim D5). `entries` rapor ARALIĞIYLA sınırlanmaz —
   * `patches` tablosunun ŞU ANKİ tam durumudur (sicil kümülatif bir kavram, D4'teki
   * `patch trust` ile aynı yaklaşım); `recurring` `doctor.diagnose()`nin ŞU ANKİ adaylarıdır.
   */
  patches: {
    recurring: readonly DoctorCandidate[];
    entries: readonly PatchEntry[];
  };
  /**
   * Agent tanım-güncelleme önerisi (ADR-018 Karar 8, Dilim D7). `unpinnedAgentIds`: çağıran
   * taraf ZATEN pinli olan agent'ları eledi (`listAgentDefinitions`ten `model === undefined`
   * filtresi) — bu modül ikinci bir filtre uygulamaz, doğrudan kullanır. `usage`:
   * `store.agentModelUsageSince`'in TAM çıktısı (pinli agent'lar da içinde olabilir, zararsız —
   * yalnız `unpinnedAgentIds`e karşılık gelenler işlenir).
   */
  agents: {
    unpinnedAgentIds: readonly string[];
    usage: readonly AgentModelUsageRow[];
  };
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
    selfDev: buildSelfDevSummary(input.patches.recurring, input.patches.entries),
    agentSuggestions: suggestAgentModelUpdates(
      input.agents.unpinnedAgentIds.map((id): UnpinnedAgentDefinition => ({ id })),
      input.agents.usage,
    ),
  };
}

/**
 * Kendini geliştirme özeti (Dilim D5): durum sayaçları (`patches` tablosu neredeyse hiçbir
 * zaman büyük olmayacağı için kategori başına O(n) tarama pahalı değil — `trust.ts`'in
 * `categoryRecord`'ı ile "ikinci gerçek üretme" ilkesi burada da geçerli, D4'ün AYNI mantığı).
 */
function buildSelfDevSummary(
  recurring: readonly DoctorCandidate[],
  entries: readonly PatchEntry[],
): ReportResponse["selfDev"] {
  let proposed = 0;
  let applied = 0;
  let reverted = 0;
  let failed = 0;
  let rejected = 0;
  const categoryNames = new Set<string>();
  for (const p of entries) {
    categoryNames.add(p.category);
    if (p.state === "proposed") proposed++;
    else if (p.state === "applied") applied++;
    else if (p.state === "reverted") reverted++;
    else if (p.state === "failed") failed++;
    else if (p.state === "rejected") rejected++;
  }

  const categories: ReportSelfDevCategory[] = [...categoryNames]
    .sort()
    .map((category) => categoryRecord(entries, category));

  return { recurring: [...recurring], proposed, applied, reverted, failed, rejected, categories };
}
