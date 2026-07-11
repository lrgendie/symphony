import { describe, expect, it } from "vitest";
import type { PatchEntry, UsageQueryResult } from "../db/store.js";
import { routerStatsKey, type RouterStats } from "../router/stats.js";
import { buildReport, type ReportInput } from "./build.js";

const emptyUsage: UsageQueryResult = { rows: [], totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };

function baseInput(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    from: 1_000,
    to: 9_000,
    usageByModel: emptyUsage,
    usageByDay: emptyUsage,
    routerStats: new Map(),
    topErrors: [],
    feedback: { good: 0, bad: 0 },
    patches: { recurring: [], entries: [] },
    ...overrides,
  };
}

function patch(overrides: Partial<PatchEntry> = {}): PatchEntry {
  return {
    id: crypto.randomUUID(),
    createdAt: 1_000,
    errorCode: "KOD_A",
    category: "KOD_A",
    branch: "doktor/kod-a",
    files: ["packages/core/src/router/router.ts"],
    diff: "d",
    testOk: true,
    testSummary: "geçti",
    runId: null,
    state: "applied",
    resolvedAt: 2_000,
    ...overrides,
  };
}

describe("buildReport (ADR-016 Karar 5) — SAF, sıfır provider/fetch erişimi", () => {
  it("boş girdide boş rapor + bulgu YOK döner", () => {
    const report = buildReport(baseInput());
    expect(report).toMatchObject({
      from: 1_000,
      to: 9_000,
      totals: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
      usageByModel: [],
      usageByDay: [],
      successTable: [],
      topErrors: [],
      feedback: { good: 0, bad: 0 },
      findings: [],
    });
  });

  it("usageByModel/usageByDay/totals/topErrors/feedback DOĞRUDAN geçirilir (dönüşüm yok)", () => {
    const usageByModel: UsageQueryResult = {
      rows: [{ key: "claude-opus-4-8", inputTokens: 100, outputTokens: 50, costUsd: 0.02 }],
      totals: { inputTokens: 100, outputTokens: 50, costUsd: 0.02 },
    };
    const report = buildReport(
      baseInput({
        usageByModel,
        topErrors: [{ code: "AGENT_TOOL_LOOP", count: 3 }],
        feedback: { good: 2, bad: 1 },
      }),
    );
    expect(report.usageByModel).toEqual(usageByModel.rows);
    expect(report.totals).toEqual(usageByModel.totals);
    expect(report.topErrors).toEqual([{ code: "AGENT_TOOL_LOOP", count: 3 }]);
    expect(report.feedback).toEqual({ good: 2, bad: 1 });
  });

  it("kanıtlı (runs>=MIN_SAMPLES) DÜŞÜK skorlu çift → successTable'da hasEvidence:true VE bulgu üretir", () => {
    const stats: RouterStats = new Map([
      // score = (1+1)/(5+2) = 2/7 ≈ 0.286 < 0.5
      [routerStatsKey("ollama", "qwen3:8b", "code"), { runs: 5, ok: 1, iyi: 0, kötü: 0, avgCostUsd: 0 }],
    ]);
    const report = buildReport(baseInput({ routerStats: stats }));

    expect(report.successTable).toEqual([
      {
        provider: "ollama",
        model: "qwen3:8b",
        taskKind: "code",
        runs: 5,
        successRate: 0.2,
        avgCostUsd: 0,
        hasEvidence: true,
      },
    ]);
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0]).toContain("ollama/qwen3:8b");
    expect(report.findings[0]).toContain("kod işlerinde");
    expect(report.findings[0]).toContain("son 5 koşuda %20 başarı");
  });

  it("kanıtlı YÜKSEK skorlu çift → successTable'da görünür ama BULGU üretmez", () => {
    const stats: RouterStats = new Map([
      [
        routerStatsKey("anthropic", "claude-haiku-4-5", "quick"),
        { runs: 10, ok: 9, iyi: 0, kötü: 0, avgCostUsd: 0.001, avgTurnMs: 1500 },
      ],
    ]);
    const report = buildReport(baseInput({ routerStats: stats }));

    expect(report.successTable[0]).toMatchObject({
      provider: "anthropic",
      model: "claude-haiku-4-5",
      taskKind: "quick",
      runs: 10,
      successRate: 0.9,
      avgTurnMs: 1500,
      hasEvidence: true,
    });
    expect(report.findings).toEqual([]);
  });

  it("MIN_SAMPLES ALTI (kanıtsız) düşük skorlu çift → successTable'da hasEvidence:false, BULGU üretmez (yanıltıcı öneri önlenir)", () => {
    const stats: RouterStats = new Map([
      // score düşük olurdu (0/2) ama runs<MIN_SAMPLES → kanıt YOK sayılır.
      [routerStatsKey("ollama", "qwen3:8b", "general"), { runs: 2, ok: 0, iyi: 0, kötü: 0, avgCostUsd: 0 }],
    ]);
    const report = buildReport(baseInput({ routerStats: stats }));

    expect(report.successTable[0]?.hasEvidence).toBe(false);
    expect(report.findings).toEqual([]);
  });

  it("successTable koşu sayısına göre AZALAN sıralanır", () => {
    const stats: RouterStats = new Map([
      [routerStatsKey("ollama", "az", "general"), { runs: 3, ok: 3, iyi: 0, kötü: 0, avgCostUsd: 0 }],
      [routerStatsKey("ollama", "cok", "general"), { runs: 20, ok: 20, iyi: 0, kötü: 0, avgCostUsd: 0 }],
      [routerStatsKey("ollama", "orta", "general"), { runs: 8, ok: 8, iyi: 0, kötü: 0, avgCostUsd: 0 }],
    ]);
    const report = buildReport(baseInput({ routerStats: stats }));
    expect(report.successTable.map((r) => r.model)).toEqual(["cok", "orta", "az"]);
  });

  it("açık geri bildirim (iyi/kötü) skoru KANITLI hâle getirip bulguya YANSIR", () => {
    // runs=0 ama 3 "kötü" işareti: effRuns=6, effOk=0 → score=(0+1)/(6+2)=0.125 < 0.5.
    // MIN_SAMPLES koşu SAYISINA bakar (runs=0<3) → kanıtsız kalır, bulgu üretilmemeli.
    const stats: RouterStats = new Map([
      [routerStatsKey("ollama", "qwen3:8b", "quick"), { runs: 0, ok: 0, iyi: 0, kötü: 3, avgCostUsd: 0 }],
    ]);
    const report = buildReport(baseInput({ routerStats: stats }));
    expect(report.successTable[0]?.hasEvidence).toBe(false);
    expect(report.findings).toEqual([]);
  });
});

