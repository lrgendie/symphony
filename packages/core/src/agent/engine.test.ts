import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pino } from "pino";
import { MockLanguageModelV3 } from "ai/test";
import type { z } from "zod";
import {
  MESSAGE_PAYLOAD_SCHEMAS,
  type EventPayload,
  type MessageType,
  type ModelInfo,
} from "@symphony/shared";
import { DataStore } from "../db/store.js";
import { EventBus } from "../server/bus.js";
import type { ChatStreamRequest, ChatUsageResult, ProviderAdapter } from "../providers/types.js";
import { AgentEngine } from "./engine.js";

/**
 * Kabul testleri (ROADMAP Faz 3): agent diff gösterip onay almadan TEK BAYT
 * yazamıyor; workspace dışına çıkamıyor; deny koşuyu kırmıyor. Model, senaryo
 * başına yazılmış (scripted) sahte AI SDK modelidir — ağ yok, determinizm tam.
 */

const base = join(tmpdir(), `symphony-engine-test-${Date.now()}`);
const home = join(base, "home");
const workspace = join(base, "ws");

// ---- Sahte model/sağlayıcı ----

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;
type ContentPart = Record<string, unknown>;

let callSeq = 0;
const toolCall = (toolName: string, input: Record<string, unknown>): ContentPart => ({
  type: "tool-call",
  toolCallId: `c${++callSeq}`,
  toolName,
  input: JSON.stringify(input),
});
const text = (value: string): ContentPart => ({ type: "text", text: value });

function turn(content: ContentPart[]): GenerateResult {
  return {
    finishReason: { unified: content.some((p) => p["type"] === "tool-call") ? "tool-calls" : "stop" },
    usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
    content,
    warnings: [],
  } as unknown as GenerateResult;
}

class FakeAdapter implements ProviderAdapter {
  readonly name = "fake";
  readonly forwardsTemperature = true;

  constructor(private readonly script: GenerateResult[]) {}

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([{ provider: "fake", id: "fake-1", local: true }]);
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(true);
  }

  languageModel(): Promise<MockLanguageModelV3> {
    return Promise.resolve(
      new MockLanguageModelV3({
        doGenerate: () => {
          const next = this.script.shift();
          if (next === undefined) throw new Error("senaryo bitti ama model yine çağrıldı");
          return Promise.resolve(next);
        },
      }),
    );
  }

  async *streamChat(_request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    throw new Error("fake adapter: streamChat agent testinde kullanılmaz");
  }
}

// ---- Olay yakalayan bus ----

type PayloadInput<T extends MessageType> = z.input<(typeof MESSAGE_PAYLOAD_SCHEMAS)[T]>;

class CaptureBus extends EventBus {
  readonly emitted: Array<{ type: MessageType; payload: unknown }> = [];
  private readonly waiters: Array<{
    predicate: (type: MessageType, payload: unknown) => boolean;
    resolve: (payload: unknown) => void;
  }> = [];

  override broadcast<T extends MessageType>(
    type: T,
    payload: PayloadInput<T>,
    replyTo: string | null = null,
  ) {
    const message = super.broadcast(type, payload, replyTo);
    this.emitted.push({ type, payload: message.payload });
    for (const waiter of [...this.waiters]) {
      if (waiter.predicate(type, message.payload)) {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(message.payload);
      }
    }
    return message;
  }

  waitFor<T extends MessageType>(type: T, timeoutMs = 4000): Promise<EventPayload<T>> {
    const already = this.emitted.find((e) => e.type === type);
    if (already !== undefined) return Promise.resolve(already.payload as EventPayload<T>);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`${type} olayı ${timeoutMs}ms içinde gelmedi`)),
        timeoutMs,
      );
      this.waiters.push({
        predicate: (t) => t === type,
        resolve: (payload) => {
          clearTimeout(timer);
          resolve(payload as EventPayload<T>);
        },
      });
    });
  }
}

// ---- Kurulum ----

const openStores: DataStore[] = [];

