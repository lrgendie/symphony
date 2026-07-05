import chalk from "chalk";
import { connectToDaemon } from "../client/daemon-client.js";

/**
 * `symphony add <npm-paketi>` — eklenti sistemi (ROADMAP Faz 3, SPEC-AGENT §2.1).
 * v1 kapsamı yalnız npm paketi: `npx -y <paket> [ekstra]` bir MCP sunucusu olarak çalıştırılır.
 * Daemon CANLI bağlanıp `tools/list` yapar (yanlış paket adı hemen görülür) — başarılıysa
 * `~/.symphony/mcp-servers.json`'a kaydeder.
 */
export async function addCommand(
  pkg: string,
  extraArgs: string[],
  options: { name?: string },
): Promise<void> {
  const name = options.name ?? sanitizeName(pkg);
  const client = await connectToDaemon();
  try {
    console.log(chalk.dim(`${pkg} bağlanıyor (npx ile) ve doğrulanıyor…`));
    const result = await client.request("mcp.addServer", {
      name,
      command: "npx",
      args: ["-y", pkg, ...extraArgs],
    });
    console.log(chalk.green(`✔ MCP sunucusu eklendi: `) + chalk.bold(result.name));
    console.log(chalk.dim(`  ${result.tools.length} araç bulundu: ${result.tools.join(", ")}`));
    console.log(
      chalk.dim(`  Bir agent'ta kullanmak için frontmatter'a ekle: mcpServers: [${result.name}]`),
    );
  } finally {
    client.close();
  }
}

function sanitizeName(pkg: string): string {
  return pkg.replace(/^@/, "").replace(/\//g, "-");
}
