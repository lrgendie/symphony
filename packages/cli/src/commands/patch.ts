import { createInterface } from "node:readline/promises";
import chalk from "chalk";
import { execa } from "execa";
import { simpleGit } from "simple-git";
import type { PatchSummary } from "@symphony/shared";
import { findRepoRoot, getSymphonyPaths, loadConfig } from "@symphony/core";
import { protectedMatches } from "@symphony/core";
import { connectToDaemon, ensureDaemonRunning, type DaemonClient } from "../client/daemon-client.js";
import { shutdownDaemonIfRunning } from "./update.js";

/**
 * Yamayı CANLIYA ALMA ve WATCHDOG (ADR-018 Karar 3+4, Faz 8 Dilim D3).
 *
 * **Zincir (`symphony patch apply`):** ön koşullar → onay → `git merge --no-ff` → `pnpm build`
 * → `pnpm test` → daemon'ı kapat → yeni kodla başlat → SAĞLIK → başarısızsa **GERİ AL**.
 *
 * **Neden CLI'de, daemon'da değil:** daemon merge sonrası kendini yeniden başlatamaz — kendi
 * bacağını kesmiş olur (ADR-018 Karar 3). Daemon yalnız sonucu yazar (`patch.resolve`).
 *
 * **Watchdog ayrı bir süreç DEĞİL:** ROADMAP'in "bozuk sürüm otomatik geri alınır" maddesinin
 * karşılığı bu zincirin kendisidir — testler düşerse ya da yeni daemon ayağa kalkmazsa merge
 * geri alınır, `dist` yeniden derlenir ve ESKİ kodla yeniden başlatılır.
 */

const VERIFY_TIMEOUT_MS = 20 * 60 * 1000;
const DAEMON_DOWN_TIMEOUT_MS = 15_000;

/** Kısaltılmış id ile eşleşen tek yama (ön ek yeter — `history` deseni). */
function findPatch(patches: PatchSummary[], idPrefix: string): PatchSummary {
  const matches = patches.filter((p) => p.id.startsWith(idPrefix));
  if (matches.length === 0) throw new Error(`Yama bulunamadı: ${idPrefix}`);
  if (matches.length > 1) throw new Error(`Belirsiz id (${matches.length} eşleşme): ${idPrefix}`);
  return matches[0] as PatchSummary;
}

function resolveRepoPath(): string {
  const configured = loadConfig(getSymphonyPaths()).selfDev.repoPath;
  const repoPath = configured ?? findRepoRoot();
  if (repoPath === null) {
    throw new Error(
      "Symphony repo yolu bulunamadı — kendine yama yalnız kaynak repo'da mümkün. " +
        "`~/.symphony/config.json` → `selfDev.repoPath` ile ver.",
    );
  }
  return repoPath;
}

function fmtState(state: PatchSummary["state"]): string {
  const paint =
    state === "applied"
      ? chalk.green
      : state === "proposed"
        ? chalk.yellow
        : state === "reverted" || state === "failed"
          ? chalk.red
          : chalk.dim;
  return paint(state);
}

/** `symphony patches` — yama önerilerini listeler. */
export async function patchesCommand(): Promise<void> {
  const client = await connectToDaemon();
  try {
    const { patches } = await client.request("patches.list", {});
    if (patches.length === 0) {
      console.log(chalk.dim("yama önerisi yok — `symphony doctor` ile üret."));
      return;
    }
    for (const p of patches) {
      const tests = p.testOk ? chalk.green("test ✔") : chalk.red("test ✘");
      const korumali = protectedMatches(p.files).length > 0 ? chalk.red(" [KORUMALI]") : "";
      console.log(
        `${chalk.bold(p.id.slice(0, 8))}  ${fmtState(p.state).padEnd(18)} ${tests}  ` +
          `${p.errorCode}  ${chalk.dim(`${p.files.length} dosya`)}${korumali}`,
      );
    }
  } finally {
    client.close();
  }
}

