import type { ModelInfo } from "@symphony/shared";
import { computeCostUsd } from "../providers/pricing.js";
import {
  hasEnoughEvidence,
  routerStatsKey,
  scoreOf,
  type RouterStats,
  type RouterStatsEntry,
} from "./stats.js";

/**
 * Model yönlendirici v1 — KURAL TABANLI (ROADMAP Faz 1).
 * Görev metninden tür çıkarır, KULLANILABİLİR modeller ve donanım (VRAM)
 * üzerinden gerekçeli öneri listesi üretir. Öneri her zaman şeffaf gerekçelidir
 * (protokol `router.suggest.ok.suggestions[].reason` zorunlu alan).
 *
 * v2 (ADR-016 Karar 2, Dilim Z1): kural iskeleti KORUNUR, `RouterContext.stats` verilirse
 * öneriler kanıtlı skorla YENİDEN SIRALANIR + gerekçelendirilir — yeni aday ÜRETİLMEZ.
 */

export type TaskKind = "code" | "quick" | "longContext" | "general";

export interface RouterContext {
  /** Yalnız KULLANILABİLİR modeller (sağlayıcısı yapılandırılmış/erişilebilir). */
  models: ModelInfo[];
  /** NVIDIA VRAM (GB); tespit edilemediyse null. */
  vramGb: number | null;
  /** ADR-016 Karar 1/2: verilmezse v1 davranışı BİREBİR (kural iskeleti, kanıt yok). */
  stats?: RouterStats;
}

export interface RouterConstraints {
  maxCostUsd?: number;
  preferLocal?: boolean;
}

export interface RouterSuggestion {
  provider: string;
  model: string;
  reason: string;
  local: boolean;
  estimatedCostUsd?: number;
}

/** Orta boy bir istek varsayımı — tahmini maliyet bu senaryoyla hesaplanır. */
const EST_INPUT_TOKENS = 2000;
const EST_OUTPUT_TOKENS = 1000;

/** 7-8B q4 model ~5 GB VRAM ister; altındaysa yerel öneri geriye düşer. */
const LOCAL_COMFORT_VRAM_GB = 5;

/**
 * Canlı bulgu (2026-07-10): görüntü-özel (vision-language) yerel modeller (ör. Qwen-VL ailesi)
 * Ollama'nın OpenAI-uyumlu ucunda araç-çağırma (tool-calling) isteklerinde GÜVENİLİR ÇALIŞMIYOR —
 * `AGENT_...` koşuları "No output generated" ile ilk turda başarısız oluyor. Symphony henüz
 * görüntü GİRDİSİ almıyor (protokolde yok, bkz. docs), o yüzden bu modellerin metin/agent
 * görevlerinde YANLIŞLIKLA seçilmesi (`ModelInfo` sırası Ollama'nın döndürdüğü sıraya bağlı,
 * kullanıcı hangi modeli ne zaman kurduğuna göre değişir) saf bir regresyondur — elenir.
 * Hiç metin-uyumlu yerel model YOKSA (yalnız vision modelleri kuruluysa) yine de kullanılır —
 * hiç öneri vermemek bundan daha kötüdür.
 */
// Sınır önce yalnız HARF değildir (rakam bitişik olabilir: "qwen2.5vl" gibi sürüm+sonek
// ayraçsız birleşebiliyor); sonra harf/rakam değildir. Sınama canlı vakayla doğrulandı.
const VISION_MODEL_PATTERN = /(^|[^a-z])vl([^a-z0-9]|$)|vision|llava|moondream/i;

function preferTextCapable(models: ModelInfo[]): ModelInfo[] {
  const textOnly = models.filter((m) => !VISION_MODEL_PATTERN.test(m.id));
  return textOnly.length > 0 ? textOnly : models;
}

// Kelime kümeleri (regex \b değil: JS'te \b ASCII'dir, "özet" gibi Türkçe
// karakterle başlayan kelimelerde sınır bulamaz). Eşleşme kelime-tam yapılır.
const CODE_WORDS = new Set([
  "kod",
  "kodu",
  "bug",
  "debug",
  "refactor",
  "düzelt",
  "fonksiyon",
  "derle",
  "typescript",
  "python",
  "javascript",
  "rust",
  "regex",
  "api",
  "script",
  "code",
  "implement",
  "fix",
]);
const QUICK_WORDS = new Set([
  "özet",
  "özetle",
  "kısa",
  "hızlı",
  "çevir",
  "çeviri",
  "listele",
  "başlık",
  "quick",
  "summarize",
  "summary",
  "translate",
  "tldr",
]);
const LONG_CONTEXT_WORDS = new Set(["uzun", "kitap", "1m"]);
const LONG_CONTEXT_PHRASES = [
  "tüm repo",
  "büyük dosya",
  "yüzlerce sayfa",
  "long context",
  "milyon token",
];

