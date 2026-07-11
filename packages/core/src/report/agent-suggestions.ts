import { hasEnoughEvidence, scoreOf, type RouterStatsEntry } from "../router/stats.js";

/**
 * Agent tanım-güncelleme önerisi (ADR-018 Karar 8, Faz 8 Dilim D7) — Faz 6'nın açık kalan son
 * maddesi, D5 raporunun uzantısı. SAF: DB/dosya sistemine dokunmaz, girdisi daemon'un ÇOKTAN
 * çektiği `agentModelUsageSince` satırlarıdır (router v2'nin AYNI `scoreOf`/`hasEnoughEvidence`
 * eşiğini kullanır — "ikinci gerçek üretme" yasağı burada da geçerli).
 *
 * **BİLİNÇLE dar kapsam:** yalnız model PİNLEME önerilir, yalnız PİNLENMEMİŞ agent'lar için.
 * Zaten pinli bir agent kendi geçmişinde HİÇBİR ZAMAN başka bir modelle çalışmadığı için "öteki
 * model daha iyiydi" diye bir kanıt oluşamaz — alternatif önermek TAHMİN olurdu (D2'nin dersi:
 * doktor'un modeli veri değil genel bilgiyle sabitlendi, o türden bir kararı otomatikleştirmek
 * riskli). Bu yüzden pinli agent'lar bu fonksiyonun GİRDİSİNDE bile yer almaz.
 */

/** Karar 8: iki en iyi seçenek arasında EN AZ bu kadar skor farkı olmalı ki öneri "açık" sayılsın. */
export const SCORE_GAP_THRESHOLD = 0.2;

export interface AgentModelUsage {
  agentId: string;
  provider: string;
  model: string;
  runs: number;
  ok: number;
}

/** Yalnız `model`i BOŞ olan tanımlar aday olur — pinli agent'lar zaten dışarıda tutulmalı. */
export interface UnpinnedAgentDefinition {
  id: string;
}

export interface AgentSuggestion {
  agentId: string;
  suggestedProvider: string;
  suggestedModel: string;
  suggestedRuns: number;
  suggestedSuccessRate: number;
  /** İkinci en iyi seçenek — gerekçe cümlesinde karşılaştırma için. */
  runnerUpProvider: string;
  runnerUpModel: string;
  runnerUpSuccessRate: number;
  reason: string;
}

function toEntry(u: AgentModelUsage): RouterStatsEntry {
  return { runs: u.runs, ok: u.ok, iyi: 0, kötü: 0, avgCostUsd: 0 };
}

/**
 * `definitions`: yalnız PİNSİZ agent tanımları (çağıran taraf pinli olanları önceden eler —
 * bkz. `report/build.ts`). `usage`: `store.agentModelUsageSince`'in TAM çıktısı (tüm agent'lar,
 * pinli dahil) — bu fonksiyon `definitions`e göre filtreler, ikinci bir sorgu gerekmez.
 */
export function suggestAgentModelUpdates(
  definitions: readonly UnpinnedAgentDefinition[],
  usage: readonly AgentModelUsage[],
): AgentSuggestion[] {
  const suggestions: AgentSuggestion[] = [];

  for (const def of definitions) {
    const rows = usage.filter((u) => u.agentId === def.id && hasEnoughEvidence(toEntry(u)));
    if (rows.length < 2) continue; // karşılaştırma için EN AZ iki kanıtlı seçenek gerekir

    const ranked = [...rows].sort((a, b) => scoreOf(toEntry(b)) - scoreOf(toEntry(a)));
    const best = ranked[0];
    const runnerUp = ranked[1];
    if (best === undefined || runnerUp === undefined) continue;

    const bestScore = scoreOf(toEntry(best));
    const runnerUpScore = scoreOf(toEntry(runnerUp));
    if (bestScore - runnerUpScore < SCORE_GAP_THRESHOLD) continue; // fark AÇIK değil — öneri yok

    const bestRate = Math.round((best.ok / best.runs) * 100);
    const runnerUpRate = Math.round((runnerUp.ok / runnerUp.runs) * 100);
    suggestions.push({
      agentId: def.id,
      suggestedProvider: best.provider,
      suggestedModel: best.model,
      suggestedRuns: best.runs,
      suggestedSuccessRate: best.ok / best.runs,
      runnerUpProvider: runnerUp.provider,
      runnerUpModel: runnerUp.model,
      runnerUpSuccessRate: runnerUp.ok / runnerUp.runs,
      reason:
        `'${def.id}' agent'ı ${best.provider}/${best.model} ile son ${best.runs} koşuda %${bestRate} ` +
        `başarılı — ${runnerUp.provider}/${runnerUp.model}'in %${runnerUpRate}'sinden (${runnerUp.runs} ` +
        `koşu) açıkça daha iyi. Router her seferinde yeniden seçmek yerine bu modele SABİTLEMEYİ düşün.`,
    });
  }

  return suggestions;
}
