import { existsSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import chalk from "chalk";
import { getSymphonyPaths } from "@lrgendie/core";
import type { ModelInfo } from "@lrgendie/shared";
import { connectToDaemon, type DaemonClient } from "../client/daemon-client.js";

/**
 * `symphony memory` — kullanıcı profili (ADR-013). Yalnız GÖSTERİR; yazma yolu
 * kasıtlı olarak YOK — profil yalnız `symphony memory path`in gösterdiği dosyadan,
 * kullanıcının kendi editörüyle düzenlenir (agent'lar da bu yoldan asla yazamaz).
 */
export async function memoryShowCommand(): Promise<void> {
  const client = await connectToDaemon();
  try {
    const memory = await client.getMemory();
    console.log(chalk.bold("🧠 Kullanıcı profili") + chalk.dim(` · ${memory.chars} karakter`));
    if (memory.truncated) {
      console.log(
        chalk.yellow(
          "⚠ agent bağlamına yalnız ilk kısmı enjekte ediliyor (MAX_PROFILE_CHARS aşıldı)",
        ),
      );
    }
    console.log();
    console.log(memory.content);
    console.log(chalk.dim(`\nDüzenlemek için: symphony memory path`));
  } finally {
    client.close();
  }
}

/** `symphony memory path` — dosya yolunu YAZAR, daemon'a bağlanmaz (kullanıcı kendi editörüyle açsın). */
export function memoryPathCommand(): void {
  console.log(getSymphonyPaths().profileFile);
}

// ---- `symphony memory distill <arşiv-dizini>` (ADR-013 Karar 5, Dilim M3) ----

const DISTILL_CHAR_BUDGET = 6000;
const IGNORE_DIRS = new Set(["node_modules", ".git"]);

/**
 * Arşiv dizinindeki dosyaları en yeniden en eskiye sıralar (SAF, testli). CLI agent'ın
 * kendi glob/read_file araçlarının YERİNE geçmez — yalnız hangi sırayla okunacağını görev
 * metnine yazar; asıl okuma agent'ın kendi araç çağrılarıyla olur (izin/jail/telemetri bedava).
 */
export function listArchiveFilesByRecency(dir: string): string[] {
  const entries: Array<{ rel: string; mtimeMs: number }> = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      const absolute = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        entries.push({
          rel: relative(dir, absolute).split("\\").join("/"),
          mtimeMs: statSync(absolute).mtimeMs,
        });
      }
    }
  };
  walk(dir);
  return entries.sort((a, b) => b.mtimeMs - a.mtimeMs).map((e) => e.rel);
}

/** Görev metni: dizin + okuma önceliği. Çıktı biçimi/kural kuralları agent tanımında (SAF). */
export function buildDistillTask(archiveDir: string, files: string[]): string {
  const list = files.length > 0 ? files.map((f) => `- ${f}`).join("\n") : "(dizin boş)";
  return (
    `${archiveDir} dizinindeki arşivi damıt.\n\n` +
    `Okuma önceliği (en yeniden en eskiye — bu sırayla oku, ${DISTILL_CHAR_BUDGET} karakterlik ` +
    `çıktı bütçesi dolunca durabilirsin, hepsini okumak ZORUNDA değilsin):\n${list}\n\n` +
    `Toplam çıktın ${DISTILL_CHAR_BUDGET} karakteri GEÇMESİN.`
  );
}

/**
 * Gizlilik varsayılanı (ADR-013 Karar 5): arşiv buluta gönderilmez. `--bulut` verilmediyse
 * sistemdeki İLK yerel modeli AÇIKÇA pinler (router'ın "bulut de seçebilir" belirsizliğine
 * güvenmez); hiç yerel model yoksa hata. `--bulut` verildiyse pinlemez, router seçer.
 */
export async function resolveDistillModel(
  client: DaemonClient,
  allowBulut: boolean,
): Promise<{ provider?: string; model?: string }> {
  if (allowBulut) return {};
  const { models } = await client.request("models.list", {});
  const local = models.find((m: ModelInfo) => m.local);
  if (local === undefined) {
    throw new Error(
      "arşiv buluta gönderilmez; sistemde yerel (Ollama) model bulunamadı. " +
        "Bilinçli olarak buluta göndermek için --bulut bayrağını kullan.",
    );
  }
  return { provider: local.provider, model: local.id };
}

/** `agent.start` gönderir, aynı runId'nin `agent.run.completed`/`failed`'ını bekler. */
function runDistillAgent(
  client: DaemonClient,
  cwd: string,
  task: string,
  modelOverride: { provider?: string; model?: string },
): Promise<string> {
  return new Promise((resolveRun, rejectRun) => {
    let runId: string | null = null;
    const mine = (id: string): boolean => runId !== null && id === runId;
    const cleanup = (): void => {
      offCompleted();
      offFailed();
      offTool();
    };
    const offCompleted = client.on("agent.run.completed", (payload) => {
      if (!mine(payload.runId)) return;
      cleanup();
      resolveRun(payload.result);
    });
    const offFailed = client.on("agent.run.failed", (payload) => {
      if (!mine(payload.runId)) return;
      cleanup();
      rejectRun(new Error(`${payload.error.code}: ${payload.error.message}`));
    });
    const offTool = client.on("agent.tool.started", (payload) => {
      if (mine(payload.runId)) console.log(chalk.dim(`  · ${payload.argsSummary}`));
    });
    client
      .request("agent.start", {
        agentId: "damitici",
        task,
        cwd,
        conversational: false,
        ...modelOverride,
      })
      .then((ok) => {
        runId = ok.runId;
      })
      .catch((error: unknown) => {
        cleanup();
        rejectRun(error instanceof Error ? error : new Error(String(error)));
      });
  });
}

/**
 * Taslağı diske yazar; canlı profil dosyasına (`profileFile`) ASLA dokunmaz — ayrı yollar
 * (ADR-013 Karar 2/5: agent'lar canlı profili yazamaz, taslak yalnız insan onayıyla taşınır).
 */
export function writeDistillDraft(result: string): string {
  const draftFile = getSymphonyPaths().profileDraftFile;
  writeFileSync(draftFile, result, "utf8");
  return draftFile;
}

export async function memoryDistillCommand(
  archiveDir: string,
  options: { bulut?: boolean },
): Promise<void> {
  const dir = resolve(archiveDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Dizin yok ya da bir dizin değil: ${dir}`);
  }
  const client = await connectToDaemon();
  try {
    const modelOverride = await resolveDistillModel(client, options.bulut === true);
    const files = listArchiveFilesByRecency(dir);
    console.log(
      chalk.bold("🧪 damıtıcı çalışıyor") + chalk.dim(` — ${dir} (${files.length} dosya)`),
    );
    const task = buildDistillTask(dir, files);
    const result = await runDistillAgent(client, dir, task, modelOverride);
    const draftFile = writeDistillDraft(result);
    console.log(chalk.green(`\n✔ taslak yazıldı: ${draftFile}`));
    console.log(
      chalk.dim(
        "Canlı profil DEĞİŞMEDİ. Taslağı gözden geçir; onaylıyorsan içeriğini " +
          "`symphony memory path`in gösterdiği dosyaya kendin taşı.",
      ),
    );
  } finally {
    client.close();
  }
}