export function classifyTask(task: string): TaskKind {
  const lower = task.toLowerCase();
  const words = new Set(lower.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 0));
  const hasAny = (set: Set<string>): boolean => [...set].some((w) => words.has(w));

  if (hasAny(LONG_CONTEXT_WORDS) || LONG_CONTEXT_PHRASES.some((p) => lower.includes(p))) {
    return "longContext";
  }
  if (hasAny(CODE_WORDS)) return "code";
  if (hasAny(QUICK_WORDS)) return "quick";
  return "general";
}

/** Bulut modellerinde kalite sırası (v1 kabası): opus > sonnet > haiku > diğer. */
function cloudQualityRank(model: ModelInfo): number {
  if (model.id.includes("opus")) return 0;
  if (model.id.includes("sonnet")) return 1;
  if (model.id.includes("haiku")) return 2;
  return 3;
}

function estimateCost(model: ModelInfo): number {
  return model.local ? 0 : computeCostUsd(model.id, EST_INPUT_TOKENS, EST_OUTPUT_TOKENS);
}

function formatUsd(cost: number): string {
  return `$${cost.toFixed(3)}`;
}

export function suggestModels(
  task: string,
  constraints: RouterConstraints | undefined,
  context: RouterContext,
): RouterSuggestion[] {
  const kind = classifyTask(task);
  const locals = preferTextCapable(context.models.filter((m) => m.local));
  const clouds = [...context.models.filter((m) => !m.local)].sort(
    (a, b) => cloudQualityRank(a) - cloudQualityRank(b),
  );

  const vram = context.vramGb;
  const localFits = vram === null || vram >= LOCAL_COMFORT_VRAM_GB;
  const vramNote =
    vram === null
      ? "VRAM tespit edilemedi"
      : localFits
        ? `VRAM ${vram} GB → 7-8B yerel model rahat`
        : `VRAM ${vram} GB → 7-8B yerel model sığmayabilir`;

  // Kod işinde yerelden "coder" varyantı varsa öne al
  const sortedLocals =
    kind === "code" ? [...locals].sort((a, b) => localCoderRank(a) - localCoderRank(b)) : locals;

  const suggestions: RouterSuggestion[] = [];
  const pushLocal = (reason: string): void => {
    const model = sortedLocals[0];
    if (model === undefined) return;
    suggestions.push({
      provider: model.provider,
      model: model.id,
      reason: `${reason} (${vramNote}).`,
      local: true,
      estimatedCostUsd: 0,
    });
  };
  const pushCloud = (model: ModelInfo | undefined, reason: string): void => {
    if (model === undefined) return;
    const cost = estimateCost(model);
    suggestions.push({
      provider: model.provider,
      model: model.id,
      reason: cost > 0 ? `${reason} (tahmini ~${formatUsd(cost)}/istek).` : `${reason}.`,
      local: false,
      ...(cost > 0 ? { estimatedCostUsd: cost } : {}),
    });
  };

  switch (kind) {
    case "code": {
      pushCloud(clouds[0], "Kod işi: kalite belirleyici — eldeki en güçlü bulut modeli");
      pushLocal("Ücretsiz yerel alternatif; küçük/rutin kod işlerinde yeterli olabilir");
      break;
    }
    case "quick": {
      pushLocal("Hızlı özet/kısa iş: yerel model ücretsiz ve bu iş için yeterli");
      pushCloud(
        clouds.find((m) => m.id.includes("haiku")) ?? clouds[0],
        "Yerel yoksa/yetersizse en ucuz bulut seçeneği",
      );
      break;
    }
    case "longContext": {
      const bigContext = clouds.find((m) => (m.contextWindow ?? 0) >= 500_000) ?? clouds[0];
      pushCloud(
        bigContext,
        `Uzun bağlam: ${((bigContext?.contextWindow ?? 0) / 1000).toFixed(0)}k token pencereli bulut modeli gerekli — yerel modellerin penceresi bunun çok altında`,
      );
      pushLocal("Görev parçalara bölünebilirse ücretsiz yerel seçenek");
      break;
    }
    case "general": {
      pushLocal("Genel iş: önce ücretsiz yerel model — kalite yetmezse buluta yükselt");
      pushCloud(clouds[0], "Kalite öncelikliyse bulut seçeneği");
      break;
    }
  }

  // Donanım yetersizse yerel öneriyi geriye at (tercih açıkça yerel değilse)
  if (!localFits && constraints?.preferLocal !== true) {
    suggestions.sort((a, b) => Number(a.local) - Number(b.local));
  }
  // Kullanıcı yerel istiyorsa yereli öne al
  if (constraints?.preferLocal === true) {
    suggestions.sort((a, b) => Number(b.local) - Number(a.local));
  }
  // Bütçe sınırı: tahmini maliyeti aşan bulut önerileri elenir (yerel 0 ile daima geçer)
  const budget = constraints?.maxCostUsd;
  const withinBudget =
    budget === undefined
      ? suggestions
      : suggestions.filter((s) => (s.estimatedCostUsd ?? 0) <= budget);

  // ADR-016 Karar 2: kanıt varsa (stats verildi VE ilgili model/tür için ≥MIN_SAMPLES koşu
  // varsa) yeniden sırala + gerekçelendir; yoksa v1 sırası/gerekçesi BİREBİR korunur.
  const mixed = context.stats !== undefined ? applyStatsMixing(withinBudget, kind, context.stats) : withinBudget;

  return mixed.slice(0, 3);
}

