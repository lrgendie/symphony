import chalk from "chalk";
import { connectToDaemon } from "../client/daemon-client.js";

/** `symphony models` — tüm sağlayıcıların modellerini listeler. */
export async function modelsCommand(): Promise<void> {
  const client = await connectToDaemon();
  try {
    const { models } = await client.request("models.list", {});
    if (models.length === 0) {
      console.log(chalk.yellow("Hiç model bulunamadı — sağlayıcı yapılandırması eksik olabilir."));
      return;
    }
    let currentProvider = "";
    for (const model of models) {
      if (model.provider !== currentProvider) {
        currentProvider = model.provider;
        console.log(chalk.bold(`\n${currentProvider}`));
      }
      const tag = model.local ? chalk.green("yerel ") : chalk.blue("bulut ");
      const context =
        model.contextWindow !== undefined
          ? chalk.dim(` (${Math.round(model.contextWindow / 1000)}k bağlam)`)
          : "";
      console.log(`  ${tag} ${model.id}${context}`);
    }
    console.log();
  } finally {
    client.close();
  }
}
