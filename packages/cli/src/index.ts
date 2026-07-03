#!/usr/bin/env node
// symphony CLI — daemon'a bağlanan terminal arayüzü (ROADMAP Faz 2).
import { Command } from "commander";
import { PROTOCOL_VERSION } from "@symphony/shared";
import { modelsCommand } from "./commands/models.js";
import { statusCommand } from "./commands/status.js";
import { watchCommand } from "./commands/watch.js";
import { historyCommand } from "./commands/history.js";
import { agentsCommand } from "./commands/agents.js";
import { agentRunCommand } from "./commands/agent.js";

const program = new Command();

program
  .name("symphony")
  .description(`Symphony — yerel+bulut LLM orkestrasyonu (protokol v${PROTOCOL_VERSION})`)
  .version("0.1.0");

program
  .command("models")
  .description("Tüm sağlayıcıların kullanılabilir modellerini listele")
  .action(wrap(modelsCommand));

program
  .command("status")
  .description("Daemon, sağlayıcı sağlığı ve kullanım özeti")
  .action(wrap(statusCommand));

program
  .command("watch")
  .description("Daemon olay akışını canlı izle (tüm istemcilerin sohbetleri)")
  .action(wrap(watchCommand));

program
  .command("agents")
  .description("Kayıtlı agent tanımlarını listele (~/.symphony/agents)")
  .action(wrap(agentsCommand));

program
  .command("agent <ad> <görev>")
  .description("Agent koşusu başlat: dosya okur/yazar, komut çalıştırır — izinle (Faz 3)")
  .option("--cwd <dizin>", "çalışma alanı (varsayılan: bulunduğun dizin)")
  .option("--model <model>", "model (provider ile birlikte; boşsa router seçer)")
  .option("--provider <sağlayıcı>", "sağlayıcı (model ile birlikte)")
  .action((ad: string, gorev: string, opts: { cwd?: string; model?: string; provider?: string }) =>
    agentRunCommand(ad, gorev, opts).catch(fail),
  );

program
  .command("history [oturum]")
  .description("Sohbet geçmişi: oturum listesi ya da tek oturumun dökümü (id ön eki yeter)")
  .action((oturum?: string) => historyCommand(oturum).catch(fail));

// Argümansız `symphony` → TUI (model seçici + sohbet)
program.action(
  wrap(async () => {
    const { runTui } = await import("./tui/app.js");
    await runTui();
  }),
);

program.parseAsync().catch(fail);

function wrap(action: () => Promise<void>): () => Promise<void> {
  return () => action().catch(fail);
}

function fail(error: unknown): void {
  console.error(`⚠ ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