function makeEngine(script: GenerateResult[]): { engine: AgentEngine; bus: CaptureBus; store: DataStore } {
  const bus = new CaptureBus();
  const store = new DataStore(join(home, "data", `test-${Date.now()}-${Math.random()}.db`));
  openStores.push(store);
  const adapter = new FakeAdapter(script);
  const engine = new AgentEngine({
    providers: new Map([[adapter.name, adapter]]),
    bus,
    store,
    log: pino({ level: "silent" }),
    agentsDir: join(home, "agents"),
    permissionsFile: join(home, `permissions-${Date.now()}-${Math.random()}.json`),
    mcpServersFile: join(home, `mcp-servers-${Date.now()}-${Math.random()}.json`),
    pickModel: () => Promise.resolve(null),
  });
  return { engine, bus, store };
}

const START = { agentId: "testci", cwd: "", task: "test görevi" };

beforeAll(() => {
  mkdirSync(join(home, "agents"), { recursive: true });
  mkdirSync(join(home, "data"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  writeFileSync(join(workspace, "mevcut.txt"), "eski içerik\n", "utf8");
  writeFileSync(
    join(home, "agents", "testci.md"),
    `---
name: testci
description: test agent
provider: fake
model: fake-1
maxSteps: 3
---
Test agent'ısın.`,
    "utf8",
  );
  writeFileSync(
    join(home, "agents", "mcpli.md"),
    `---
name: mcpli
description: mcpServers alanı olan test agent
provider: fake
model: fake-1
maxSteps: 3
tools: [read_file]
mcpServers: [tanimsiz-sunucu]
---
Test agent'ısın.`,
    "utf8",
  );
  START.cwd = workspace;
});

afterAll(() => {
  for (const store of openStores) store.close(); // Windows: açık db dosyası silinemez
  rmSync(base, { recursive: true, force: true });
});

describe("AgentEngine (SPEC-AGENT §4-§6)", () => {
  it("KABUL: onay almadan tek bayt yazamaz; deny koşuyu kırmaz", async () => {
    const target = join(workspace, "yeni.txt");
    const { engine, bus } = makeEngine([
      turn([toolCall("write_file", { path: "yeni.txt", content: "izinsiz" })]),
      turn([text("yazamadım, kullanıcı reddetti")]),
    ]);
    await engine.start(START);

    const request = await bus.waitFor("agent.tool.requested");
    expect(request.tool).toBe("write_file");
    expect(request.riskClass).toBe("mutating");
    expect(request.diff).toContain("+izinsiz"); // diff ZORUNLU (PROTOKOL §4)
    expect(existsSync(target)).toBe(false); // onay yokken DİSKE DOKUNULMADI

    engine.respond({ requestId: request.requestId, decision: "deny" }, "cli");
    const completed = await bus.waitFor("agent.run.completed"); // deny → koşu DEVAM ETTİ
    expect(completed.result).toContain("reddetti");
    expect(existsSync(target)).toBe(false); // reddedilen yazma hiç gerçekleşmedi
  });

  it("allow → yazar; always_allow → kural kalıcılaşır ve ikinci istek sorulmaz", async () => {
    const { engine, bus } = makeEngine([
      turn([toolCall("write_file", { path: "izinli.txt", content: "birinci" })]),
      turn([toolCall("write_file", { path: "izinli.txt", content: "ikinci" })]),
      turn([text("bitti")]),
    ]);
    await engine.start(START);

    const request = await bus.waitFor("agent.tool.requested");
    engine.respond({ requestId: request.requestId, decision: "always_allow" }, "cli");
    await bus.waitFor("agent.run.completed");

    expect(readFileSync(join(workspace, "izinli.txt"), "utf8")).toBe("ikinci");
    const requested = bus.emitted.filter((e) => e.type === "agent.tool.requested");
    expect(requested).toHaveLength(1); // ikinci yazma kuraldan otomatik geçti
  });

  it("KABUL: workspace dışına çıkamaz (izin bile istenmez, hata modele döner)", async () => {
    const { engine, bus } = makeEngine([
      turn([toolCall("write_file", { path: "../kacak.txt", content: "sızıntı" })]),
      turn([text("dışarı yazamadım")]),
    ]);
    await engine.start(START);
    const completed = await bus.waitFor("agent.run.completed");
    expect(completed.result).toContain("yazamadım");
    expect(existsSync(join(base, "kacak.txt"))).toBe(false);
    expect(bus.emitted.some((e) => e.type === "agent.tool.requested")).toBe(false);
    const failedTool = bus.emitted.find((e) => e.type === "agent.tool.completed");
    expect((failedTool?.payload as { resultSummary: string }).resultSummary).toContain(
      "PERMISSION_JAIL",
    );
  });

  it("safe araçlar izin istemeden çalışır", async () => {
    const { engine, bus } = makeEngine([
      turn([toolCall("read_file", { path: "mevcut.txt" })]),
      turn([text("okudum")]),
    ]);
    await engine.start(START);
    await bus.waitFor("agent.run.completed");
    expect(bus.emitted.some((e) => e.type === "agent.tool.requested")).toBe(false);
    const done = bus.emitted.find((e) => e.type === "agent.tool.completed");
    expect((done?.payload as { ok: boolean }).ok).toBe(true);
  });

  it("maxSteps döngü sigortası: sınır aşılınca failed(AGENT_MAX_STEPS)", async () => {
    const readTurn = (): GenerateResult => turn([toolCall("read_file", { path: "mevcut.txt" })]);
    const { engine, bus } = makeEngine([readTurn(), readTurn(), readTurn(), readTurn(), readTurn()]);
    await engine.start(START); // testci.maxSteps = 3
    const failed = await bus.waitFor("agent.run.failed");
    expect(failed.error.code).toBe("AGENT_MAX_STEPS");
  });

  it("aynı araçta üst üste 3 aynı hata → failed(AGENT_TOOL_LOOP)", async () => {
    const badTurn = (): GenerateResult => turn([toolCall("read_file", { path: "yok-boyle.txt" })]);
    const { engine, bus } = makeEngine([badTurn(), badTurn(), badTurn(), badTurn()]);
    await engine.start(START);
    const failed = await bus.waitFor("agent.run.failed");
    expect(failed.error.code).toBe("AGENT_TOOL_LOOP");
  });

  it("iptal: izin beklerken agent.cancel → cancelled, dosya yazılmaz", async () => {
    const { engine, bus } = makeEngine([
      turn([toolCall("write_file", { path: "iptal.txt", content: "x" })]),
    ]);
    const { runId } = await engine.start(START);
    await bus.waitFor("agent.tool.requested");
    engine.cancel(runId);
    await bus.waitFor("agent.run.state", 4000).then(async () => {
      // cancelled durumunu bekle (ara durumlar da agent.run.state yayınlar)
      for (let i = 0; i < 40; i++) {
        if (
          bus.emitted.some(
            (e) =>
              e.type === "agent.run.state" &&
              (e.payload as { state: string }).state === "cancelled",
          )
        ) {
          return;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error("cancelled durumu gelmedi");
    });
    expect(existsSync(join(workspace, "iptal.txt"))).toBe(false);
    expect(engine.activeRuns()).toHaveLength(0);
  });

  it("koşu meta verisi SQLite'a düşer (SPEC §7)", async () => {
    const { engine, bus, store } = makeEngine([
      turn([toolCall("read_file", { path: "mevcut.txt" })]),
      turn([text("tamam")]),
    ]);
    await engine.start(START);
    await bus.waitFor("agent.run.completed");
    const runs = store.recentAgentRuns(5);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.state).toBe("completed");
    expect(runs[0]?.steps).toBe(1);
    expect(runs[0]?.input_tokens).toBeGreaterThan(0);
  });

  it("MCP istemcisi (ADR-007): tanımsız mcpServers → failed(AGENT_MCP_SERVER_UNKNOWN)", async () => {
    const { engine, bus } = makeEngine([turn([text("hiç buraya gelmemeli")])]);
    await engine.start({ ...START, agentId: "mcpli" });
    const failed = await bus.waitFor("agent.run.failed");
    expect(failed.error.code).toBe("AGENT_MCP_SERVER_UNKNOWN");
  });
});
