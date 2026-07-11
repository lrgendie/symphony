/**
 * USD / 1M token. Kaynak: sağlayıcıların resmi model katalogları (2026-06 önbelleği).
 * Bilinmeyen model (ör. yerel Ollama) → maliyet 0.
 * Fiyat güncellemesi = yalnız bu tablo; kod değişmez.
 */
const PRICES_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
  "gpt-5.1": { input: 1.25, output: 10 },
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },
  "gemini-2.5-flash": { input: 0.3, output: 2.5 },
};

/**
 * Prompt cache çarpanları (Anthropic, D2.5): cache'ten OKUNAN token normal girdinin ~%10'u,
 * cache'e YAZILAN token ~%125'i (5 dk TTL) kadar ücretlendirilir.
 */
export const CACHE_READ_MULTIPLIER = 0.1;
export const CACHE_WRITE_MULTIPLIER = 1.25;

export interface CacheTokens {
  /** Cache'ten okunan token — `inputTokens`in İÇİNDE sayılır (AI SDK toplamı böyle verir). */
  read: number;
  /** Cache'e yazılan token — `inputTokens`in İÇİNDE sayılır. */
  creation: number;
}

/**
 * Maliyet. `cache` verilirse (D2.5) cache'lenen token'lar İNDİRİMLİ fiyatlanır:
 * AI SDK'nın `usage.inputTokens`'ı cache okumasını/yazımını TAM sayıyla içerir (canlı ölçüm:
 * input=10844 = uncached 2 + cache_read 10842) — hepsini tam fiyattan saymak, gerçekte %10'a
 * okunan token'ı 10 kat pahalı göstermek olurdu (kendi defterimizi şişirirdik).
 */
export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cache?: CacheTokens,
): number {
  const price = PRICES_PER_MTOK[model];
  if (!price) return 0;
  const read = Math.min(cache?.read ?? 0, inputTokens);
  const creation = Math.min(cache?.creation ?? 0, Math.max(0, inputTokens - read));
  const uncached = Math.max(0, inputTokens - read - creation);
  const inputCost =
    uncached * price.input +
    read * price.input * CACHE_READ_MULTIPLIER +
    creation * price.input * CACHE_WRITE_MULTIPLIER;
  return (inputCost + outputTokens * price.output) / 1_000_000;
}
