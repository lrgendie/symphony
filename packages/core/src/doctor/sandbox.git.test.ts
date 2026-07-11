import { afterEach, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { simpleGit } from "simple-git";
import {
  collectAndCommit,
  createSandbox,
  DIAGNOSIS_FILE,
  removeSandbox,
  writeDiagnosis,
  type Sandbox,
} from "./sandbox.js";

/**
 * ADR-018 Karar 2 — GERÇEK git (ağ yok, `pnpm install` KAPALI: sahte repo'da anlamsız ve
 * dakikalar sürer). Burada kanıtlanan şey git mekaniğidir: worktree/dal açılıyor, teşhis
 * dosyası yamaya SIZMIYOR, değişiklikler DALDA COMMIT'leniyor (D3'ün `git merge doktor/<dal>`
 * zinciri bunu gerektirir — agent'ın kendisi commit ATMAZ).
 */

const dirs: string[] = [];
const sandboxes: Array<{ repo: string; sandbox: Sandbox }> = [];

function freshRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "symphony-doktor-repo-"));
  dirs.push(dir);
  execSync("git init -b main", { cwd: dir });
  execSync('git config user.email "test@symphony.local"', { cwd: dir });
  execSync('git config user.name "Symphony Test"', { cwd: dir });
  writeFileSync(join(dir, "kaynak.ts"), "export const x = 1;\n", "utf8");
  execSync("git add -A", { cwd: dir });
  execSync('git commit -m "ilk"', { cwd: dir });
  return dir;
}

afterEach(async () => {
  for (const { repo, sandbox } of sandboxes.splice(0)) {
    try {
      await removeSandbox(repo, sandbox, false);
    } catch {
      // zaten kaldırılmış olabilir
    }
  }
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("doktor sandbox — GERÇEK git", () => {
  it("worktree + dal açar, teşhis dosyasını yazar", async () => {
    const repo = freshRepo();
    const sandbox = await createSandbox(repo, "AGENT_TOOL_LOOP", false);
    sandboxes.push({ repo, sandbox });

    expect(sandbox.branch).toBe("doktor/agent-tool-loop");
    expect(existsSync(join(sandbox.worktreePath, "kaynak.ts"))).toBe(true);

    writeDiagnosis(sandbox.worktreePath, "# teşhis\n");
    expect(readFileSync(join(sandbox.worktreePath, DIAGNOSIS_FILE), "utf8")).toContain("# teşhis");

    const branches = await simpleGit(repo).branchLocal();
    expect(branches.all).toContain("doktor/agent-tool-loop");
  }, 30_000);

  it("collectAndCommit: agent'ın değişikliklerini DALDA commit'ler; teşhis dosyası yamaya GİRMEZ", async () => {
    const repo = freshRepo();
    const sandbox = await createSandbox(repo, "KOD_A", false);
    sandboxes.push({ repo, sandbox });
    writeDiagnosis(sandbox.worktreePath, "# teşhis girdisi\n");

    // "Agent" çalıştı: var olanı düzeltti + yeni bir test dosyası ekledi.
    writeFileSync(join(sandbox.worktreePath, "kaynak.ts"), "export const x = 2;\n", "utf8");
    writeFileSync(join(sandbox.worktreePath, "kaynak.test.ts"), "// yeni test\n", "utf8");

    const collected = await collectAndCommit(sandbox.worktreePath, "KOD_A");

    expect(collected).not.toBeNull();
    expect(collected?.files.sort()).toEqual(["kaynak.test.ts", "kaynak.ts"]);
    // Teşhis dosyası bizim girdimizdi — yamanın parçası OLMAMALI (silinir).
    expect(collected?.files).not.toContain(DIAGNOSIS_FILE);
    expect(existsSync(join(sandbox.worktreePath, DIAGNOSIS_FILE))).toBe(false);
    expect(collected?.diff).toContain("export const x = 2;");

    // D3'ün merge edebilmesi için dalda GERÇEK bir commit olmalı.
    const log = await simpleGit(sandbox.worktreePath).log();
    expect(log.latest?.message).toContain("KOD_A");
  }, 30_000);

  it("agent hiçbir şeyi değiştirmediyse null döner (yama kaydı açılmaz)", async () => {
    const repo = freshRepo();
    const sandbox = await createSandbox(repo, "KOD_B", false);
    sandboxes.push({ repo, sandbox });
    writeDiagnosis(sandbox.worktreePath, "# teşhis\n");

    // Agent yalnız teşhis dosyasını okudu, hiçbir dosyaya dokunmadı.
    expect(await collectAndCommit(sandbox.worktreePath, "KOD_B")).toBeNull();
  }, 30_000);

  it("removeSandbox: worktree kalkar; keepBranch=true ise DAL KORUNUR (D3 onu merge edecek)", async () => {
    const repo = freshRepo();
    const sandbox = await createSandbox(repo, "KOD_C", false);
    writeFileSync(join(sandbox.worktreePath, "kaynak.ts"), "export const x = 3;\n", "utf8");
    await collectAndCommit(sandbox.worktreePath, "KOD_C");

    await removeSandbox(repo, sandbox, true);

    expect(existsSync(sandbox.worktreePath)).toBe(false);
    const branches = await simpleGit(repo).branchLocal();
    expect(branches.all).toContain("doktor/kod-c");
  }, 30_000);

  it("aynı kod için ikinci sandbox, önceki yarım kalmış dalı temizleyip yeniden açar", async () => {
    const repo = freshRepo();
    const first = await createSandbox(repo, "KOD_D", false);
    await removeSandbox(repo, first, true); // dal kalır (yarım kalmış koşu taklidi)

    const second = await createSandbox(repo, "KOD_D", false);
    sandboxes.push({ repo, sandbox: second });

    expect(existsSync(second.worktreePath)).toBe(true);
    expect(second.branch).toBe("doktor/kod-d");
  }, 30_000);
});
