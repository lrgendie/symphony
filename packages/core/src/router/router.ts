import type { ModelInfo } from "@symphony/shared";
import { computeCostUsd } from "../providers/pricing.js";

/**
 * Model yönlendirici v1 — KURAL TABANLI (ROADMAP Faz 1).
 * Görev metninden tür çıkarır, KULLANILABİLİR modeller ve donanım (VRAM)
 * üzerinden gerekçeli öneri listesi üretir. Öneri her zaman şeffaf gerekçelidir
 * (protokol `router.suggest.ok.suggestions[].reason` zorunlu alan).
 *
 * v2 (Faz 6) bu kuralların yerine SQLite'taki gerçek kullanım skorlarını koyacak;
 * arayüz aynı kalacak şekilde tasarlandı.
 */

export type TaskKind = "code" | "quick" | "longContext" | "general";

export interface RouterContext {
  /** Yalnız KULLANILABİLİR modeller (sağlayıcısı yapılandırılmış/erişilebilir). */
  models: ModelInfo[];
  /** NVIDIA VRAM (GB); tespit edilemediyse null. */
  vramGb: number | null;
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
  const locals = context.models.filter((m) => m.local);
  const clouds = [...context.models.filter((m) => !m.local)].sort(
    (a, b) => cloudQualityRank(a) - cloudQualityRank(b),
  );

  const vram = context.vramGb;
  const localFits = vram === null || vram >= LOCAL_COMFORT_VRAM_GB;
  const vramNote =
    vram === null
      ? "VRAM tespit edilemedi"
      : localFitsatı
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

  return withinBudget.slice(0, 3);
}

function localCoderRank(model: ModelInfo): number {
  return model.id.includes("coder") ? 0 : 1;
}
