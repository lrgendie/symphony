import { resolve } from "node:path";
import { existsSync } from "node:fs";
import chalk from "chalk";
import { CheckRepoActions, simpleGit } from "simple-git";
import { getSymphonyPaths, readBekciRegistry, withBekciProject, writeBekciRegistry } from "@lrgendie/core";

/**
 * Bekçi kayıt defteri komutları (ADR-018 Karar 7, Faz 8 Dilim D6) — `trust.ts`/D4 ile AYNI
 * desen: yerel dosya, protokol mesajı YOK. Daemon `bekci.json`yi kendisi periyodik okur
 * (`symphony bekci ekle`den sonra daemon'ı yeniden başlatmak GEREKMEZ, 10sn içinde görülür).
 */

/**
 * `symphony bekci ekle <ad> <repoPath> <logFile> [--test <komut>]`
 *
 * **Canlı prova bulgusu (2026-07-11):** `repoPath` git repo KÖKÜ değilse, D2'nin `git worktree
 * add`i sessizce dizin ağacında YUKARI arayıp bir ATA dizinin `.git`ini bulur ve worktree'yi
 * ORAYA açar — kullanıcının ev dizini gibi alakasız bir repo'ya yama dalı sızabilir. Bu yüzden
 * kayıt anında `repoPath`'in GERÇEKTEN bir repo KÖKÜ olduğu doğrulanır (üstteki bir repo yeterli
 * SAYILMAZ); değilse net bir hatayla reddedilir — worktree hiç açılana kadar beklenmez.
 */
export async function bekciEkleCommand(
  ad: string,
  repoPath: string,
  logFile: string,
  options: { test?: string },
): Promise<void> {
  const absoluteRepo = resolve(repoPath);
  if (!existsSync(absoluteRepo)) {
    throw new Error(`repo yolu yok: ${absoluteRepo}`);
  }
  const isRepoRoot = await simpleGit(absoluteRepo).checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
  if (!isRepoRoot) {
    throw new Error(
      `'${absoluteRepo}' bir git repo KÖKÜ değil — kendine yama \`git worktree\` gerektirir. ` +
        "Bir ATA dizinin repo olması YETMEZ (worktree yanlış repo'ya açılabilir); " +
        "önce burada `git init` çalıştır ya da gerçek repo kökünü ver.",
    );
  }
  const absoluteLog = resolve(logFile);
  // logFile henüz OLUŞMAMIŞ olabilir (proje henüz hiç çalışmadı) — VAR OLMA şartı yok, bilinçli.

  const paths = getSymphonyPaths();
  const updated = withBekciProject(readBekciRegistry(paths.bekciFile), {
    ad,
    repoPath: absoluteRepo,
    logFile: absoluteLog,
    ...(options.test !== undefined ? { testCommand: options.test } : {}),
  });
  writeBekciRegistry(paths.bekciFile, updated);

  console.log(chalk.green(`✔ '${ad}' bekçi listesine eklendi/güncellendi.`));
  console.log(chalk.dim(`  repo: ${absoluteRepo}`));
  console.log(chalk.dim(`  log:  ${absoluteLog}`));
  if (options.test !== undefined) {
    console.log(chalk.dim(`  test: ${options.test}`));
  } else {
    console.log(
      chalk.yellow(
        "  test: TANIMSIZ — bu proje için doktor yamayı DOĞRULAMADAN, testOk:false ile önerir",
      ),
    );
  }
}

/** `symphony bekci liste` */
export function bekciListeCommand(): void {
  const { projeler } = readBekciRegistry(getSymphonyPaths().bekciFile);
  if (projeler.length === 0) {
    console.log(chalk.dim("kayıtlı proje yok — `symphony bekci ekle <ad> <repo> <log>` ile ekle."));
    return;
  }
  for (const p of projeler) {
    console.log(`${chalk.bold(p.ad)}  ${chalk.dim(p.repoPath)}`);
    const test =
      p.testCommand !== undefined
        ? chalk.dim(`test: ${p.testCommand}`)
        : chalk.yellow("test: TANIMSIZ");
    console.log(`   log: ${p.logFile}  ${test}`);
  }
}