describe("buildReport → selfDev (ADR-018 Karar 5/6, Dilim D5) — kendini geliştirme özeti", () => {
  it("boş girdide sıfır sayaçlar + boş kategori/tekrar listeleri", () => {
    const report = buildReport(baseInput());
    expect(report.selfDev).toEqual({
      recurring: [],
      proposed: 0,
      applied: 0,
      reverted: 0,
      failed: 0,
      rejected: 0,
      categories: [],
    });
  });

  it("recurring (doctor.diagnose() adayları) DOĞRUDAN geçirilir", () => {
    const report = buildReport(
      baseInput({ patches: { recurring: [{ code: "KOD_X", count: 5 }], entries: [] } }),
    );
    expect(report.selfDev.recurring).toEqual([{ code: "KOD_X", count: 5 }]);
  });

  it("durum sayaçları: her state doğru kovaya sayılır", () => {
    const entries = [
      patch({ state: "proposed" }),
      patch({ state: "applied" }),
      patch({ state: "applied" }),
      patch({ state: "reverted" }),
      patch({ state: "failed" }),
      patch({ state: "rejected" }),
    ];
    const report = buildReport(baseInput({ patches: { recurring: [], entries } }));
    expect(report.selfDev).toMatchObject({
      proposed: 1,
      applied: 2,
      reverted: 1,
      failed: 1,
      rejected: 1,
    });
  });

  it("kategori sicili: applied=sağlıklı, reverted/failed=unhealthy, proposed/rejected sicile GİRMEZ", () => {
    const entries = [
      patch({ category: "KOD_A", state: "applied" }),
      patch({ category: "KOD_A", state: "applied" }),
      patch({ category: "KOD_A", state: "reverted" }),
      patch({ category: "KOD_A", state: "proposed" }), // sicile girmemeli
      patch({ category: "KOD_B", state: "failed" }),
    ];
    const report = buildReport(baseInput({ patches: { recurring: [], entries } }));
    expect(report.selfDev.categories).toEqual([
      { category: "KOD_A", applied: 2, unhealthy: 1, total: 3 },
      { category: "KOD_B", applied: 0, unhealthy: 1, total: 1 },
    ]);
  });

  it("kategoriler ALFABETİK sıralanır (deterministik çıktı)", () => {
    const entries = [
      patch({ category: "ZKOD", state: "applied" }),
      patch({ category: "AKOD", state: "applied" }),
    ];
    const report = buildReport(baseInput({ patches: { recurring: [], entries } }));
    expect(report.selfDev.categories.map((c) => c.category)).toEqual(["AKOD", "ZKOD"]);
  });
});
