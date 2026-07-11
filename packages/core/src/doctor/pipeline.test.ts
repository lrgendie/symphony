import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pino } from "pino";
import type { MessageType } from "@symphony/shared";
import { DataStore } from "../db/store.js";
import { EventBus } from "../server/bus.js";
import { DoctorPipeline } from "./pipeline.js";
import type { SandboxOps } from "./sandbox.js";

/**
 * ADR-018 Karar 2+3 — boru hattı ORKESTRASYONU: git/pnpm yüzeyi (`SandboxOps`) sahtelenir,
 * gerçek olan her şey (store, bus, olay sırası, yama kaydı) gerçektir. Burada kanıtlanan:
 * koşu bitişini bekleme, `test_ok`un BORU HATTININ ölçümü olması (agent beyanı değil),
 * başarısız/değişiklik-yok yollarında yama YAZILMAMASI ve sandbox'ın temizlenmesi.
 */

let dir: string;
let store: DataStore;
const log = pino({ level: "silent" });

function openStore(): DataStore {
  dir = mkdtempSync(join(tmpdir(), "symphony-doktor-pipeline-"));
  store = new DataStore(join(dir, "symphony.db"));
  return store;
}

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const SANDBOX = { worktreePath: "/tmp/sahte-worktree", branch: "doktor/kod" };

