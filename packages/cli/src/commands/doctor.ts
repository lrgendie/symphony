import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { getSymphonyPaths, isTrusted, readTrust, touchesProtected } from "@lrgendie/core";
import { connectToDaemon, type DaemonClient } from "../client/daemon-client.js";
import { renderDiff } from "./agent.js";
import { patchApplyCommand } from "./patch.js";

/**
 * `symphony doctor [--kod <HATA_KODU>] [--proje <AD>]` (ADR-018, Faz 8 Dilim D2+D6) — kendini
 * geliştirme döngüsünün insan tetikleyicisi:
 *   1. `--proje` yoksa: `doctor.diagnose` → tekrarlayan hata adayları (deterministik eşik).
 *      `--proje <AD>` verilmişse bu adım ATLANIR — kullanıcı zaten hangi projeyi kastettiğini
 *      biliyor (ADR-018 Karar 7, bekçi modu: AYNI boru hattı, farklı repo/doğrulama).
 *   2. `doctor.run` → sandbox (git worktree) + doktor agent koşusu + BORU HATTI doğrulaması.
 *   3. Sonuç bir YAMA ÖNERİSİ'dir — uygulanmaz (kategori GÜVENİLİR değilse). Uygulama
 *      `symphony patch apply` ile (Dilim D3) ya da güven merdiveniyle otomatik (Dilim D4).
 *
 * Koşu izin isteklerini normal agent koşusu gibi terminalden sorar (doktor ayrıcalıklı bir mod
 * DEĞİL, bir agent tanımıdır — SPEC-AGENT §5 aynen geçerli).
 */
export async function doctorCommand(options: { kod?: string; proje?: string }): Promise<void> {
  const client = await connectToDaemon();

  if (options.proje !== undefined) {
    console.log(chalk.bold(`🩺 bekçi modu: proje '${options.proje}'`));
    const exitCode = await watchDoctorRun(client, { proje: options.proje });
    client.close();
    process.exit(exitCode);
    return;
  }

  const { candidates } = await client.request("doctor.diagnose", {});
  if (candidates.length === 0) {
    console.log(chalk.green("✔ tekrarlayan hata yok — doktora iş düşmüyor."));
    client.close();
    return;
  }

  console.log(chalk.bold("🩺 tekrarlayan hatalar:"));
  for (const candidate of candidates) {
    console.log(`  ${chalk.red(candidate.code)} ${chalk.dim(`— ${candidate.count} kez`)}`);
  }
  console.log("");

  const chosen = options.kod ?? candidates[0]?.code;
  if (chosen === undefined) {
    client.close();
    return;
  }
  if (options.kod === undefined && candidates.length > 1) {
    console.log(
      chalk.dim(`en sık tekrarlayan seçildi: ${chosen} (başkası için: --kod <HATA_KODU>)\n`),
    );
  }

  console.log(chalk.bold(`🩺 doktor başlatılıyor: ${chosen}`));
  const exitCode = await watchDoctorRun(client, { errorCode: chosen });
  client.close();
  process.exit(exitCode);
}

/**
 * Boru hattını başlatır + tüm ilerlemesini/izin isteklerini/sonucunu izler — kendine-yama VE
 * bekçi modu (`--proje`) AYNI izleyiciyi paylaşır (Karar 7: "kod tekrarı değil, parametre
 * değişimi"). `request` doğrudan `doctor.run`a geçer.
 */
