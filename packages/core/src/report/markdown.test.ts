import { describe, expect, it } from "vitest";
import { join } from "node:path";
import type { ReportResponse } from "@symphony/shared";
import { decideWeeklyReport, formatReportMarkdown, isoWeekLabel, reportFilePath } from "./markdown.js";

/** ADR-016 Karar 5 (Dilim Z3) + ADR-018 Karar 5/6 (Dilim D5) — CLI'den TAŞINDI (core artık
 * daemon içinden haftalık raporu kendiliğinden yazıyor, bkz. `server/daemon.ts`). */

const emptySelfDev: ReportResponse["selfDev"] = {
  recurring: [],
  proposed: 0,
  applied: 0,
  reverted: 0,
  failed: 0,
  rejected: 0,
  categories: [],
};

const sampleReport: ReportResponse = {
  from: Date.UTC(2026, 6, 3),
  to: Date.UTC(2026, 6, 10),
  totals: { inputTokens: 1000, outputTokens: 500, costUsd: 0.05 },
  usageByModel: [{ key: "claude-opus-4-8", inputTokens: 1000, outputTokens: 500, costUsd: 0.05 }],
  usageByDay: [{ key: "2026-07-05", inputTokens: 1000, outputTokens: 500, costUsd: 0.05 }],
  successTable: [
    {
      provider: "ollama",
      model: "qwen3:8b",
      taskKind: "code",
      runs: 5,
      successRate: 0.2,
      avgCostUsd: 0,
      avgTurnMs: 4200,
      hasEvidence: true,
    },
  ],
  topErrors: [{ code: "AGENT_TOOL_LOOP", count: 2 }],
  feedback: { good: 3, bad: 1 },
  findings: ["ollama/qwen3:8b, kod işlerinde son 5 koşuda %20 başarı — düşük güven, farklı bir model denemeyi düşün."],
  selfDev: {
    recurring: [{ code: "INTERNAL_AGENT_ERROR", count: 4 }],
    proposed: 1,
    applied: 2,
    reverted: 1,
    failed: 0,
    rejected: 0,
    categories: [{ category: "AGENT_TOOL_LOOP", applied: 2, unhealthy: 1, total: 3 }],
  },
  agentSuggestions: [
    {
      agentId: "coder",
      suggestedProvider: "anthropic",
      suggestedModel: "claude-sonnet-5",
      suggestedRuns: 8,
      suggestedSuccessRate: 0.9,
      runnerUpProvider: "ollama",
      runnerUpModel: "qwen3:8b",
      runnerUpSuccessRate: 0.4,
      reason: "'coder' agent'ı anthropic/claude-sonnet-5 ile son 8 koşuda %90 başarılı.",
    },
  ],
};

describe("isoWeekLabel — ISO 8601 hafta etiketi (ADR-016 Karar 5)", () => {
  it("bilinen bir tarih için doğru YYYY-Www üretir", () => {
    // 2026-07-10 Cuma → ISO haftası: yılın 28. haftası (bağımsız kaynakla doğrulandı).
    expect(isoWeekLabel(Date.UTC(2026, 6, 10))).toBe("2026-W28");
  });

  it("yıl sınırında (1 Ocak civarı) önceki/sonraki yılın haftasına doğru düşebilir — biçim her zaman YYYY-Www", () => {
    expect(isoWeekLabel(Date.UTC(2026, 0, 1))).toMatch(/^\d{4}-W\d{2}$/);
  });
});

describe("reportFilePath", () => {
  it("reportsDir içinde <isoWeekLabel>.md yolu üretir, DOSYAYA DOKUNMAZ", () => {
    const path = reportFilePath("/home/reports", Date.UTC(2026, 6, 10));
    expect(path).toBe(join("/home/reports", "2026-W28.md"));
  });
});

describe("decideWeeklyReport (Dilim D5) — SAF karar: bu hafta dosyası var mı → yaz/yazma", () => {
  it("dosya YOKSA yaz kararı verir", () => {
    const decision = decideWeeklyReport("/home/reports", Date.UTC(2026, 6, 10), () => false);
    expect(decision).toEqual({ path: join("/home/reports", "2026-W28.md"), shouldWrite: true });
  });

  it("dosya VARSA yazmama kararı verir", () => {
    const decision = decideWeeklyReport("/home/reports", Date.UTC(2026, 6, 10), () => true);
    expect(decision.shouldWrite).toBe(false);
  });

  it("`exists` TAM olarak hesaplanan yolla çağrılır (başka bir dosyaya bakılmaz)", () => {
    let calledWith: string | undefined;
    decideWeeklyReport("/home/reports", Date.UTC(2026, 6, 10), (p) => {
      calledWith = p;
      return false;
    });
    expect(calledWith).toBe(join("/home/reports", "2026-W28.md"));
  });
});