/** Kanıtlı bir girdiyi kullanıcıya okunur gerekçeye çevirir (ADR-016 Karar 2). */
function describeEvidence(entry: RouterStatsEntry, score: number): string {
  const successPct = entry.runs > 0 ? Math.round((entry.ok / entry.runs) * 100) : 0;
  const parts = [`son ${entry.runs} koşuda %${successPct} başarı`];
  if (entry.avgTurnMs !== undefined) {
    parts.push(`ort. ${(entry.avgTurnMs / 1000).toFixed(1)}s/tur`);
  }
  if (entry.avgCostUsd > 0) {
    parts.push(`ort. ${formatUsd(entry.avgCostUsd)}/koşu`);
  }
  const scoreNote = score < 0.5 ? " — düşük güven skoru" : "";
  return `${parts.join(", ")}${scoreNote}.`;
}

/**
 * v1'in ürettiği öneri listesini kanıtla yeniden sıralar: kanıtlı ve skoru en yüksek (≥0.5)
 * olan BAŞA, kanıtlı ve skoru <0.5 olan SONA taşınır; kanıtsızlar (ya da tek başına ne en
 * yüksek ne düşük olan kanıtlılar) ARADA, orijinal göreli sırayla kalır. Yeni aday üretmez.
 */
function applyStatsMixing(
  suggestions: RouterSuggestion[],
  kind: TaskKind,
  stats: RouterStats,
): RouterSuggestion[] {
  interface Scored {
    suggestion: RouterSuggestion;
    score: number | null;
  }

  const scored: Scored[] = suggestions.map((suggestion) => {
    const entry = stats.get(routerStatsKey(suggestion.provider, suggestion.model, kind));
    if (entry === undefined || !hasEnoughEvidence(entry)) {
      return { suggestion, score: null };
    }
    const score = scoreOf(entry);
    return { suggestion: { ...suggestion, reason: describeEvidence(entry, score) }, score };
  });

  const demoted = new Set(scored.filter((x) => x.score !== null && x.score < 0.5));
  const remaining = scored.filter((x) => !demoted.has(x));

  let promoted: Scored | undefined;
  let bestScore = -Infinity;
  for (const x of remaining) {
    if (x.score !== null && x.score >= 0.5 && x.score > bestScore) {
      bestScore = x.score;
      promoted = x;
    }
  }
  const rest = remaining.filter((x) => x !== promoted);

  return [...(promoted ? [promoted] : []), ...rest, ...demoted].map((x) => x.suggestion);
}

function localCoderRank(model: ModelInfo): number {
  return model.id.includes("coder") ? 0 : 1;
}