async function watchDoctorRun(
  client: DaemonClient,
  request: { errorCode?: string; proje?: string },
): Promise<number> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });

  const exitCode = await new Promise<number>((resolveExit) => {
    let runId: string | null = null;
    const mine = (id: string | undefined): boolean => id !== undefined && id === runId;

    client.on("doctor.phase", (payload) => {
      if (payload.runId !== undefined) runId = payload.runId;
      const tone =
        payload.phase === "failed"
          ? chalk.red
          : payload.phase === "done"
            ? chalk.green
            : chalk.dim;
      console.log(tone(`· ${payload.message}`));
      if (payload.phase === "failed") resolveExit(1);
    });

    client.on("agent.run.state", (payload) => {
      if (mine(payload.runId) && payload.state === "thinking") {
        console.log(chalk.dim("· düşünüyor…"));
      }
    });

    client.on("agent.tool.started", (payload) => {
      if (mine(payload.runId)) console.log(chalk.cyan(`▶ ${payload.argsSummary}`));
    });

    client.on("agent.tool.completed", (payload) => {
      if (!mine(payload.runId)) return;
      const mark = payload.ok ? chalk.green("✔") : chalk.red("✘");
      console.log(`${mark} ${payload.tool} (${payload.durationMs}ms)`);
    });

    client.on("agent.tool.requested", (payload) => {
      if (!mine(payload.runId)) return;
      void (async () => {
        console.log(
          chalk.yellow(`\n🔐 izin isteği: ${payload.tool}`) + chalk.dim(` [risk: ${payload.riskClass}]`),
        );
        console.log(chalk.dim(JSON.stringify(payload.args, null, 2)));
        if (payload.diff !== undefined) console.log(renderDiff(payload.diff));
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
        console.log(chalk.dim(`izin cevabı gönderilemedi: ${String(error)}`));
      });
    });

    client.on("agent.run.completed", (payload) => {
      if (!mine(payload.runId)) return;
      console.log(chalk.green("\n✔ doktor koşusu tamamlandı — yama doğrulanıyor…\n"));
      console.log(payload.result);
    });

    client.on("agent.run.failed", (payload) => {
      if (!mine(payload.runId)) return;
      console.error(chalk.red(`\n✘ doktor koşusu başarısız: ${payload.error.code}`));
      console.error(payload.error.message);
      // Boru hattı `doctor.phase failed` da yayınlar; çıkışı ORASI verir (sandbox temizliğinden sonra).
    });

    client.on("doctor.patch.proposed", (payload) => {
      console.log(chalk.bold(`\n🩹 yama önerisi: ${payload.patchId.slice(0, 8)}`));
      console.log(`  hata:    ${payload.errorCode}`);
      console.log(`  dal:     ${payload.branch}`);
      console.log(`  dosya:   ${payload.files.join(", ")}`);
      console.log(
        `  testler: ${payload.testOk ? chalk.green("GEÇTİ") : chalk.red("DÜŞTÜ")} ${chalk.dim(
          `— ${payload.testSummary.split("\n")[0] ?? ""}`,
        )}`,
      );

      // Güven merdiveni (ADR-018 Karar 5, Dilim D4): kategori GÜVENİLİR + test yeşili + korumalı
      // yol YOK ise, insan `symphony doctor`u zaten başlattığı için ayrıca SORMADAN uygula —
      // aynı süreç içinde, ayrı bir `symphony patch apply` çağrısı gerekmez.
      // v1 (D2 pipeline.ts): kategori = hata kodu.
      const trust = readTrust(getSymphonyPaths().trustFile);
      const autoApply = payload.testOk && isTrusted(trust, payload.errorCode) && !touchesProtected(payload.files);

      if (!autoApply) {
        console.log(
          chalk.dim(
            `\nyama UYGULANMADI (öneri olarak kaydedildi). ` +
              `Uygulamak için: symphony patch apply ${payload.patchId.slice(0, 8)}`,
          ),
        );
        resolveExit(payload.testOk ? 0 : 1);
        return;
      }

      console.log(
        chalk.green(`\n✔ kategori GÜVENİLİR (${payload.errorCode}) — sormadan uygulanıyor…`),
      );
      patchApplyCommand(payload.patchId, { evet: true }).then(
        () => resolveExit(0),
        (error: unknown) => {
          console.error(chalk.red(`✘ otomatik uygulama başarısız: ${String(error)}`));
          resolveExit(1);
        },
      );
    });

    process.on("SIGINT", () => {
      if (runId !== null) {
        console.log(chalk.yellow("\niptal isteniyor…"));
        void client.request("agent.cancel", { runId }).catch(() => resolveExit(130));
      } else {
        resolveExit(130);
      }
    });

    client.request("doctor.run", request).catch((error: unknown) => {
      console.error(chalk.red(`✘ ${error instanceof Error ? error.message : String(error)}`));
      resolveExit(1);
    });
  });

  readline.close();
  return exitCode;
}
