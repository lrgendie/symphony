import chalk from "chalk";
import type { DaemonClient } from "../client/daemon-client.js";
import { connectToDaemon } from "../client/daemon-client.js";

/**
 * `symphony watch` — daemon olay akışını canlı izler (PROTOKOL §4: olaylar
 * TÜM istemcilere yayınlanır). Başka bir terminaldeki TUI sohbeti burada
 * eş zamanlı akar; terminal ⇄ masaüstü eş zamanlılığının CLI'daki kanıtı.
 * Faz 3'te agent.* olayları da bu akışa katılacak.
 */

/** Olay aboneliklerini kurar; çıktı hedefi test edilebilirlik için enjekte edilir. */
export function attachWatchOutput(client: DaemonClient, write: (text: string) => void): () => void {
  // Aynı oturumun delta'ları tek akış halinde yazılır; araya başka oturum
  // girerse yeni başlık atılır (iki ayrı istemci aynı anda sohbet edebilir).
  let streamingSession: string | null = null;
  const label = (sessionId: string): string => sessionId.slice(0, 8);

  const unsubscribes = [
    client.on("chat.delta", ({ sessionId, text }) => {
      if (streamingSession !== sessionId) {
        streamingSession = sessionId;
        write(chalk.cyan(`\n▶ sohbet ${label(sessionId)}\n`));
      }
      write(text);
    }),
    client.on("chat.completed", ({ sessionId, usage }) => {
      streamingSession = null;
      write(
        `\n${chalk.green("✔")} sohbet ${label(sessionId)} — ` +
          `${usage.inputTokens}+${usage.outputTokens} token · $${usage.costUsd.toFixed(4)}\n`,
      );
    }),
    client.on("usage.updated", ({ provider, model, totals }) => {
      write(
        chalk.dim(
          `  toplam ${provider}/${model}: ${totals.inputTokens + totals.outputTokens} token · $${totals.costUsd.toFixed(4)}\n`,
        ),
      );
    }),
    client.onClientEvent("client:down", () => {
      streamingSession = null;
      write(chalk.red("⚠ daemon bağlantısı koptu — yeniden bağlanılıyor…\n"));
    }),
    client.onClientEvent("client:reconnected", () => {
      write(chalk.green("✔ yeniden bağlandı\n"));
    }),
  ];
  return () => {
    for (const unsubscribe of unsubscribes) unsubscribe();
  };
}

export async function watchCommand(): Promise<void> {
  const client = await connectToDaemon();
  console.log(
    chalk.bold("🎼 olay akışı izleniyor") +
      chalk.dim(" — tüm istemcilerin sohbetleri burada akar (çıkış: Ctrl+C)"),
  );
  attachWatchOutput(client, (text) => process.stdout.write(text));
  await new Promise<void>((resolve) => {
    process.on("SIGINT", () => {
      client.close();
      console.log();
      resolve();
    });
  });
}
