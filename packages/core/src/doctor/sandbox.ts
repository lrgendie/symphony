import { existsSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { simpleGit } from "simple-git";
import type { TelemetryEntry } from "../db/store.js";

/**
 * Doktor sandbox'ı (ADR-018 Karar 2, Faz 8 Dilim D2): yama HER ZAMAN ayrı bir git worktree +
 * dalda üretilir — doktor agent'ı `cwd = worktree` ile koşar ve mevcut workspace jail onu
 * oraya HAPSEDER (ana repo ve `~/.symphony` erişilemez; yeni bir güvenlik mekanizması
 * yazılmadı, var olanın bedava kazanımı).
 *
 * **Boru hattı testleri KENDİSİ koşar** — agent'ın "testler geçti" beyanına güvenilmez.
 * **Boru hattı değişiklikleri KENDİSİ commit'ler**: doktor agent yalnız dosyaları düzenler
 * (commit aracı yok); D3'ün `git merge doktor/<dal>` zinciri dalda bir COMMIT olmasını
 * gerektirir — bu yüzden koşu bitince boru hattı `git add -A` + `commit` yapar.
 */

/** Teşhis dosyası: worktree KÖKÜNE yazılır, agent `read_file` ile okur (yeni araç YOK). */
export const DIAGNOSIS_FILE = "DOKTOR-TESHIS.md";

/** Teşhis dosyasına konan telemetri kaydı sayısı — bağlamı doldurmadan örüntüyü göstermeye yeter. */
export const DIAGNOSIS_SAMPLE_LIMIT = 10;

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const VERIFY_TIMEOUT_MS = 20 * 60 * 1000;

/** Hata kodu → dosya/dal adı için güvenli slug (`AGENT_TOOL_LOOP` → `agent-tool-loop`). */
export function slugForCode(code: string): string {
  const slug = code
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "bilinmeyen" : slug;
}

/** Sandbox dalı — D3'ün `patch apply` zinciri bu dalı merge eder. */
export function sandboxBranch(code: string): string {
  return `doktor/${slugForCode(code)}`;
}

/**
 * Repo kökü (SAF-ish: yalnız dosya varlığı sorar): bu modülün konumundan yukarı doğru
 * `pnpm-workspace.yaml` arar. **`node_modules` içinden çağrılıyorsa null döner** — paketlenmiş
 * (npm-global) kurulumda daemon kendi kaynağına sahip DEĞİLDİR; kullanıcının rastgele bir
 * projesini "kendi repom" sanmasın (ADR-018 bilinçli sınırı).
 */
export function findRepoRoot(startDir: string = dirname(fileURLToPath(import.meta.url))): string | null {
  if (startDir.split(sep).includes("node_modules")) return null;
  let dir = startDir;
  for (let i = 0; i < 12; i++) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Teşhis dosyasının içeriği — SAF (dosya G/Ç yok), testli. Agent'a giden TEK veri kanalı budur:
 * telemetri agent'a GELİR, agent telemetriye GİTMEZ (ADR-018 Karar 1 — `~/.symphony`/DB agent'ın
 * araç yüzeyine açılmaz).
 */
export function formatDiagnosis(
  code: string,
  count: number,
  rows: readonly TelemetryEntry[],
  windowDays: number,
): string {
  const lines: string[] = [
    `# Doktor Teşhis Dosyası`,
    "",
    `**Hata kodu:** \`${code}\``,
    `**Son ${windowDays} günde tekrar:** ${count} kez`,
    `**Örnek kayıt sayısı:** ${Math.min(rows.length, DIAGNOSIS_SAMPLE_LIMIT)}`,
    "",
    "Bu dosya Symphony'nin hata telemetrisinden OTOMATİK üretildi. Aşağıdaki kayıtlar",
    "aynı hata kodunun gerçek koşulardaki görünümleridir.",
    "",
    "## Kayıtlar",
  ];

  const samples = rows.slice(0, DIAGNOSIS_SAMPLE_LIMIT);
  if (samples.length === 0) {
    lines.push("", "_kayıt yok_");
  }
  samples.forEach((row, index) => {
    lines.push("", `### ${index + 1}. kayıt — ${new Date(row.at).toISOString()}`, "");
    lines.push(`- **scope:** ${row.scope}`);
    lines.push(`- **mesaj:** ${row.message}`);
    if (row.context !== undefined) {
      lines.push("", "**bağlam:**", "", "```json", JSON.stringify(row.context, null, 2), "```");
    }
    if (row.stack !== undefined) {
      lines.push("", "**stack:**", "", "```", row.stack, "```");
    }
  });
  lines.push("");
  return lines.join("\n");
}

export interface Sandbox {
  worktreePath: string;
  branch: string;
}

/**
 * Sandbox açar: `git worktree add <tmp>/symphony-doktor-<slug> -b doktor/<slug>` (HEAD'den) +
 * worktree'de `pnpm install` (bağımlılıklar worktree'ye kopyalanmaz — kendi node_modules'ü gerekir;
 * izolasyonun kabul edilen bedeli, ADR-018).
 */
export async function createSandbox(
  repoPath: string,
  code: string,
  /** Testte kapatılır: gerçek `pnpm install` dakikalar sürer ve sahte repo'da anlamsızdır. */
  install = true,
): Promise<Sandbox> {
  const branch = sandboxBranch(code);
  const worktreePath = join(tmpdir(), `symphony-doktor-${slugForCode(code)}-${Date.now()}`);
  const git = simpleGit(repoPath);

  // Önceki (yarım kalmış) bir koşudan kalan aynı adlı dal varsa temizle — aksi hâlde
  // `worktree add -b` "branch already exists" ile düşer.
  const branches = await git.branchLocal();
  if (branches.all.includes(branch)) {
    await git.raw(["branch", "-D", branch]);
  }

  await git.raw(["worktree", "add", worktreePath, "-b", branch]);
  if (install) {
    await execa("pnpm", ["install"], {
      cwd: worktreePath,
      timeout: INSTALL_TIMEOUT_MS,
      windowsHide: true,
    });
  }
  return { worktreePath, branch };
}

/** Teşhis dosyasını worktree köküne yazar (agent onu `read_file` ile okuyacak). */
export function writeDiagnosis(worktreePath: string, content: string): void {
  writeFileSync(join(worktreePath, DIAGNOSIS_FILE), content, "utf8");
}

export interface VerificationResult {
  ok: boolean;
  summary: string;
}

/**
 * Doğrulama (ADR-018 Karar 2): `pnpm build && pnpm test && pnpm lint` — BORU HATTI koşar, agent
 * DEĞİL. İlk düşen adımda durur; özet hem başarıda hem hatada kısaltılır (diff'le birlikte DB'ye
 * yazılır, sınırsız çıktı istemiyoruz).
 */
export async function runVerification(worktreePath: string): Promise<VerificationResult> {
  for (const step of ["build", "test", "lint"] as const) {
    try {
      await execa("pnpm", [step], {
        cwd: worktreePath,
        timeout: VERIFY_TIMEOUT_MS,
        windowsHide: true,
        all: true,
      });
    } catch (error) {
      const output = (error as { all?: string; message?: string }).all ?? String(error);
      return { ok: false, summary: `pnpm ${step} DÜŞTÜ:\n${tail(output, 2_000)}` };
    }
  }
  return { ok: true, summary: "pnpm build + test + lint: hepsi geçti" };
}

export interface CollectedPatch {
  files: string[];
  diff: string;
}

/**
 * Agent'ın worktree'de bıraktığı değişiklikleri toplar ve DALDA COMMIT'LER (D3'ün merge'ü için
 * şart). Teşhis dosyası ÖNCE silinir — o bizim yazdığımız geçici bir girdi, yamanın parçası
 * DEĞİLDİR. Hiç değişiklik yoksa `null` döner (yama kaydı açılmaz).
 */
export async function collectAndCommit(
  worktreePath: string,
  code: string,
): Promise<CollectedPatch | null> {
  const diagnosisPath = join(worktreePath, DIAGNOSIS_FILE);
  if (existsSync(diagnosisPath)) rmSync(diagnosisPath, { force: true });

  const git = simpleGit(worktreePath);
  await git.add(["-A"]);
  const files = (await git.raw(["diff", "--cached", "--name-only"]))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  if (files.length === 0) return null;

  const diff = await git.raw(["diff", "--cached"]);
  await git.raw(["commit", "-m", `doktor: ${code} için otomatik yama önerisi`]);
  return { files, diff };
}

/** Sandbox'ı kaldırır. `keepBranch` (yama önerildiyse) dalı bırakır — D3 onu merge edecek. */
export async function removeSandbox(
  repoPath: string,
  sandbox: Sandbox,
  keepBranch: boolean,
): Promise<void> {
  const git = simpleGit(repoPath);
  await git.raw(["worktree", "remove", "--force", sandbox.worktreePath]);
  if (!keepBranch) {
    await git.raw(["branch", "-D", sandbox.branch]);
  }
}

function tail(text: string, max: number): string {
  return text.length <= max ? text : `…${text.slice(text.length - max)}`;
}

/**
 * Boru hattının dış dünyaya (git + alt süreç) açılan TÜM yüzeyi — tek nesnede toplanır ki
 * `DoctorPipeline` testte sahte bir uygulamayla (worktree/install/pnpm olmadan) uçtan uca
 * denenebilsin. Üretimde bu gerçek uygulamalar geçer.
 */
export interface SandboxOps {
  findRepoRoot(): string | null;
  createSandbox(repoPath: string, code: string): Promise<Sandbox>;
  writeDiagnosis(worktreePath: string, content: string): void;
  collectAndCommit(worktreePath: string, code: string): Promise<CollectedPatch | null>;
  runVerification(worktreePath: string): Promise<VerificationResult>;
  removeSandbox(repoPath: string, sandbox: Sandbox, keepBranch: boolean): Promise<void>;
}

export const REAL_SANDBOX_OPS: SandboxOps = {
  findRepoRoot: () => findRepoRoot(),
  createSandbox: (repoPath, code) => createSandbox(repoPath, code),
  writeDiagnosis,
  collectAndCommit,
  runVerification,
  removeSandbox,
};
