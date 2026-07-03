#!/usr/bin/env node
// symphony CLI — daemon'a bağlanan terminal arayüzü (ROADMAP Faz 2).
import { Command } from "commander";
import { PROTOCOL_VERSION } from "@symphony/shared";
import { modelsCommand } from "./commands/models.js";
import { statusCommand } from "./commands/status.js";

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
