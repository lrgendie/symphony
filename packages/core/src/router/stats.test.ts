import { describe, expect, it } from "vitest";
import {
  computeRouterStats,
  hasEnoughEvidence,
  MIN_SAMPLES,
  routerStatsKey,
  scoreOf,
  type FeedbackRow,
} from "./stats.js";
import type { RouterRunRow, RouterTurnStatsRow } from "../db/store.js";

const run = (overrides: Partial<RouterRunRow>): RouterRunRow => ({
  task: "şu kodu düzelt",
  provider: "ollama",
  model: "qwen3:8b",
  ok: true,
  costUsd: 0,
  ...overrides,
});

describe("computeRouterStats", () => {
  it("görev metnini classifyTask ile türe ayırıp (provider, model, tür) başına gruplar", () => {
    const stats = computeRouterStats(
      [
        run({ task: "şu bug'ı düzelt", ok: true }),
        run({ task: "bu metni özetle", ok: true }), // farklı tür (quick) → AYRI kova
      ],
      [],
      [],
    );
    const codeEntry = stats.get(routerStatsKey("ollama", "qwen3:8b", "code"));
    const quickEntry = stats.get(routerStatsKey("ollama", "qwen3:8b", "quick"));
    expect(codeEntry).toMatchObject({ runs: 1, ok: 1 });
    expect(quickEntry).toMatchObject({ runs: 1, ok: 1 });
  });

  it("aynı (provider, model, tür) için koşuları biriktirir; ok/başarısız ayrımını korur", () => {
    const stats = computeRouterStats(
      [
        run({ task: "kod düzelt 1", ok: true, costUsd: 0.01 }),
        run({ task: "kod düzelt 2", ok: true, costUsd: 0.03 }),
        run({ task: "kod düzelt 3", ok: false, costUsd: 0.02 }),
      ],
      [],
      [],
    );
    const entry = stats.get(routerStatsKey("ollama", "qwen3:8b", "code"));
    expect(entry).toMatchObject({ runs: 3, ok: 2 });
    // Ortalama maliyet toplam/adet: (0.01+0.03+0.02)/3
    expect(entry?.avgCostUsd).toBeCloseTo(0.02, 5);
  });

  it("`cancelled` koşular temsil edilemez — filtre store.runsSince'te (yalnız completed/failed döner), burada girdi zaten temiz", () => {
    // computeRouterStats'ın RouterRunRow'unda "cancelled" diye bir durum YOK (ok: boolean
    // yalnız completed/failed ayrımı taşır) — dışarıda bırakma sorumluluğu store katmanında
    // (bkz. store.test.ts: runsSince cancelled state'i SQL'de eler). Burada yalnız temiz
    // girdiyle doğru sayıldığını doğruluyoruz.
    const stats = computeRouterStats([run({ ok: true }), run({ ok: false })], [], []);
    const entry = stats.get(routerStatsKey("ollama", "qwen3:8b", "code"));
    expect(entry?.runs).toBe(2);
  });

  it("turnStatsRows ile eşleşen (provider, model) için avgTurnMs uygulanır — türden BAĞIMSIZ aynı ortalama", () => {
    const turnStats: RouterTurnStatsRow[] = [
      { provider: "ollama", model: "qwen3:8b", avgDurationMs: 4200, turns: 7 },
    ];
    const stats = computeRouterStats(
      [run({ task: "kod düzelt" }), run({ task: "özetle" })],
      turnStats,
      [],
    );
    expect(stats.get(routerStatsKey("ollama", "qwen3:8b", "code"))?.avgTurnMs).toBe(4200);
    expect(stats.get(routerStatsKey("ollama", "qwen3:8b", "quick"))?.avgTurnMs).toBe(4200);
  });

  it("feedback satırları iyi/kötü sayaçlarını artırır — koşusu OLMAYAN bir (model,tür) için de kova açar", () => {
    const feedback: FeedbackRow[] = [
      { provider: "anthropic", model: "claude-haiku-4-5", taskKind: "quick", verdict: "good" },
      { provider: "anthropic", model: "claude-haiku-4-5", taskKind: "quick", verdict: "bad" },
    ];
    const stats = computeRouterStats([], [], feedback);
    const entry = stats.get(routerStatsKey("anthropic", "claude-haiku-4-5", "quick"));
    expect(entry).toMatchObject({ runs: 0, ok: 0, iyi: 1, kötü: 1 });
  });
});

describe("scoreOf — Laplace düzeltmeli, açık geri bildirim 2× ağır (ADR-016 Karar 2)", () => {
  it("yalnız koşu verisiyle: score = (ok+1)/(runs+2)", () => {
    expect(scoreOf({ runs: 5, ok: 1, iyi: 0, kötü: 0, avgCostUsd: 0 })).toBeCloseTo(2 / 7, 5);
    expect(scoreOf({ runs: 10, ok: 9, iyi: 0, kötü: 0, avgCostUsd: 0 })).toBeCloseTo(10 / 12, 5);
  });

  it("bir 'kötü' işareti iki başarısız koşuya denk ağırlıkta düşürür", () => {
    // effOk = 0 + 0, effRuns = 0 + 2*1 = 2 → score = (0+1)/(2+2) = 0.25
    const scoreBad = scoreOf({ runs: 0, ok: 0, iyi: 0, kötü: 1, avgCostUsd: 0 });
    expect(scoreBad).toBeCloseTo(0.25, 5);
  });

  it("bir 'iyi' işareti iki başarılı koşuya denk ağırlıkta yükseltir", () => {
    // effOk = 0 + 2*1 = 2, effRuns = 0 + 2*1 = 2 → score = (2+1)/(2+2) = 0.75
    const scoreGood = scoreOf({ runs: 0, ok: 0, iyi: 1, kötü: 0, avgCostUsd: 0 });
    expect(scoreGood).toBeCloseTo(0.75, 5);
  });
});

describe("hasEnoughEvidence — MIN_SAMPLES sınırı", () => {
  it(`runs < ${MIN_SAMPLES} kanıt SAYILMAZ; runs >= ${MIN_SAMPLES} sayılır`, () => {
    expect(hasEnoughEvidence({ runs: MIN_SAMPLES - 1, ok: 0, iyi: 0, kötü: 0, avgCostUsd: 0 })).toBe(
      false,
    );
    expect(hasEnoughEvidence({ runs: MIN_SAMPLES, ok: 0, iyi: 0, kötü: 0, avgCostUsd: 0 })).toBe(true);
  });
});