function fakeOps(overrides: Partial<SandboxOps> = {}): SandboxOps {
  return {
    findRepoRoot: () => "/repo",
    createSandbox: vi.fn(async () => SANDBOX),
    writeDiagnosis: vi.fn(),
    collectAndCommit: vi.fn(async () => ({ files: ["a.ts"], diff: "--- a\n+++ b\n" })),
    runVerification: vi.fn(async () => ({ ok: true, summary: "hepsi geçti" })),
    removeSandbox: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Olayları toplayan gerçek EventBus (WS istemcisi yok — `observe` yüzeyi test edilir). */
function busWithLog(): { bus: EventBus; events: Array<{ type: MessageType; payload: unknown }> } {
  const bus = new EventBus();
  const events: Array<{ type: MessageType; payload: unknown }> = [];
  bus.observe((type, payload) => events.push({ type, payload }));
  return { bus, events };
}

function seedTelemetry(code: string, times: number): void {
  for (let i = 0; i < times; i++) {
    store.recordTelemetry({ scope: "agent", code, message: `hata ${i}` });
  }
}

const selfDev = { minRecurrence: 3, windowDays: 7, repoPath: "/repo" };

/** Boru hattı `agent.run.completed` bekler — sahte motor onu bus'a yayınlar. */
function startRunEmitting(bus: EventBus, outcome: "completed" | "failed"): {
  startRun: (input: { agentId: string; task: string; cwd: string }) => Promise<{ runId: string }>;
  calls: Array<{ agentId: string; cwd: string }>;
} {
  const calls: Array<{ agentId: string; cwd: string }> = [];
  const startRun = async (input: { agentId: string; task: string; cwd: string }) => {
    calls.push({ agentId: input.agentId, cwd: input.cwd });
    const runId = crypto.randomUUID();
    // Motor gerçekte asenkron biter — boru hattının abone OLDUKTAN sonra olayı görmesi gerekir.
    setTimeout(() => {
      if (outcome === "completed") {
        bus.broadcast("agent.run.completed", {
          runId,
          result: "kök neden bulundu",
          usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
        });
      } else {
        bus.broadcast("agent.run.failed", {
          runId,
          error: { code: "AGENT_MAX_STEPS", message: "döngü" },
        });
      }
    }, 5);
    return { runId };
  };
  return { startRun, calls };
}

/** `doctor.patch.proposed` ya da `doctor.phase(done|failed)` gelene dek bekler. */
async function waitForSettle(events: Array<{ type: MessageType; payload: unknown }>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const done = events.some(
      (e) =>
        e.type === "doctor.patch.proposed" ||
        (e.type === "doctor.phase" &&
          ["done", "failed"].includes((e.payload as { phase: string }).phase)),
    );
    if (done) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("boru hattı sonuçlanmadı");
}

describe("DoctorPipeline.diagnose (ADR-018 Karar 1)", () => {
  it("eşiği aşan kodları döner; açık yaması olan kod ELENİR", () => {
    openStore();
    seedTelemetry("SIK_HATA", 5);
    seedTelemetry("AZ_HATA", 2);
    const { bus } = busWithLog();
    const pipeline = new DoctorPipeline({
      store,
      bus,
      log,
      startRun: async () => ({ runId: crypto.randomUUID() }),
      selfDev,
      ops: fakeOps(),
    });

    expect(pipeline.diagnose()).toEqual([{ code: "SIK_HATA", count: 5 }]);

    // Aynı kod için açık bir öneri varsa aday olmaktan çıkar (ikinci yama üretilmez).
    store.createPatch({
      id: crypto.randomUUID(),
      errorCode: "SIK_HATA",
      category: "SIK_HATA",
      branch: "doktor/sik-hata",
      files: ["a.ts"],
      diff: "d",
      testOk: true,
      testSummary: "s",
    });
    expect(pipeline.diagnose()).toEqual([]);
  });
});

describe("DoctorPipeline.run — doğrulama hataları", () => {
  it("repo yolu yoksa VALIDATION_SELFDEV_REPO_REQUIRED (paketlenmiş kurulumun dürüst sınırı)", async () => {
    openStore();
    seedTelemetry("KOD", 3);
    const { bus } = busWithLog();
    const pipeline = new DoctorPipeline({
      store,
      bus,
      log,
      startRun: async () => ({ runId: crypto.randomUUID() }),
      selfDev: { minRecurrence: 3, windowDays: 7 },
      ops: fakeOps({ findRepoRoot: () => null }),
    });

    await expect(pipeline.run("KOD")).rejects.toThrow(/repo/i);
  });

  it("penceredeki telemetride kod yoksa VALIDATION_DOCTOR_CODE_UNKNOWN (uydurma koşu başlamaz)", async () => {
    openStore();
    const { bus } = busWithLog();
    const pipeline = new DoctorPipeline({
      store,
      bus,
      log,
      startRun: async () => ({ runId: crypto.randomUUID() }),
      selfDev,
      ops: fakeOps(),
    });

    await expect(pipeline.run("HIC_OLMAYAN")).rejects.toThrow(/telemetri kaydı yok/);
  });

  it("süren bir koşu varken ikinci istek AGENT_DOCTOR_BUSY ile reddedilir", async () => {
    openStore();
    seedTelemetry("KOD", 3);
    const { bus } = busWithLog();
    // Sandbox asla çözülmez → boru hattı "meşgul" kalır.
    const pipeline = new DoctorPipeline({
      store,
      bus,
      log,
      startRun: async () => ({ runId: crypto.randomUUID() }),
      selfDev,
      ops: fakeOps({ createSandbox: () => new Promise(() => undefined) }),
    });

    await pipeline.run("KOD");
    await expect(pipeline.run("KOD")).rejects.toThrow(/doktor koşusu/i);
  });
});

describe("DoctorPipeline.run — boru hattı (sahte git/pnpm, gerçek store+bus)", () => {
  it("başarılı koşu → doktor agent'ı SANDBOX'ta çalışır, yama 'proposed' kaydedilir, olay yayınlanır", async () => {
    openStore();
    seedTelemetry("AGENT_TOOL_LOOP", 4);
    const { bus, events } = busWithLog();
    const { startRun, calls } = startRunEmitting(bus, "completed");
    const ops = fakeOps();
    const pipeline = new DoctorPipeline({ store, bus, log, startRun, selfDev, ops });

    await pipeline.run("AGENT_TOOL_LOOP");
    await waitForSettle(events);

    // Doktor NORMAL bir agent koşusudur ve cwd = sandbox (jail onu oraya hapseder).
    expect(calls).toEqual([{ agentId: "doktor", cwd: SANDBOX.worktreePath }]);
    // Teşhis dosyası agent'a giden TEK veri kanalı — sandbox'a yazılmış olmalı.
    expect(ops.writeDiagnosis).toHaveBeenCalledWith(
      SANDBOX.worktreePath,
      expect.stringContaining("AGENT_TOOL_LOOP"),
    );

    const patches = store.listPatches();
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      errorCode: "AGENT_TOOL_LOOP",
      category: "AGENT_TOOL_LOOP",
      branch: "doktor/kod",
      files: ["a.ts"],
      testOk: true,
      state: "proposed", // daemon kendini YAMALAMAZ — yalnız öneri
    });

    const proposed = events.find((e) => e.type === "doctor.patch.proposed");
    expect(proposed?.payload).toMatchObject({ patchId: patches[0]?.id, testOk: true });
    // Yama önerildi → worktree kalkar ama DAL KORUNUR (D3 onu merge edecek).
    expect(ops.removeSandbox).toHaveBeenCalledWith("/repo", SANDBOX, true);
  });

  it("test_ok BORU HATTININ ölçümüdür — agent 'tamamlandı' dese bile düşen testler yamaya işlenir", async () => {
    openStore();
    seedTelemetry("KOD", 3);
    const { bus, events } = busWithLog();
    const { startRun } = startRunEmitting(bus, "completed"); // agent BAŞARILI bitti
    const ops = fakeOps({
      runVerification: vi.fn(async () => ({ ok: false, summary: "pnpm test DÜŞTÜ: 2 fail" })),
    });
    const pipeline = new DoctorPipeline({ store, bus, log, startRun, selfDev, ops });

    await pipeline.run("KOD");
    await waitForSettle(events);

    const patch = store.listPatches()[0];
    expect(patch?.testOk).toBe(false);
    expect(patch?.testSummary).toContain("DÜŞTÜ");
    expect(patch?.state).toBe("proposed"); // yine de kaydedilir; D3/D4 uygulanmasına izin vermez
  });

  it("koşu BAŞARISIZ → yama YAZILMAZ, sandbox tamamen temizlenir (dal dahil)", async () => {
    openStore();
    seedTelemetry("KOD", 3);
    const { bus, events } = busWithLog();
    const { startRun } = startRunEmitting(bus, "failed");
    const ops = fakeOps();
    const pipeline = new DoctorPipeline({ store, bus, log, startRun, selfDev, ops });

    await pipeline.run("KOD");
    await waitForSettle(events);

    expect(store.listPatches()).toEqual([]);
    expect(ops.collectAndCommit).not.toHaveBeenCalled();
    expect(ops.removeSandbox).toHaveBeenCalledWith("/repo", SANDBOX, false); // dal da silinir
  });

  it("agent hiçbir dosyayı değiştirmediyse yama YAZILMAZ, doğrulama bile koşmaz", async () => {
    openStore();
    seedTelemetry("KOD", 3);
    const { bus, events } = busWithLog();
    const { startRun } = startRunEmitting(bus, "completed");
    const ops = fakeOps({ collectAndCommit: vi.fn(async () => null) });
    const pipeline = new DoctorPipeline({ store, bus, log, startRun, selfDev, ops });

    await pipeline.run("KOD");
    await waitForSettle(events);

    expect(store.listPatches()).toEqual([]);
    expect(ops.runVerification).not.toHaveBeenCalled();
    expect(ops.removeSandbox).toHaveBeenCalledWith("/repo", SANDBOX, false);
  });

  it("boru hattı bittiğinde meşguliyet kalkar — ikinci koşu başlatılabilir", async () => {
    openStore();
    seedTelemetry("KOD", 3);
    const { bus, events } = busWithLog();
    const { startRun } = startRunEmitting(bus, "completed");
    const pipeline = new DoctorPipeline({ store, bus, log, startRun, selfDev, ops: fakeOps() });

    await pipeline.run("KOD");
    await waitForSettle(events);

    await expect(pipeline.run("KOD")).resolves.toBeUndefined();
  });
});
