import { describe, expect, it } from "vitest";
import type { ModelInfo } from "@lrgendie/shared";
import { classifyTask, suggestModels, type RouterContext } from "./router.js";
import { routerStatsKey, type RouterStats, type RouterStatsEntry } from "./stats.js";

const opus: ModelInfo = {
  provider: "anthropic",
  id: "claude-opus-4-8",
  local: false,
  contextWindow: 1_000_000,
};
const haiku: ModelInfo = {
  provider: "anthropic",
  id: "claude-haiku-4-5",
  local: false,
  contextWindow: 200_000,
};
const qwen: ModelInfo = { provider: "ollama", id: "qwen3:8b", local: true, contextWindow: 40_960 };
const qwenCoder: ModelInfo = { provider: "ollama", id: "qwen2.5-coder:7b", local: true };
const qwenVl: ModelInfo = { provider: "ollama", id: "qwen2.5vl:7b", local: true };

const fullContext: RouterContext = { models: [opus, haiku, qwen], vramGb: 8 };

describe("classifyTask", () => {
  it("görev türlerini Türkçe/İngilizce anahtar kelimelerden çıkarır", () => {
    expect(classifyTask("şu fonksiyondaki bug'ı düzelt")).toBe("code");
    expect(classifyTask("bu makaleyi özetle")).toBe("quick");
    expect(classifyTask("kitap uzunluğunda belgeyi analiz et")).toBe("longContext");
    expect(classifyTask("bana bir yemek tarifi ver")).toBe("general");
  });
});

describe("suggestModels", () => {
  it("kod işinde en güçlü bulut modeli önde, gerekçe ve tahmini maliyetle", () => {
    const result = suggestModels("şu kodu refactor et", undefined, fullContext);
    expect(result[0]?.model).toBe("claude-opus-4-8");
    expect(result[0]?.reason).toContain("Kod işi");
    expect(result[0]?.estimatedCostUsd).toBeGreaterThan(0);
    // Yerel alternatif de sunulur ve donanım notu taşır
    expect(result[1]?.local).toBe(true);
    expect(result[1]?.reason).toContain("VRAM 8 GB");
  });

  it("kod işinde yerel 'coder' varyantı düz modele tercih edilir", () => {
    const context: RouterContext = { models: [qwen, qwenCoder], vramGb: 8 };
    const result = suggestModels("write code to fix this bug", undefined, context);
    const local = result.find((s) => s.local);
    expect(local?.model).toBe("qwen2.5-coder:7b");
  });

  it("hızlı özet işinde yerel model önde ve ücretsiz", () => {
    const result = suggestModels("bu metni özetle", undefined, fullContext);
    expect(result[0]).toMatchObject({ provider: "ollama", local: true, estimatedCostUsd: 0 });
  });

  it("uzun bağlamda geniş pencereli bulut modeli önerilir", () => {
    const result = suggestModels("kitap boyutunda dosyayı incele", undefined, fullContext);
    expect(result[0]?.model).toBe("claude-opus-4-8");
    expect(result[0]?.reason).toContain("1000k");
  });

  it("preferLocal yereli öne alır; maxCostUsd bulutu eler", () => {
    const preferred = suggestModels("şu kodu düzelt", { preferLocal: true }, fullContext);
    expect(preferred[0]?.local).toBe(true);

    const budget = suggestModels("şu kodu düzelt", { maxCostUsd: 0 }, fullContext);
    expect(budget.length).toBeGreaterThan(0);
    expect(budget.every((s) => s.local)).toBe(true);
  });

  it("VRAM yetersizse yerel öneri geriye düşer ve gerekçe uyarır", () => {
    const smallVram: RouterContext = { models: [opus, qwen], vramGb: 4 };
    const result = suggestModels("bu metni özetle", undefined, smallVram);
    expect(result[0]?.local).toBe(false);
    const local = result.find((s) => s.local);
    expect(local?.reason).toContain("sığmayabilir");
  });

  it("hiç model yoksa boş liste döner (daemon hataya çevirir)", () => {
    expect(suggestModels("herhangi bir iş", undefined, { models: [], vramGb: null })).toEqual([]);
  });

  it("canlı bulgu (2026-07-10): vision modeli (qwen2.5vl) metin/agent görevlerinde ATLANIR — listede olsa bile önerilmez", () => {
    // qwenVl DİZİDE ÖNCE geliyor (Ollama'nın gerçek dünyada döndürebileceği sıra) — router
    // yine de onu değil, metin-uyumlu qwen'i önermeli (aksi hâlde AGENT_... "No output
    // generated" ile başarısız oluyordu, canlı test edildi).
    const context: RouterContext = { models: [qwenVl, qwen], vramGb: 8 };
    const result = suggestModels("yeni bir klasör oluştur", undefined, context);
    const local = result.find((s) => s.local);
    expect(local?.model).toBe("qwen3:8b");
    expect(result.some((s) => s.model === "qwen2.5vl:7b")).toBe(false);
  });

  it("yalnız vision modeli kuruluysa (metin-uyumlu yerel YOK) yine de o kullanılır — hiç öneri yoktan iyidir", () => {
    const context: RouterContext = { models: [qwenVl], vramGb: 8 };
    const result = suggestModels("bir özet yaz", undefined, context);
    const local = result.find((s) => s.local);
    expect(local?.model).toBe("qwen2.5vl:7b");
  });
});

