import { describe, expect, it } from "vitest";
import { suggestAgentModelUpdates, type AgentModelUsage } from "./agent-suggestions.js";

/**
 * ADR-018 Karar 8 (Faz 8, Dilim D7) — Faz 6'nın açık kalan son maddesi. SAF: girdisi
 * `store.agentModelUsageSince`in ÇOKTAN çekilmiş satırlarıdır, DB'ye dokunmaz.
 */

function usage(overrides: Partial<AgentModelUsage> = {}): AgentModelUsage {
  return { agentId: "coder", provider: "ollama", model: "qwen3:8b", runs: 5, ok: 4, ...overrides };
}

describe("suggestAgentModelUpdates — SAF, yalnız PİNSİZ agent'lar (D2'nin dersi: alternatif TAHMİN olmasın)", () => {
  it("tek (provider,model) kombinasyonu varsa öneri YOK — karşılaştırma imkanı yok", () => {
    const result = suggestAgentModelUpdates([{ id: "coder" }], [usage({ runs: 10, ok: 9 })]);
    expect(result).toEqual([]);
  });

  it("iki AÇIK farklı seçenek varsa (skor farkı ≥0.2) en iyisini önerir", () => {
    const usageRows = [
      usage({ provider: "ollama", model: "qwen3:8b", runs: 5, ok: 1 }), // %20
      usage({ provider: "anthropic", model: "claude-haiku-4-5", runs: 5, ok: 5 }), // %100
    ];
    const result = suggestAgentModelUpdates([{ id: "coder" }], usageRows);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      agentId: "coder",
      suggestedProvider: "anthropic",
      suggestedModel: "claude-haiku-4-5",
      runnerUpProvider: "ollama",
      runnerUpModel: "qwen3:8b",
    });
    expect(result[0]?.reason).toContain("coder");
    expect(result[0]?.reason).toContain("SABİTLEMEYİ");
  });

  it("skor farkı EŞİĞİN ALTINDAYSA (< 0.2) öneri YAPILMAZ — yakın seçenekler arasında tahmin yürütülmez", () => {
    const usageRows = [
      usage({ provider: "ollama", model: "qwen3:8b", runs: 10, ok: 6 }), // %60
      usage({ provider: "anthropic", model: "claude-haiku-4-5", runs: 10, ok: 7 }), // %70 — fark küçük
    ];
    expect(suggestAgentModelUpdates([{ id: "coder" }], usageRows)).toEqual([]);
  });

  it("MIN_SAMPLES altında (kanıtsız) satırlar karşılaştırmaya HİÇ girmez", () => {
    const usageRows = [
      usage({ provider: "ollama", model: "qwen3:8b", runs: 2, ok: 0 }), // kanıtsız (runs<3)
      usage({ provider: "anthropic", model: "claude-haiku-4-5", runs: 10, ok: 10 }),
    ];
    // Yalnız BİR kanıtlı satır kaldığı için karşılaştırma imkanı yok → öneri YOK.
    expect(suggestAgentModelUpdates([{ id: "coder" }], usageRows)).toEqual([]);
  });

  it("PİNLİ agent'lar `definitions` girdisinde YER ALMAZ — çağıran taraf zaten eledi (bu modül ikinci bir filtre uygulamaz)", () => {
    // "doktor" definitions listesinde YOK (pinli olduğu için çağıran filtreledi varsayımı) —
    // usage'da kötü performans olsa bile hiçbir şey önerilmez çünkü tanım hiç aday değil.
    const usageRows = [
      usage({ agentId: "doktor", provider: "ollama", model: "qwen3:8b", runs: 5, ok: 0 }),
      usage({ agentId: "doktor", provider: "anthropic", model: "claude-sonnet-5", runs: 5, ok: 5 }),
    ];
    expect(suggestAgentModelUpdates([{ id: "coder" }], usageRows)).toEqual([]);
  });

  it("birden fazla agent BAĞIMSIZ değerlendirilir", () => {
    const usageRows = [
      usage({ agentId: "coder", provider: "ollama", model: "qwen3:8b", runs: 5, ok: 1 }),
      usage({ agentId: "coder", provider: "anthropic", model: "claude-haiku-4-5", runs: 5, ok: 5 }),
      usage({ agentId: "asistan", provider: "ollama", model: "qwen3:8b", runs: 5, ok: 5 }),
      usage({ agentId: "asistan", provider: "anthropic", model: "claude-haiku-4-5", runs: 5, ok: 1 }),
    ];
    const result = suggestAgentModelUpdates([{ id: "coder" }, { id: "asistan" }], usageRows);
    expect(result.map((s) => `${s.agentId}:${s.suggestedProvider}/${s.suggestedModel}`).sort()).toEqual([
      "asistan:ollama/qwen3:8b",
      "coder:anthropic/claude-haiku-4-5",
    ]);
  });

  it("üç seçenek varsa iki EN İYİYİ karşılaştırır (üçüncü/zayıf seçenek gerekçeye karışmaz)", () => {
    // Laplace skoru (ok+1)/(runs+2): anthropic=(6+1)/8=0.875, google=(3+1)/7=0.571 (fark 0.304
    // ≥ eşik) — ollama en zayıf (0.286) ama karşılaştırma İKİ EN İYİ arasında yapılır, o karışmaz.
    const usageRows = [
      usage({ provider: "ollama", model: "qwen3:8b", runs: 5, ok: 1 }),
      usage({ provider: "anthropic", model: "claude-haiku-4-5", runs: 6, ok: 6 }),
      usage({ provider: "google", model: "gemini-2.5-flash", runs: 5, ok: 3 }),
    ];
    const result = suggestAgentModelUpdates([{ id: "coder" }], usageRows);
    expect(result[0]).toMatchObject({
      suggestedProvider: "anthropic",
      suggestedModel: "claude-haiku-4-5",
      runnerUpProvider: "google",
      runnerUpModel: "gemini-2.5-flash",
    });
  });

  it("boş girdide çökmez", () => {
    expect(suggestAgentModelUpdates([], [])).toEqual([]);
  });
});
