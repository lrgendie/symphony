import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { DoctorCandidate } from "@symphony/shared";
import { AgentError } from "../agent/errors.js";
import type { DataStore } from "../db/store.js";
import type { EventBus } from "../server/bus.js";
import { detectRecurring } from "./detect.js";
import {
  DIAGNOSIS_FILE,
  formatDiagnosis,
  REAL_SANDBOX_OPS,
  type Sandbox,
  type SandboxOps,
} from "./sandbox.js";

/**
 * Doktor boru hattı (ADR-018 Karar 1+2+3, Faz 8 Dilim D2) — kendini geliştirmenin orkestrasyonu.
 * Yeni bir motor İNŞA ETMEZ: var olan agent motorunu Symphony'nin KENDİ reposunun bir worktree
 * kopyasına yöneltir. Sıra:
 *
 *   teşhis (deterministik) → sandbox (worktree + install) → teşhis dosyası → agent koşusu
 *   → BORU HATTI doğrulaması (build/test/lint) → dalda commit → yama önerisi (proposed)
 *
 * **Uzun iş:** `run()` sandbox'ı ve agent koşusunu BAŞLATIR ve hemen döner (WS cevabı 30sn'lik
 * istek zaman aşımına takılmasın); geri kalanı arka planda ilerler ve `doctor.phase` /
 * `doctor.patch.proposed` olaylarıyla duyurulur.
 *
 * **Daemon kendini YAMALAMAZ:** boru hattı yalnız ÖNERİ üretir (`state: 'proposed'`); merge/
 * restart/geri alma zinciri CLI'nin denetimli `symphony patch apply` komutundadır (Dilim D3).
 */

export interface DoctorStartRun {
  (input: { agentId: string; task: string; cwd: string }): Promise<{ runId: string }>;
}

export interface DoctorPipelineDeps {
  store: DataStore;
  bus: EventBus;
  log: Logger;
  /** `engine.start`'ın dar yüzeyi — boru hattı motorun tamamını görmez. */
  startRun: DoctorStartRun;
  selfDev: { repoPath?: string; minRecurrence: number; windowDays: number };
  /** Git/alt-süreç yüzeyi; testte sahte verilir (gerçek worktree/pnpm install koşulamaz). */
  ops?: SandboxOps;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const DOCTOR_TASK =
  `Çalışma dizinindeki \`${DIAGNOSIS_FILE}\` dosyasını oku: Symphony'nin kendi hata ` +
  `telemetrisinden üretilmiş, tekrarlayan bir hatanın kayıtlarını içerir. Kök nedeni bul ve ` +
  `ASGARİ yamayı yaz. Kök nedeni bulamazsan hiçbir dosyayı değiştirme ve nedenini açıkla.`;

export class DoctorPipeline {
  /** Aynı anda tek doktor koşusu (worktree/dal çakışmasını ve maliyet patlamasını önler). */
  private busy = false;
  private readonly ops: SandboxOps;

  constructor(private readonly deps: DoctorPipelineDeps) {
    this.ops = deps.ops ?? REAL_SANDBOX_OPS;
  }

  /** Teşhis (ADR-018 Karar 1): deterministik eşik + açık/uygulanmış yaması olan kodların elenmesi. */
  diagnose(): DoctorCandidate[] {
    const { store, selfDev } = this.deps;
    const sinceMs = Date.now() - selfDev.windowDays * DAY_MS;
    const rows = store.topErrorCodesSince(sinceMs);
    return detectRecurring(rows, store.openOrAppliedErrorCodes(), selfDev.minRecurrence);
  }

  /**
   * Boru hattını başlatır. Doğrulama hataları (repo yok / kod bilinmiyor / meşgul) BURADA
   * fırlatılır — istek sahibine `error` olarak döner. Sonrası arka plandadır.
   */
  async run(errorCode: string): Promise<void> {
    if (this.busy) {
      throw new AgentError("AGENT_DOCTOR_BUSY", "Zaten süren bir doktor koşusu var");
    }
    const repoPath = this.deps.selfDev.repoPath ?? this.ops.findRepoRoot();
    if (repoPath === null) {
      throw new AgentError(
        "VALIDATION_SELFDEV_REPO_REQUIRED",
        "Kendine yama yalnız kaynak repo'dan çalışan daemon'da mümkün: " +
          "`~/.symphony/config.json` → `selfDev.repoPath` ile Symphony repo yolunu ver",
      );
    }
    const sinceMs = Date.now() - this.deps.selfDev.windowDays * DAY_MS;
    const rows = this.deps.store.telemetryRowsForCode(errorCode, sinceMs);
    if (rows.length === 0) {
      throw new AgentError(
        "VALIDATION_DOCTOR_CODE_UNKNOWN",
        `Son ${this.deps.selfDev.windowDays} günde '${errorCode}' koduyla telemetri kaydı yok`,
      );
    }

    this.busy = true;
    // Arka plan: çağıranı (WS isteğini) bloklamaz — cevabı hemen döner, ilerleme olaylarla akar.
    void this.execute(repoPath, errorCode, rows.length, rows).finally(() => {
      this.busy = false;
    });
  }

