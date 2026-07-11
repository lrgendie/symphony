import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { CheckRepoActions, simpleGit } from "simple-git";
import { getSymphonyPaths } from "@symphony/core";
import { buildGitignoreContent, planLocalBackup, SYNC_WHITELIST } from "./sync-plan.js";

/**
 * `symphony sync` (ADR-017 Karar 3) — `~/.symphony`'nin BEYAZ LİSTELİ (config/providers/agents/
 * memory/mcp-servers) içeriğini kullanıcının kendi git deposuyla eşitler. Kimlik doğrulama
 * sistemin git credential helper'ına bırakılır — burada yeni bir auth akışı YAZILMAZ.
 */

function existingWhitelistEntries(home: string): string[] {
  return SYNC_WHITELIST.filter((entry) => existsSync(join(home, entry)));
}

function ensureGitignore(home: string): void {
  const gitignorePath = join(home, ".gitignore");
  if (!existsSync(gitignorePath)) {
    writeFileSync(gitignorePath, buildGitignoreContent(), "utf8");
  }
}

/**
 * `symphony sync init <remote-url>` — ilk kurulum ya da yeni makine akışı. Uzakta `main` dalı
 * VARSA (ikinci makine): çakışan yerel beyaz-liste dosyaları `.bak`lanır, uzak checkout edilir.
 * YOKSA (ilk makine): mevcut yerel dosyalar commit'lenip uzağa gönderilir.
 */
export async function syncInitCommand(remoteUrl: string, home?: string): Promise<void> {
  const paths = getSymphonyPaths(home);
  const git = simpleGit(paths.home);

  const alreadyRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
  if (!alreadyRepo) {
    await git.init(false, ["--initial-branch=main"]);
  }

  const remotes = await git.getRemotes();
  if (!remotes.some((r: { name: string }) => r.name === "origin")) {
    await git.addRemote("origin", remoteUrl);
  }

  await git.fetch("origin");
  const branches = await git.branch(["-r"]);
  const hasRemoteMain = branches.all.includes("origin/main");

  if (hasRemoteMain) {
    const existing = existingWhitelistEntries(paths.home);
    const backups = planLocalBackup(paths.home, existing);
    for (const { from, to } of backups) renameSync(from, to);
    await git.checkout(["-B", "main", "origin/main"]);
    const backupNote = backups.length > 0 ? ` (${backups.length} yerel dosya .bak'landı)` : "";
    console.log(chalk.green("✔ uzak yapılandırma indirildi") + backupNote);
  } else {
    ensureGitignore(paths.home);
    const existing = existingWhitelistEntries(paths.home);
    await git.add([...existing, ".gitignore"]);
    const status = await git.status();
    if (status.staged.length > 0) {
      await git.commit("symphony sync: ilk kurulum");
    }
    await git.push(["-u", "origin", "main"]);
    console.log(chalk.green("✔ ilk yapılandırma uzağa gönderildi"));
  }
}

/** `symphony sync` — add(beyaz liste)+commit(varsa) → pull --rebase → push. */
export async function syncCommand(home?: string): Promise<void> {
  const paths = getSymphonyPaths(home);
  const git = simpleGit(paths.home);

  const isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT);
  if (!isRepo) {
    console.error(chalk.yellow("⚠ önce `symphony sync init <uzak-depo-url>` çalıştır."));
    process.exit(1);
  }

  const existing = existingWhitelistEntries(paths.home);
  if (existing.length > 0) await git.add(existing);
  const preRebaseStatus = await git.status();
  if (preRebaseStatus.staged.length > 0) {
    await git.commit("symphony sync: güncelleme");
  }

  try {
    await git.pull(["--rebase"]);
  } catch {
    console.error(
      chalk.red(`⚠ senkron çakıştı — elle çöz: ${paths.home}`) +
        "\n  Çakışan dosyayı düzenleyip `git add <dosya>` + `git rebase --continue` çalıştır, " +
        "sonra `symphony sync`'i tekrar dene.",
    );
    process.exit(1);
  }

  await git.push();
  console.log(chalk.green("✔ senkronlandı"));
}
