import chalk from "chalk";
import { connectToDaemon } from "../client/daemon-client.js";

const VERDICT_MAP: Record<string, "good" | "bad"> = { iyi: "good", kötü: "bad" };

/**
 * `symphony feedback <runId> iyi|kötü [-n not]` — geçmiş bir agent koşusunu işaretler
 * (ADR-016 Karar 4). TUI'deki tek-tuşluk g/k akışının komut satırı karşılığı; router v2
 * skorlarını besler (`agent/stats.ts` `iyi`/`kötü` sayaçları).
 */
export async function feedbackCommand(
  runId: string,
  deger: string,
  options: { not?: string },
): Promise<void> {
  const verdict = VERDICT_MAP[deger.toLowerCase()];
  if (verdict === undefined) {
    console.error(chalk.red(`⚠ geçersiz değer: '${deger}' — 'iyi' ya da 'kötü' olmalı`));
    process.exit(1);
  }
  const client = await connectToDaemon();
  try {
    await client.request("feedback.submit", {
      subject: "run",
      id: runId,
      verdict,
      ...(options.not !== undefined ? { note: options.not } : {}),
    });
    console.log(chalk.green(`✔ geri bildirim kaydedildi: ${deger}`));
  } finally {
    client.close();
  }
}