/** `symphony patch reject <id>` — öneriyi reddeder ve dalı siler (worktree D2'de zaten kalktı). */
export async function patchRejectCommand(idPrefix: string): Promise<void> {
  const client = await connectToDaemon();
  try {
    const { patches } = await client.request("patches.list", {});
    const patch = findPatch(patches, idPrefix);
    await client.request("patch.resolve", { patchId: patch.id, state: "rejected" });
    await simpleGit(resolveRepoPath())
      .raw(["branch", "-D", patch.branch])
      .catch(() => undefined); // dal zaten yoksa sorun değil
    console.log(chalk.green(`✔ yama reddedildi: ${patch.id.slice(0, 8)} (dal silindi)`));
  } finally {
    client.close();
  }
}

/**
 * `symphony patch apply <id>` — DENETİMLİ canlıya alma.
 * `--evet` yalnız SIRADAN yamalarda onayı atlar; KORUMALI yollara dokunan yamada onay
 * ATLANMAZ (ADR-018 Karar 4 — değişmezler hiçbir bayrakla otomatikleşemez).
 */
export async function patchApplyCommand(idPrefix: string, options: { evet?: boolean }): Promise<void> {
  const repoPath = resolveRepoPath();
  const git = simpleGit(repoPath);

  let client: DaemonClient = await connectToDaemon();
  const { patches } = await client.request("patches.list", {});
  const patch = findPatch(patches, idPrefix);

  // ---- Ön koşullar ----
  if (patch.state !== "proposed") {
    client.close();
    throw new Error(`Yama '${patch.state}' durumunda — yalnız 'proposed' uygulanabilir.`);
  }
  // KRİTİK: kirli bir ağaca merge, kullanıcının KAYDEDİLMEMİŞ işini mahveder.
  const status = await git.status();
  if (!status.isClean()) {
    client.close();
    throw new Error(
      `Repo temiz değil (${status.files.length} değişiklik) — yama uygulanmadan önce ` +
        `kendi değişikliklerini commit'le ya da stash'le: ${repoPath}`,
    );
  }
  const branches = await git.branchLocal();
  if (!branches.all.includes(patch.branch)) {
    client.close();
    throw new Error(`Yama dalı yok: ${patch.branch} (silinmiş olabilir)`);
  }

  // ---- Özet + onay ----
  console.log(chalk.bold(`\n🩹 yama ${patch.id.slice(0, 8)} — ${patch.errorCode}`));
  console.log(`   dal:     ${patch.branch}`);
  console.log(`   dosya:   ${patch.files.join(", ")}`);
  console.log(`   testler: ${patch.testOk ? chalk.green("GEÇTİ") : chalk.red("DÜŞTÜ")} ${chalk.dim(patch.testSummary.split("\n")[0] ?? "")}`);

  const korumali = protectedMatches(patch.files);
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    if (korumali.length > 0) {
      // DEĞİŞMEZLER (ADR-018 Karar 4): --evet BURADA GEÇMEZ.
      console.log(
        chalk.red.bold("\n⛔ BU YAMA KORUMALI YOLLARA DOKUNUYOR (değişmezler):") +
          `\n   ${korumali.join("\n   ")}` +
          chalk.dim("\n   (izin sistemi / güncelleyici / anahtarlar / token / bu listenin kendisi)") +
          chalk.red("\n   Bunlar hiçbir güven kaydıyla otomatik uygulanamaz.\n"),
      );
      const answer = (await readline.question('Uygulamak için tam olarak "EVET" yaz: ')).trim();
      if (answer !== "EVET") {
        client.close();
        console.log(chalk.yellow("iptal edildi."));
        return;
      }
    } else if (!patch.testOk) {
      console.log(chalk.red("\n⚠ sandbox testleri DÜŞTÜ — bu yama büyük olasılıkla main'de de düşecek."));
      const answer = (await readline.question("yine de dene? [e/H] ")).trim().toLowerCase();
      if (answer !== "e") {
        client.close();
        console.log(chalk.yellow("iptal edildi."));
        return;
      }
    } else if (options.evet !== true) {
      const answer = (await readline.question("\nuygula? [e/H] ")).trim().toLowerCase();
      if (answer !== "e") {
        client.close();
        console.log(chalk.yellow("iptal edildi."));
        return;
      }
    }
  } finally {
    readline.close();
  }

  // ---- Zincir ----
  const baseSha = (await git.revparse(["HEAD"])).trim();

  /**
   * GERİ ALMA. `pnpm build`i TEKRAR koşmak ŞART: merge sonrası build, YAMALI kodu `dist`e
   * yazmıştır — reset'ledikten sonra yeniden derlemezsek daemon bir sonraki açılışta BOZUK
   * dist'i yükler (sessiz felaket).
   */
  const geriAl = async (): Promise<void> => {
    console.log(chalk.yellow(`↩ geri alınıyor (${baseSha.slice(0, 8)})…`));
    await git.raw(["reset", "--hard", baseSha]);
    await execa("pnpm", ["build"], { cwd: repoPath, timeout: VERIFY_TIMEOUT_MS, windowsHide: true }).catch(
      () => undefined,
    );
  };

  const resolveState = async (state: PatchSummary["state"]): Promise<void> => {
    try {
      await client.request("patch.resolve", { patchId: patch.id, state });
    } catch (error) {
      console.error(chalk.red(`⚠ yama durumu (${state}) kaydedilemedi: ${String(error)}`));
    }
  };

  console.log(chalk.dim(`\n▶ merge ${patch.branch} → HEAD`));
  await git.raw(["merge", "--no-ff", patch.branch, "-m", `doktor yaması: ${patch.errorCode} (${patch.id.slice(0, 8)})`]);

  // build+test ANA DALDA koşar — sandbox yeşili merge SONRASI dünyayı kanıtlamaz.
  for (const step of ["build", "test"] as const) {
    console.log(chalk.dim(`▶ pnpm ${step} (ana dalda)`));
    try {
      await execa("pnpm", [step], { cwd: repoPath, timeout: VERIFY_TIMEOUT_MS, windowsHide: true });
    } catch {
      console.error(chalk.red(`\n✘ pnpm ${step} DÜŞTÜ — yama canlıya ALINMADI.`));
      await geriAl();
      await resolveState("failed");
      client.close();
      process.exit(1);
    }
  }

  // ---- Canlıya alma: daemon'ı yeni kodla yeniden başlat ----
  console.log(chalk.dim("▶ daemon yeniden başlatılıyor (yeni kod)"));
  client.close();
  await shutdownDaemonIfRunning();
  await waitUntilDown();

  try {
    await ensureDaemonRunning(); // sağlık yoklaması İÇİNDE: kalkmazsa fırlatır
  } catch {
    // WATCHDOG: yeni kod ayağa kalkmadı → geri al, ESKİ kodla yeniden başlat.
    console.error(chalk.red("\n✘ yeni daemon AYAĞA KALKMADI — yama geri alınıyor."));
    await geriAl();
    await ensureDaemonRunning().catch(() => undefined);
    client = await connectToDaemon();
    await resolveState("reverted");
    client.close();
    console.error(chalk.yellow("↩ eski sürüme dönüldü (yama: reverted)."));
    process.exit(1);
  }

  client = await connectToDaemon();
  await resolveState("applied");
  await git.raw(["branch", "-d", patch.branch]).catch(() => undefined);
  client.close();
  console.log(chalk.green(`\n✔ yama uygulandı ve daemon yeni kodla çalışıyor (${patch.id.slice(0, 8)})`));
}

/** Kapanışı DOĞRULA: eski daemon hâlâ ayaktaysa `ensureDaemonRunning` onu "sağlıklı" sanardı. */
async function waitUntilDown(): Promise<void> {
  const port = loadConfig(getSymphonyPaths()).daemon.port;
  const deadline = Date.now() + DAEMON_DOWN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1_000) });
    } catch {
      return; // cevap vermiyor = kapandı
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error("Daemon kapanmadı — yama uygulanamaz (elle durdurup tekrar dene).");
}