describe("suggestModels — router v2 stats karışımı (ADR-016 Karar 2)", () => {
  const entry = (overrides: Partial<RouterStatsEntry>): RouterStatsEntry => ({
    runs: 0,
    ok: 0,
    iyi: 0,
    kötü: 0,
    avgCostUsd: 0,
    ...overrides,
  });

  it("kanıt YOKSA (stats verilse bile eşleşen entry yok) v1 sırası/gerekçesi BİREBİR korunur", () => {
    const v1 = suggestModels("şu kodu refactor et", undefined, fullContext);
    const stats: RouterStats = new Map(); // boş — hiçbir modele kanıt yok
    const v2 = suggestModels("şu kodu refactor et", undefined, { ...fullContext, stats });
    expect(v2).toEqual(v1);
  });

  it("MIN_SAMPLES altı (2 koşu) kanıt SAYILMAZ — sıra/gerekçe v1 ile aynı kalır", () => {
    const stats: RouterStats = new Map([
      [routerStatsKey("ollama", "qwen3:8b", "code"), entry({ runs: 2, ok: 2 })],
    ]);
    const v1 = suggestModels("şu kodu refactor et", undefined, fullContext);
    const v2 = suggestModels("şu kodu refactor et", undefined, { ...fullContext, stats });
    expect(v2).toEqual(v1);
  });

  it("kanıtlı düşük skor (<0.5) DEMOTE edilir — listenin sonuna iner, gerekçe kanıtla değişir", () => {
    // score = (1 + 2*1) / (5 + 2) = 3/7 ≈ 0.43 < 0.5
    const stats: RouterStats = new Map([
      [routerStatsKey("anthropic", "claude-opus-4-8", "code"), entry({ runs: 5, ok: 1 })],
    ]);
    const result = suggestModels("şu kodu refactor et", undefined, { ...fullContext, stats });
    // v1'de opus (bulut) başta, qwen (yerel) ikinciydi — düşük skor opus'u SONA atar.
    expect(result[0]?.model).toBe("qwen3:8b");
    expect(result.at(-1)?.model).toBe("claude-opus-4-8");
    expect(result.at(-1)?.reason).toContain("son 5 koşuda %20 başarı");
    expect(result.at(-1)?.reason).toContain("düşük güven skoru");
  });

  it("kanıtlı en yüksek skor (≥0.5) PROMOTE edilir — başa çıkar, gerekçe kanıt sayılarını taşır", () => {
    // score = (9 + 1) / (10 + 2) = 10/12 ≈ 0.83 ≥ 0.5
    const stats: RouterStats = new Map([
      [
        routerStatsKey("ollama", "qwen3:8b", "code"),
        entry({ runs: 10, ok: 9, avgTurnMs: 2500, avgCostUsd: 0 }),
      ],
    ]);
    const result = suggestModels("şu kodu refactor et", undefined, { ...fullContext, stats });
    // v1'de qwen (yerel) ikinciydi — yüksek skor onu BAŞA taşır.
    expect(result[0]?.model).toBe("qwen3:8b");
    expect(result[0]?.reason).toContain("son 10 koşuda %90 başarı");
    expect(result[0]?.reason).toContain("2.5s/tur");
  });

  it("kanıtlı yüksek maliyetli model gerekçesinde ortalama maliyet görünür", () => {
    const stats: RouterStats = new Map([
      [
        routerStatsKey("anthropic", "claude-opus-4-8", "code"),
        entry({ runs: 4, ok: 4, avgCostUsd: 0.021 }),
      ],
    ]);
    const result = suggestModels("şu kodu refactor et", undefined, { ...fullContext, stats });
    const opusResult = result.find((s) => s.model === "claude-opus-4-8");
    expect(opusResult?.reason).toContain("$0.021/koşu");
  });
});
