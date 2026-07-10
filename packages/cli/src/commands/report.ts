import { writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import type { ReportResponse } from "@symphony/shared";
import { getSymphonyPaths } from "@symphony/core";
import { connectToDaemon } from "../client/daemon-client.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const TASK_KIND_LABEL: Record<string, string> = {
  code: "kod",
  quick: "hızlı özet",
  longContext: "uzun bağlam",
  general: "genel",
};

/**
 * ISO 8601 hafta etiketi (ör. "2026-W28") — rapor dosya adı için (ADR-016 Karar 5,
 * `~/.symphony/reports/YYYY-Www.md`). SAF: tarih hesabı, dosya sistemine dokunmaz.
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
  lines.push("");

  return lines.join("\n");
}

function parseDateOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`geçersiz --${flag} tarihi: '${value}' (bekleneni: YYYY-AA-GG)`);
  }
  return ms;
}

/** `symphony report [--from --to]` (ADR-016 Karar 5) — vars. son 7 gün (daemon belirler). */
export async function reportCommand(options: { from?: string; to?: string }): Promise<void> {
  const from = parseDateOption(options.from, "from");
  const to = parseDateOption(options.to, "to");
  const client = await connectToDaemon();
  try {
    const report = await client.getReport(from, to);
    const markdown = formatReportMarkdown(report);
    console.log(markdown);

    const paths = getSymphonyPaths();
    const file = reportFilePath(paths.reportsDir, report.to);
    writeFileSync(file, markdown, "utf8");
    console.log(chalk.dim(`(rapor ayrıca yazıldı: ${file})`));
  } finally {
    client.close();
  }
}
