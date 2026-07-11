import { writeFileSync } from "node:fs";
import chalk from "chalk";
import { formatReportMarkdown, getSymphonyPaths, reportFilePath } from "@symphony/core";
import { connectToDaemon } from "../client/daemon-client.js";

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
