import chalk from "chalk";
import { connectToDaemon, ensureDaemonRunning } from "../client/daemon-client.js";

const STATUS_ICON: Record<string, string> = {
  up: chalk.green("●"),
  degraded: chalk.yellow("●"),
  down: chalk.red("●"),
};

/** `symphony status` — daemon + sağlayıcı sağlığı + toplam kullanım. */
export async function statusCommand(): Promise<void> {
  const { started, port } = await ensureDaemonRunning();
  const client = await connectToDaemon();
  try {
    console.log(
      `🎼 symphonyd ${chalk.green("çalışıyor")} — 127.0.0.1:${port}` +
        (started ? chalk.dim(" (bu komut başlattı)") : ""),
    );

    const { providers } = await client.request("providers.status", {});
    console.log(chalk.bold("\nSağlayıcılar"));
    for (const provider of providers) {
      const icon = STATUS_ICON[provider.status] ?? "?";
      console.log(`  ${icon} ${provider.provider} ${chalk.dim(provider.status)}`);
    }

    const { rows, totals } = await client.request("usage.query", { groupBy: "provider" });
    console.log(chalk.bold("\nKullanım (toplam)"));
    if (rows.length === 0) {
      console.log(chalk.dim("  henüz istek kaydı yok"));
    } else {
      for (const row of rows) {
        console.log(
          `  ${row.key}: ${row.inputTokens + row.outputTokens} token, $${row.costUsd.toFixed(4)}`,
        );
      }
      console.log(
        chalk.dim(
          `  toplam: ${totals.inputTokens} giriş + ${totals.outputTokens} çıkış token, $${totals.costUsd.toFixed(4)}`,
        ),
      );
    }
    console.log();
  } finally {
    client.close();
  }
}
