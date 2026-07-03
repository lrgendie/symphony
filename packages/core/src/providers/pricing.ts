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

export function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES_PER_MTOK[model];
  if (!price) return 0;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
