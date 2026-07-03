import chalk from "chalk";
import { connectToDaemon } from "../client/daemon-client.js";

/** `symphony agents` — kayıtlı agent tanımlarını listeler (PROTOKOL §3: agents.list). */
export async function agentsCommand(): Promise<void> {
  const client = await connectToDaemon();
  try {
    const { agents } = await client.request("agents.list", {});
    if (agents.length === 0) {
      console.log("Kayıtlı agent yok. Tanım dosyası: ~/.symphony/agents/<ad>.md");
      return;
    }
    console.log(chalk.bold(`🤖 ${agents.length} agent tanımlı:\n`));
    for (const agent of agents) {
      const model =
        agent.provider !== undefined && agent.model !== undefined
          ? `${agent.provider}/${agent.model}`
          : chalk.dim("router seçer");
      console.log(`  ${chalk.cyan(agent.id.padEnd(12))} ${agent.description}`);
      console.log(
        chalk.dim(`  ${" ".repeat(12)} model: `) +
          model +
          chalk.dim(` · araçlar: ${agent.tools.join(", ")} · maxSteps: ${agent.maxSteps}`),
      );
    }
    console.log(chalk.dim("\nÇalıştır: symphony agent <ad> \"<görev>\""));
  } finally {
    client.close();
  }
}
