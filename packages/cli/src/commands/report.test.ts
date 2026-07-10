import { describe, expect, it } from "vitest";
import { join } from "node:path";
import type { ReportResponse } from "@symphony/shared";
import { formatReportMarkdown, isoWeekLabel, reportFilePath } from "./report.js";

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
