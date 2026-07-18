import { createInterface } from "node:readline/promises";
import { readFileSync, writeFileSync } from "node:fs";
import chalk from "chalk";
import { agentDefinitionFilePath, applyAgentModelPin, getSymphonyPaths } from "@lrgendie/core";
import { connectToDaemon } from "../client/daemon-client.js";

/**
 * `symphony agent-oneri uygula <agentId>` (ADR-018 Karar 8, Faz 8 Dilim D7) — Faz 6'nın açık
 * kalan son maddesi. Öneriler `symphony report`ın ürettiği ("Agent Tanım Önerileri" bölümü)
 * AYNI kaynaktan gelir — ikinci bir hesap YOK, rapor yeniden çekilir ve eşleşen satır bulunur.
 *
 * **`trust.json`/`bekci.json`den FARKLI bir yol:** oradaki komutlar yerel dosyayı doğrudan
 * okur/yazar; burada öneri DAEMON'UN topladığı agregasyondan (agent_runs tablosu) geldiği için
 * önce raporu çekmek GEREKİR — CLI'nin kendi başına bu hesabı YENİDEN üretmesi "ikinci gerçek"
 * olurdu. Uygulama (dosya yazımı) ise yerel — `trust.json` ile aynı ruh: daemon restart YOK
 * (agent tanımları her koşuda dosyadan taze okunur).
 */
export async function agentOneriUygulaCommand(agentId: string): Promise<void> {
  const client = await connectToDaemon();
  let suggestion: { suggestedProvider: string; suggestedModel: string; reason: string } | undefined;
  try {
    const report = await client.getReport();
    suggestion = report.agentSuggestions.find((s) => s.agentId === agentId);
  } finally {
    client.close();
  }

  if (suggestion === undefined) {
    throw new Error(
      `'${agentId}' için açık bir öneri yok — \`symphony report\`ta "Agent Tanım Önerileri" ` +
        "bölümünü kontrol et (öneri yeterli kanıt VE açık bir skor farkı gerektirir).",
    );
  }

  const paths = getSymphonyPaths();
  const file = agentDefinitionFilePath(paths.agentsDir, agentId);
  const raw = readFileSync(file, "utf8");
  const updated = applyAgentModelPin(raw, suggestion.suggestedProvider, suggestion.suggestedModel);

  console.log(chalk.bold(`\n🤖 '${agentId}' agent'ı için öneri:`));
  console.log(`  ${suggestion.reason}`);
  console.log(chalk.dim("  önceki: pin yok — router seçiyor"));
  console.log(chalk.green(`  yeni:   ${suggestion.suggestedProvider}/${suggestion.suggestedModel} (sabit)`));

  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await readline.question("\nuygula? [e/H] ")).trim().toLowerCase();
  readline.close();
  if (answer !== "e") {
    console.log(chalk.yellow("iptal edildi."));
    return;
  }

  writeFileSync(file, updated, "utf8");
  console.log(
    chalk.green(
      `✔ '${agentId}' artık ${suggestion.suggestedProvider}/${suggestion.suggestedModel}'e sabitlendi ` +
        "(sonraki koşudan itibaren geçerli — daemon restart gerekmez).",
    ),
  );
}