describe("formatReportMarkdown (ADR-016 Karar 5) — SAF, deterministik, LLM YOK", () => {
  const markdown = formatReportMarkdown(sampleReport);

  it("aralığı ve toplamları içerir", () => {
    expect(markdown).toContain("2026-07-03");
    expect(markdown).toContain("2026-07-10");
    expect(markdown).toContain("1000");
    expect(markdown).toContain("$0.0500");
  });

  it("model/gün bazında kullanım tablolarını içerir", () => {
    expect(markdown).toContain("claude-opus-4-8");
    expect(markdown).toContain("2026-07-05");
  });

  it("başarı tablosunu Türkçe görev-türü etiketiyle içerir", () => {
    expect(markdown).toContain("ollama/qwen3:8b");
    expect(markdown).toContain("kod"); // taskKind "code" → Türkçe etiket
    expect(markdown).toContain("%20");
  });

  it("sık hataları ve geri bildirim özetini içerir", () => {
    expect(markdown).toContain("AGENT_TOOL_LOOP");
    expect(markdown).toContain("İyi: 3");
    expect(markdown).toContain("Kötü: 1");
  });

  it("bulgu cümlelerini AYNEN taşır (LLM üretmez, deterministik)", () => {
    expect(markdown).toContain("düşük güven, farklı bir model denemeyi düşün");
  });

  it("Kendini Geliştirme bölümü: tekrarlayan hatalar + sayaçlar + kategori sicili (Dilim D5)", () => {
    expect(markdown).toContain("## Kendini Geliştirme");
    expect(markdown).toContain("INTERNAL_AGENT_ERROR (4)");
    expect(markdown).toContain("Önerilen: 1");
    expect(markdown).toContain("Uygulanan: 2");
    expect(markdown).toContain("Geri alınan: 1");
    expect(markdown).toContain("| AGENT_TOOL_LOOP | 2/3 |");
  });

  it("Kendini Geliştirme boşsa 'yok' mesajları gösterir, boş tablo başlığı ÇIKMAZ", () => {
    const empty = formatReportMarkdown({ ...sampleReport, selfDev: emptySelfDev });
    expect(empty).toContain("_şu an tekrarlayan (teşhis eşiğini aşan) bir hata yok_");
    expect(empty).toContain("_henüz sonuçlanmış bir yama yok_");
  });

  it("Agent Tanım Önerileri bölümü: öneri cümlesi + uygulama komutu (Dilim D7)", () => {
    expect(markdown).toContain("## Agent Tanım Önerileri");
    expect(markdown).toContain("**coder**");
    expect(markdown).toContain("anthropic/claude-sonnet-5");
    expect(markdown).toContain("symphony agent-oneri uygula <agentId>");
  });

  it("Agent Tanım Önerileri boşsa 'yok' mesajı gösterir, uygulama komutu ÖNERİLMEZ", () => {
    const empty = formatReportMarkdown({ ...sampleReport, agentSuggestions: [] });
    expect(empty).toContain("_şu an açık bir öneri yok_");
    expect(empty).not.toContain("agent-oneri uygula");
  });

  it("boş bölümler için 'kayıt yok' / 'bulgu yok' gösterir — tablo başlığı boş dizide çıkmaz", () => {
    const empty = formatReportMarkdown({
      ...sampleReport,
      usageByModel: [],
      usageByDay: [],
      successTable: [],
      topErrors: [],
      findings: [],
    });
    expect(empty).toContain("_kayıt yok_");
    expect(empty).toContain("_hata yok_");
    expect(empty).toContain("_eşiği aşan bir bulgu yok_");
  });

  it("aynı girdi HER ZAMAN aynı çıktıyı üretir (deterministik — LLM YOK)", () => {
    expect(formatReportMarkdown(sampleReport)).toBe(formatReportMarkdown(sampleReport));
  });
});
