import { join } from "node:path";
import type { ReportResponse } from "@lrgendie/shared";
import { TASK_KIND_LABEL } from "./build.js";

/**
 * Rapor dosya adlandırması + Türkçe markdown biçimlendirmesi (ADR-016 Karar 5).
 *
 * **CLI'den TAŞINDI (Faz 8, Dilim D5):** daemon artık haftalık raporu KENDİLİĞİNDEN yazıyor
 * (`server/daemon.ts`, `scheduleReports`) — bu, `core`'un (daemon'un yaşadığı paket) bu
 * fonksiyonlara ihtiyaç duyduğu anlamına gelir. `shared`→`core`→`cli` tek yönlü bağımlılığı
 * gereği ("Kural" — `CLAUDE.md`) core, cli'ye bağımlı OLAMAZ; bu yüzden taşıma (kopya değil)
 * doğru yön: `cli/commands/report.ts` artık bunları BURADAN import eder.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ISO 8601 hafta etiketi (ör. "2026-W28") — rapor dosya adı için (`~/.symphony/reports/YYYY-Www.md`).
 * SAF: tarih hesabı, dosya sistemine dokunmaz.
 */
export function isoWeekLabel(atMs: number): string {
  const local = new Date(atMs);
  const utc = new Date(Date.UTC(local.getFullYear(), local.getMonth(), local.getDate()));
  const dayNum = (utc.getUTCDay() + 6) % 7; // Pazartesi=0 .. Pazar=6
  utc.setUTCDate(utc.getUTCDate() - dayNum + 3); // haftanın Perşembe'sine kaydır (ISO kuralı)
  const firstThursday = new Date(Date.UTC(utc.getUTCFullYear(), 0, 4));
  const weekNum =
    1 +
    Math.round(
      ((utc.getTime() - firstThursday.getTime()) / DAY_MS - 3 + ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    );
  return `${utc.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/** `~/.symphony/reports/YYYY-Www.md` yolunu hesaplar (yazmaz) — `to` haftası esas alınır. */
export function reportFilePath(reportsDir: string, toMs: number): string {
  return join(reportsDir, `${isoWeekLabel(toMs)}.md`);
}

/**
 * Bu haftanın rapor dosyası zaten var mı → yaz/yazma kararı (Dilim D5). SAF: gerçek `existsSync`
 * yerine bir `exists` fonksiyonu ENJEKTE EDİLİR — daemon'ın açılış/24-saat zamanlayıcısı gerçek
 * dosya sistemine bakar, testler sahte bir `exists` verir (gerçek dosya yazımına gerek kalmaz).
 */
export interface WeeklyReportDecision {
  path: string;
  shouldWrite: boolean;
}

export function decideWeeklyReport(
  reportsDir: string,
  nowMs: number,
  exists: (path: string) => boolean,
): WeeklyReportDecision {
  const path = reportFilePath(reportsDir, nowMs);
  return { path, shouldWrite: !exists(path) };
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

/**
 * Rapor JSON'unu Türkçe markdown'a çevirir (ADR-016 Karar 5) — SAF, dosya/ağ G/Ç yok.
 * Deterministik: aynı `ReportResponse` her zaman aynı metni üretir, LLM YOK.
 */
export function formatReportMarkdown(report: ReportResponse): string {
  const lines: string[] = [
    "# Symphony Kullanım Raporu",
    `**Aralık:** ${fmtDate(report.from)} → ${fmtDate(report.to)}`,
    "",
    "## Toplam",
    `- Girdi token: ${report.totals.inputTokens}`,
    `- Çıktı token: ${report.totals.outputTokens}`,
    `- Maliyet: ${fmtUsd(report.totals.costUsd)}`,
    "",
    "## Model bazında",
  ];
  if (report.usageByModel.length === 0) {
    lines.push("_kayıt yok_");
  } else {
    lines.push("| Model | Girdi | Çıktı | Maliyet |", "|---|---|---|---|");
    for (const row of report.usageByModel) {
      lines.push(`| ${row.key} | ${row.inputTokens} | ${row.outputTokens} | ${fmtUsd(row.costUsd)} |`);
    }
  }

  lines.push("", "## Gün bazında");
  if (report.usageByDay.length === 0) {
    lines.push("_kayıt yok_");
  } else {
    lines.push("| Gün | Girdi | Çıktı | Maliyet |", "|---|---|---|---|");
    for (const row of report.usageByDay) {
      lines.push(`| ${row.key} | ${row.inputTokens} | ${row.outputTokens} | ${fmtUsd(row.costUsd)} |`);
    }
  }

  lines.push("", "## Başarı tablosu (model × görev türü)");
  if (report.successTable.length === 0) {
    lines.push("_kayıt yok_");
  } else {
    lines.push(
      "| Sağlayıcı/Model | Tür | Koşu | Başarı | Ort. maliyet | Ort. süre | Kanıt |",
      "|---|---|---|---|---|---|---|",
    );
    for (const row of report.successTable) {
      const pct = Math.round(row.successRate * 100);
      const turn = row.avgTurnMs !== undefined ? `${(row.avgTurnMs / 1000).toFixed(1)}s` : "—";
      lines.push(
        `| ${row.provider}/${row.model} | ${TASK_KIND_LABEL[row.taskKind] ?? row.taskKind} | ` +
          `${row.runs} | %${pct} | ${fmtUsd(row.avgCostUsd)} | ${turn} | ${row.hasEvidence ? "✓" : "—"} |`,
      );
    }
  }

  lines.push("", "## Sık hatalar");
  if (report.topErrors.length === 0) {
    lines.push("_hata yok_");
  } else {
    lines.push("| Kod | Sayı |", "|---|---|");
    for (const row of report.topErrors) lines.push(`| ${row.code} | ${row.count} |`);
  }

  lines.push(
    "",
    "## Geri bildirim",
    `- İyi: ${report.feedback.good}`,
    `- Kötü: ${report.feedback.bad}`,
    "",
    "## Bulgular",
  );
  if (report.findings.length === 0) {
    lines.push("_eşiği aşan bir bulgu yok_");
  } else {
    for (const finding of report.findings) lines.push(`- ${finding}`);
  }

  // Kendini Geliştirme (ADR-018 Karar 5/6, Dilim D5) — sicil KÜMÜLATİF (rapor aralığıyla sınırlı değil).
  lines.push("", "## Kendini Geliştirme");
  const sd = report.selfDev;
  if (sd.recurring.length === 0) {
    lines.push("_şu an tekrarlayan (teşhis eşiğini aşan) bir hata yok_");
  } else {
    lines.push(
      "_tekrarlayan hatalar:_ " +
        sd.recurring.map((r) => `${r.code} (${r.count})`).join(", "),
    );
  }
  lines.push(
    `- Önerilen: ${sd.proposed} · Uygulanan: ${sd.applied} · Geri alınan: ${sd.reverted} · ` +
      `Başarısız: ${sd.failed} · Reddedilen: ${sd.rejected}`,
  );
  if (sd.categories.length === 0) {
    lines.push("", "_henüz sonuçlanmış bir yama yok_");
  } else {
    lines.push("", "| Kategori | Sağlıklı/Toplam |", "|---|---|");
    for (const cat of sd.categories) {
      const sicil = cat.total > 0 ? `${cat.applied}/${cat.total}` : "—";
      lines.push(`| ${cat.category} | ${sicil} |`);
    }
  }

  // Agent Tanım Önerileri (ADR-018 Karar 8, Dilim D7) — yalnız PİNSİZ agent'lar, yalnız model pinleme.
  lines.push("", "## Agent Tanım Önerileri");
  if (report.agentSuggestions.length === 0) {
    lines.push("_şu an açık bir öneri yok_");
  } else {
    for (const s of report.agentSuggestions) {
      lines.push(`- **${s.agentId}** → \`${s.suggestedProvider}/${s.suggestedModel}\` sabitle: ${s.reason}`);
    }
    lines.push(
      "",
      "_uygulamak için:_ `symphony agent-oneri uygula <agentId>` (onay ister, yalnız model pinini yazar).",
    );
  }
  lines.push("");

  return lines.join("\n");
}
