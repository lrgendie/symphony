import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { connectToDaemon } from "../client/daemon-client.js";

/**
 * `symphony agent <ad> <görev>` — agent koşusunu başlatır, olayları canlı basar,
 * izin isteklerini terminalden sorar (SPEC-AGENT §5: insan kararı süresiz beklenir).
 * Aynı isteği masaüstü de görür/cevaplayabilir; ilk cevap kazanır.
 */
export async function agentRunCommand(
  agentId: string,
  task: string,
  options: { cwd?: string; model?: string; provider?: string },
): Promise<void> {
  const client = await connectToDaemon();
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  const cwd = resolve(options.cwd ?? process.cwd());

  const exitCode = await new Promise<number>((resolveExit) => {
    let runId: string | null = null;
    // Faz 5 (ADR-014): şef `run_agent` ile çocuk koşular başlatabilir — bunları da "bizim"
    // sayıp (özellikle izin isteklerini) görebilmek/cevaplayabilmek için runId → agentId izler.
    const childAgentIds = new Map<string, string>();
    const mine = (id: string): boolean => runId !== null && (id === runId || childAgentIds.has(id));
    const label = (id: string): string => {
      const agentId = childAgentIds.get(id);
      return agentId !== undefined ? `↳ [${agentId}] ` : "";
    };

    client.on("agent.run.started", (payload) => {
      if (payload.parentRunId === undefined || !mine(payload.parentRunId)) return;
      childAgentIds.set(payload.runId, payload.agentId);
      console.log(chalk.dim(`↳ [${payload.agentId}] koşu ${payload.runId.slice(0, 8)} başladı`));
    });

    client.on("agent.run.state", (payload) => {
      if (!mine(payload.runId)) return;
      if (payload.state === "thinking") {
        process.stdout.write(chalk.dim(`${label(payload.runId)}· düşünüyor…\n`));
      }
      if (payload.state === "cancelled") {
        if (payload.runId === runId) {
          console.log(chalk.yellow("⚠ koşu iptal edildi"));
          resolveExit(130);
        } else {
          console.log(chalk.dim(`${label(payload.runId)}⚠ iptal edildi`));
        }
      }
    });

    client.on("agent.tool.started", (payload) => {
      if (mine(payload.runId)) console.log(chalk.cyan(`${label(payload.runId)}▶ ${payload.argsSummary}`));
    });

    client.on("agent.tool.completed", (payload) => {
      if (!mine(payload.runId)) return;
      const mark = payload.ok ? chalk.green("✔") : chalk.red("✘");
      console.log(`${label(payload.runId)}${mark} ${payload.tool} (${payload.durationMs}ms) ${chalk.dim(payload.resultSummary.split("\n")[0] ?? "")}`);
    });

    client.on("agent.tool.requested", (payload) => {
      if (!mine(payload.runId)) return;
      void (async () => {
        console.log(
          chalk.yellow(`\n${label(payload.runId)}🔐 izin isteği: ${payload.tool}`) +
            chalk.dim(` [risk: ${payload.riskClass}]`),
        );
        console.log(chalk.dim(JSON.stringify(payload.args, null, 2)));
        if (payload.diff !== undefined) console.log(renderDiff(payload.diff));
        // destructive'de "bu koşu boyunca"/"daima" SUNULMAZ (SPEC-AGENT §5).
        const canAlways = payload.riskClass !== "destructive";
        const prompt = canAlways
          ? "[e]vet / [b]u koşu boyunca / [d]aima izin ver / [h]ayır > "
          : "[e]vet / [h]ayır > ";
        const answer = (await readline.question(prompt)).trim().toLowerCase();
        const decision =
          answer === "e" || answer === "evet"
            ? "allow"
            : canAlways && (answer === "b" || answer === "bu koşu")
              ? "allow_for_run"
              : canAlways && (answer === "d" || answer === "daima")
                ? "always_allow"
                : "deny";
        await client.request("permission.respond", { requestId: payload.requestId, decision });
      })().catch((error: unknown) => {
        // Başka istemci bizden önce cevapladıysa PERMISSION_UNKNOWN_REQUEST normaldir.
        console.log(chalk.dim(`izin cevabı gönderilemedi: ${String(error)}`));
      });
    });

    client.on("permission.resolved", (payload) => {
      console.log(chalk.dim(`izin kararı: ${payload.decision} (${payload.resolvedBy ?? "?"})`));
    });

    client.on("agent.run.completed", (payload) => {
      if (!mine(payload.runId)) return;
      if (payload.runId !== runId) {
        // Çocuk koşusu bitti — şef devam ediyor, TÜM işlemi bitirme.
        console.log(chalk.dim(`${label(payload.runId)}✔ tamamlandı`));
        return;
      }
      console.log(chalk.green("\n✔ koşu tamamlandı\n"));
      console.log(payload.result);
      console.log(
        chalk.dim(
          `\n${payload.usage.inputTokens}+${payload.usage.outputTokens} token · $${payload.usage.costUsd.toFixed(4)}`,
        ),
      );
      resolveExit(0);
    });

    client.on("agent.run.failed", (payload) => {
      if (!mine(payload.runId)) return;
      if (payload.runId !== runId) {
        console.log(chalk.dim(`${label(payload.runId)}✘ başarısız: ${payload.error.code}`));
        return;
      }
      console.error(chalk.red(`\n✘ koşu başarısız: ${payload.error.code}`));
      console.error(payload.error.message);
      resolveExit(1);
    });

    process.on("SIGINT", () => {
      if (runId !== null) {
        console.log(chalk.yellow("\niptal isteniyor… (dosya değişiklikleri geri alınmaz)"));
        void client.request("agent.cancel", { runId }).catch(() => resolveExit(130));
      } else {
        resolveExit(130);
      }
    });

    // Router v2 (ADR-016 Karar 2, Dilim Z1): model ELLE verilmediyse ne seçileceğini ÖNCEDEN
    // göster — engine'in pickModel'i AYNI fonksiyon+kanıtla aynı seçimi yapar (determinizm),
    // burası yalnız görünürlük katar. İstek başarısızsa sessizce atla; koşuyu ASLA bloklamaz.
    const announceRouterPick = async (): Promise<void> => {
      if (options.model !== undefined) return;
      try {
        const { suggestions } = await client.request("router.suggest", { task });
        const first = suggestions[0];
        if (first !== undefined) {
          console.log(chalk.dim(`🧭 yönlendirici: ${first.model} — ${first.reason}`));
        }
      } catch {
        // öneri süsü — koşuyu engellemez.
      }
    };

    void announceRouterPick().then(() =>
      client
        .request("agent.start", {
          agentId,
          task,
          cwd,
          ...(options.model !== undefined ? { model: options.model } : {}),
          ...(options.provider !== undefined ? { provider: options.provider } : {}),
        })
        .then((ok) => {
          runId = ok.runId;
          console.log(
            chalk.bold(`🤖 ${agentId} çalışıyor`) + chalk.dim(` — koşu ${ok.runId.slice(0, 8)} · ${cwd}`),
          );
        })
        .catch((error: unknown) => {
          console.error(chalk.red(`✘ ${error instanceof Error ? error.message : String(error)}`));
          resolveExit(1);
        }),
    );
  });

  readline.close();
  client.close();
  process.exit(exitCode);
}

/** Birleşik diff'i +/− renklendirerek basar. */
function renderDiff(diff: string): string {
  return diff
    .split("\n")
    .map((line) =>
      line.startsWith("+") && !line.startsWith("+++")
        ? chalk.green(line)
        : line.startsWith("-") && !line.startsWith("---")
          ? chalk.red(line)
          : chalk.dim(line),
    )
    .join("\n");
}