  private phase(
    phase: "sandbox" | "agent" | "verify" | "done" | "failed",
    message: string,
    runId?: string,
  ): void {
    this.deps.bus.broadcast("doctor.phase", {
      phase,
      message,
      ...(runId !== undefined ? { runId } : {}),
    });
  }

  private async execute(
    repoPath: string,
    errorCode: string,
    count: number,
    rows: ReturnType<DataStore["telemetryRowsForCode"]>,
  ): Promise<void> {
    let sandbox: Sandbox | null = null;
    try {
      this.phase("sandbox", `sandbox hazırlanıyor (git worktree + pnpm install) — birkaç dakika sürebilir`);
      sandbox = await this.ops.createSandbox(repoPath, errorCode);
      this.ops.writeDiagnosis(
        sandbox.worktreePath,
        formatDiagnosis(errorCode, count, rows, this.deps.selfDev.windowDays),
      );

      const { runId } = await this.deps.startRun({
        agentId: "doktor",
        task: DOCTOR_TASK,
        cwd: sandbox.worktreePath,
      });
      this.phase("agent", `doktor agent'ı çalışıyor (${errorCode})`, runId);

      const outcome = await this.awaitRun(runId);
      if (!outcome.ok) {
        // Koşu düştü/iptal edildi → yama YAZILMAZ, sandbox tamamen temizlenir (dal dahil).
        await this.cleanup(repoPath, sandbox, false);
        sandbox = null;
        this.phase("failed", `koşu tamamlanmadı (${outcome.reason}) — yama üretilmedi`, runId);
        return;
      }

      const collected = await this.ops.collectAndCommit(sandbox.worktreePath, errorCode);
      if (collected === null) {
        await this.cleanup(repoPath, sandbox, false);
        sandbox = null;
        this.phase("done", "doktor hiçbir dosyayı değiştirmedi — yama önerisi yok", runId);
        return;
      }

      this.phase("verify", `yama doğrulanıyor (pnpm build + test + lint) — birkaç dakika`, runId);
      const verification = await this.ops.runVerification(sandbox.worktreePath);

      const patchId = randomUUID();
      const branch = sandbox.branch;
      this.deps.store.createPatch({
        id: patchId,
        errorCode,
        category: errorCode, // v1: kategori = hata kodu (ADR-018 Karar 5 sicili bunu kullanır)
        branch,
        files: collected.files,
        diff: collected.diff,
        testOk: verification.ok,
        testSummary: verification.summary,
        runId,
      });

      // Worktree'ye artık gerek yok (değişiklikler DALDA commit'li; D3 dalı merge eder) —
      // tmp'de birikmesin. DAL KORUNUR.
      await this.cleanup(repoPath, sandbox, true);
      sandbox = null;

      this.deps.bus.broadcast("doctor.patch.proposed", {
        runId,
        patchId,
        errorCode,
        branch,
        files: collected.files,
        testOk: verification.ok,
        testSummary: verification.summary,
      });
      this.phase(
        "done",
        `yama önerisi kaydedildi (${collected.files.length} dosya, testler ${verification.ok ? "geçti" : "DÜŞTÜ"})`,
        runId,
      );
    } catch (error) {
      this.deps.log.error({ err: error, errorCode }, "doktor boru hattı düştü");
      if (sandbox !== null) {
        await this.cleanup(repoPath, sandbox, false);
      }
      this.phase(
        "failed",
        `boru hattı hatası: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Koşunun bitişini bus üzerinden bekler (motorun iç yapısına dokunmadan). */
  private awaitRun(runId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    return new Promise((resolve) => {
      const unsubscribe = this.deps.bus.observe((type, payload) => {
        const p = payload as { runId?: string; state?: string; error?: { code?: string } };
        if (p.runId !== runId) return;
        if (type === "agent.run.completed") {
          unsubscribe();
          resolve({ ok: true });
        } else if (type === "agent.run.failed") {
          unsubscribe();
          resolve({ ok: false, reason: p.error?.code ?? "AGENT_FAILED" });
        } else if (type === "agent.run.state" && p.state === "cancelled") {
          unsubscribe();
          resolve({ ok: false, reason: "cancelled" });
        }
      });
    });
  }

  private async cleanup(repoPath: string, sandbox: Sandbox, keepBranch: boolean): Promise<void> {
    try {
      await this.ops.removeSandbox(repoPath, sandbox, keepBranch);
    } catch (error) {
      // Temizlik hatası boru hattını düşürmez — worktree kalırsa bir sonraki koşu dalı yeniden kurar.
      this.deps.log.warn({ err: error, worktree: sandbox.worktreePath }, "sandbox temizlenemedi");
    }
  }
}
