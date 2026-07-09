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

/**
 * Scripted `turn()`'ü AI SDK v3 doStream part akışına çevirir (ADR-012 streamText göçü):
 * stream-start → (text-start/delta/end | tool-call)* → finish{usage,finishReason}.
 * Part şekilleri @ai-sdk/provider LanguageModelV3StreamPart'tan birebir.
 */
function scriptToStream(result: GenerateResult): ReadableStream<unknown> {
  const r = result as unknown as { content: ContentPart[]; usage: unknown; finishReason: unknown };
  const parts: Array<Record<string, unknown>> = [{ type: "stream-start", warnings: [] }];
  let textId = 0;
  for (const part of r.content) {
    if (part["type"] === "text") {
      const id = `t${++textId}`;
      parts.push({ type: "text-start", id });
      parts.push({ type: "text-delta", id, delta: part["text"] });
      parts.push({ type: "text-end", id });
    } else if (part["type"] === "tool-call") {
      parts.push({
        type: "tool-call",
        toolCallId: part["toolCallId"],
        toolName: part["toolName"],
        input: part["input"],
      });
    }
  }
  parts.push({ type: "finish", usage: r.usage, finishReason: r.finishReason });
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

/** Stream ortasında sağlayıcı hatası enjekte eder (rapor §5.4): finish YOK, yalnız error part. */
interface ErrorTurnEntry {
  __errorTurn: true;
  precedingText: string;
  error: Error;
}

function errorTurn(error: Error, precedingText = ""): ErrorTurnEntry {
  return { __errorTurn: true, precedingText, error };
}

function isErrorTurn(entry: GenerateResult | ErrorTurnEntry): entry is ErrorTurnEntry {
  return (
    typeof entry === "object" && entry !== null && (entry as ErrorTurnEntry).__errorTurn === true
  );
}

/**
 * @ai-sdk/provider `LanguageModelV3StreamPart` = `{ type: "error", error }` — gerçek bir
 * sağlayıcı ağ/API hatasının stream ORTASINDA kesilmesini birebir taklit eder: `finish`
 * PARÇASI YOK. AI SDK'nın kendi kaynağına göre (`ai@7.0.11`, `DefaultStreamTextResult`)
 * `textStream` yalnız text-delta'ları filtreler (error'ı SESSİZCE atlar, throw ETMEZ) —
 * hata `result.response`/`result.usage` await'inde yüzeye çıkar (rapor §5.4'ün sorduğu soru).
 */
function errorStream(entry: ErrorTurnEntry): ReadableStream<unknown> {
  const parts: Array<Record<string, unknown>> = [{ type: "stream-start", warnings: [] }];
  if (entry.precedingText.length > 0) {
    parts.push({ type: "text-start", id: "e1" });
    parts.push({ type: "text-delta", id: "e1", delta: entry.precedingText });
    parts.push({ type: "text-end", id: "e1" });
  }
  parts.push({ type: "error", error: entry.error });
  return new ReadableStream({
    start(controller) {
      for (const p of parts) controller.enqueue(p);
      controller.close();
    },
  });
}

/**
 * Test kontrolünde, TAMAMLANMASI ELLE tetiklenen tur (rapor2 §3.2): normal `turn()` mock'u
 * near-senkron çözüldüğünden "asistan turu bitmeden ÖNCE kalıcılaştı" iddiasını `waitState`
 * ile yakalamak yarış yaratır — bu, streamText çağrılana kadar hiçbir şey üretmeyen bir
 * ReadableStream sağlayıp denetimi teste bırakır (push/finish teste kadar asılı kalır).
 */
interface DeferredTurnEntry {
  __deferred: true;
}

function deferredTurn(): DeferredTurnEntry {
  return { __deferred: true };
}

function isDeferredTurn(entry: unknown): entry is DeferredTurnEntry {
  return typeof entry === "object" && entry !== null && (entry as DeferredTurnEntry).__deferred === true;
}

interface DeferredStreamController {
  pushText(text: string): void;
  finish(): void;
}

function deferredStream(): { stream: ReadableStream<unknown>; controller: DeferredStreamController } {
  let ctrl: ReadableStreamDefaultController<unknown> | null = null;
  let textId = 0;
  const stream = new ReadableStream<unknown>({
    start(controller) {
      ctrl = controller;
      controller.enqueue({ type: "stream-start", warnings: [] });
    },
  });
  return {
    stream,
    controller: {
      pushText(text) {
        const id = `d${++textId}`;
        ctrl?.enqueue({ type: "text-start", id });
        ctrl?.enqueue({ type: "text-delta", id, delta: text });
        ctrl?.enqueue({ type: "text-end", id });
      },
      finish() {
        ctrl?.enqueue({
          type: "finish",
          usage: { inputTokens: { total: 3 }, outputTokens: { total: 2 } },
          finishReason: { unified: "stop" },
        });
        ctrl?.close();
      },
    },
  };
}

class FakeAdapter implements ProviderAdapter {
  readonly name = "fake";
  readonly forwardsTemperature = true;
  /** Her model turunun çağrı seçenekleri (konuşmalı test: sonraki tur user mesajını görüyor mu). */
  readonly prompts: unknown[] = [];
  /** deferredTurn() sırasıyla üretilen kontrolörler — test elle push/finish çağırır. */
  readonly deferred: DeferredStreamController[] = [];

  constructor(private readonly script: Array<GenerateResult | ErrorTurnEntry | DeferredTurnEntry>) {}

  listModels(): Promise<ModelInfo[]> {
    return Promise.resolve([{ provider: "fake", id: "fake-1", local: true }]);
  }

  isConfigured(): Promise<boolean> {
    return Promise.resolve(true);
  }

  languageModel(): Promise<MockLanguageModelV3> {
    const script = this.script;
    const prompts = this.prompts;
    const deferred = this.deferred;
    // Motor artık streamText kullanıyor → doStream (ADR-012). Config'i cast'liyoruz:
    // doStream'in tam dönüş tipi @ai-sdk/provider'da (transitive; core'dan içe aktarılmaz).
    const config = {
      doStream: (options: unknown) => {
        prompts.push(options);
        const next = script.shift();
        if (next === undefined) throw new Error("senaryo bitti ama model yine çağrıldı");
        if (isDeferredTurn(next)) {
          const { stream, controller } = deferredStream();
          deferred.push(controller);
          return Promise.resolve({ stream });
        }
        const stream = isErrorTurn(next) ? errorStream(next) : scriptToStream(next);
        return Promise.resolve({ stream });
      },
    } as unknown as ConstructorParameters<typeof MockLanguageModelV3>[0];
    return Promise.resolve(new MockLanguageModelV3(config));
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

function makeEngine(
  script: Array<GenerateResult | ErrorTurnEntry | DeferredTurnEntry>,
  memoryProfile: string | null = null,
): {
  engine: AgentEngine;
  bus: CaptureBus;
  store: DataStore;
  permissionsFile: string;
  adapter: FakeAdapter;
} {
  const bus = new CaptureBus();
  const store = new DataStore(join(home, "data", `test-${Date.now()}-${Math.random()}.db`));
  openStores.push(store);
  const adapter = new FakeAdapter(script);
  const permissionsFile = join(home, `permissions-${Date.now()}-${Math.random()}.json`);
  const engine = new AgentEngine({
    providers: new Map([[adapter.name, adapter]]),
    bus,
    store,
    log: pino({ level: "silent" }),
    agentsDir: join(home, "agents"),
    permissionsFile,
    mcpServersFile: join(home, `mcp-servers-${Date.now()}-${Math.random()}.json`),
    pickModel: () => Promise.resolve(null),
    loadMemoryProfile: () => memoryProfile,
  });
  return { engine, bus, store, permissionsFile, adapter };
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

  it("allow_for_run: FARKLI hedeflerle aynı araca yapılan sonraki çağrılar bu koşuda sormaz, kalıcı kural YAZILMAZ", async () => {
    const { engine, bus, permissionsFile } = makeEngine([
      turn([toolCall("write_file", { path: "run-guven-1.txt", content: "birinci" })]),
      turn([toolCall("write_file", { path: "run-guven-2.txt", content: "ikinci" })]), // farklı hedef
      turn([text("bitti")]),
    ]);
    await engine.start(START);

    const request = await bus.waitFor("agent.tool.requested");
    engine.respond({ requestId: request.requestId, decision: "allow_for_run" }, "cli");
    await bus.waitFor("agent.run.completed");

    expect(readFileSync(join(workspace, "run-guven-1.txt"), "utf8")).toBe("birinci");
    expect(readFileSync(join(workspace, "run-guven-2.txt"), "utf8")).toBe("ikinci");
    const requested = bus.emitted.filter((e) => e.type === "agent.tool.requested");
    expect(requested).toHaveLength(1); // farklı dosya olmasına rağmen ikinci çağrı sormadı
    expect(existsSync(permissionsFile)).toBe(false); // kalıcı kural YAZILMADI (SPEC §5)
  });

  it("allow_for_run: destructive çağrı için sunulmaz/uygulanmaz — aynı araç bile olsa yine sorar", async () => {
    const { engine, bus } = makeEngine([
      turn([toolCall("run_command", { command: "echo merhaba" })]), // mutating
      turn([toolCall("run_command", { command: "rm -rf x" })]), // destructive
      turn([text("bitti")]),
    ]);
    await engine.start(START);

    const first = await bus.waitFor("agent.tool.requested");
    expect(first.riskClass).toBe("mutating");
    engine.respond({ requestId: first.requestId, decision: "allow_for_run" }, "cli");

    // İkinci run_command destructive: allow_for_run'a rağmen yine SORMALI (ikinci
    // agent.tool.requested belirene kadar bekle — CaptureBus.waitFor yalnız İLKİ verir).
    let second: (typeof bus.emitted)[number] | undefined;
    for (let i = 0; i < 40; i++) {
      const events = bus.emitted.filter((e) => e.type === "agent.tool.requested");
      if (events.length >= 2) {
        second = events[1];
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (second === undefined) throw new Error("ikinci izin isteği zamanında gelmedi");
    const secondPayload = second.payload as { requestId: string; riskClass: string };
    expect(secondPayload.riskClass).toBe("destructive");

    engine.respond({ requestId: secondPayload.requestId, decision: "deny" }, "cli");
    await bus.waitFor("agent.run.completed");
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

  it("ADR-013: loadMemoryProfile() null olmayan dönerse model turuna enjekte edilir", async () => {
    const { engine, bus, adapter } = makeEngine(
      [turn([text("cevap")])],
      "Kullanıcının adı Deniz, TypeScript tercih eder.",
    );
    await engine.start(START);
    await bus.waitFor("agent.run.completed");
    expect(JSON.stringify(adapter.prompts[0])).toContain("Kullanıcının adı Deniz");
  });

  it("ADR-013: loadMemoryProfile() null dönerse prompt'ta profil bölümü YOKTUR", async () => {
    const { engine, bus, adapter } = makeEngine([turn([text("cevap")])], null);
    await engine.start(START);
    await bus.waitFor("agent.run.completed");
    expect(JSON.stringify(adapter.prompts[0])).not.toContain("Kullanıcı profili");
  });

  it("rapor2 §3.3: MCP bağlantı hatasında agent.run.state:'failed' de yayınlanır (queued→thinking→failed geçerli)", async () => {
    const { engine, bus } = makeEngine([turn([text("hiç buraya gelmemeli")])]);
    await engine.start({ ...START, agentId: "mcpli" });
    await bus.waitFor("agent.run.failed");
    // Düzeltmeden önce: queued→failed geçersiz geçiş olduğundan bu olay HİÇ yayınlanmazdı
    // (yalnız "geçersiz agent durum geçişi engellendi" logu düşerdi, istemci queued'da kalırdı).
    const states = bus.emitted
      .filter((e) => e.type === "agent.run.state")
      .map((e) => (e.payload as { state: string }).state);
    expect(states).toEqual(["thinking", "failed"]);
  });
});

// ---- Dilim 2.2: konuşmalı koşu (ADR-012 — awaiting_user + agent.say + conversational) ----

/** Belirli bir agent.run.state değerinin en az `count` kez yayınlanmasını bekler. */
async function waitState(
  bus: CaptureBus,
  state: string,
  count = 1,
  timeoutMs = 4000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const seen = bus.emitted.filter(
      (e) => e.type === "agent.run.state" && (e.payload as { state: string }).state === state,
    ).length;
    if (seen >= count) return;
    if (Date.now() > deadline) throw new Error(`'${state}' durumu (${count}.) zamanında gelmedi`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

/** Serbest koşul için genel bekleme (ör. deferredTurn'ün GERÇEKTEN çağrıldığının doğrulanması). */
async function waitUntil(predicate: () => boolean, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (predicate()) return;
    if (Date.now() > deadline) throw new Error("koşul zamanında sağlanmadı");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describe("AgentEngine — konuşmalı koşu (ADR-012, dilim 2.2)", () => {
  it("tur araçsız bitince completed YERİNE awaiting_user; agent.say AYNI koşuda ikinci turu sürer", async () => {
    const { engine, bus, adapter } = makeEngine([
      turn([text("İlk cevap")]),
      turn([text("İkinci cevap")]),
    ]);
    const { runId } = await engine.start({ ...START, conversational: true });

    await waitState(bus, "awaiting_user", 1);
    // Koşu KAPANMADI: haritada canlı, completed yayınlanmadı.
    expect(engine.activeRuns()).toMatchObject([{ runId, state: "awaiting_user" }]);
    expect(bus.emitted.some((e) => e.type === "agent.run.completed")).toBe(false);

    engine.say({ runId, text: "devam et lütfen" });
    await waitState(bus, "awaiting_user", 2); // ikinci tur da bitti, yine park

    // Her iki turun metni AYNI runId ile agent.delta'dan aktı.
    const deltas = bus.emitted
      .filter((e) => e.type === "agent.delta")
      .map((e) => e.payload as { runId: string; text: string });
    expect(deltas.every((d) => d.runId === runId)).toBe(true);
    const streamed = deltas.map((d) => d.text).join("");
    expect(streamed).toContain("İlk cevap");
    expect(streamed).toContain("İkinci cevap");
    // İkinci model turu, araya eklenen kullanıcı mesajını GÖRDÜ (bağlam canlı).
    expect(JSON.stringify(adapter.prompts[1])).toContain("devam et lütfen");
    expect(engine.activeRuns()).toHaveLength(1); // hâlâ tek ve aynı koşu

    engine.cancel(runId);
    await waitState(bus, "cancelled", 1);
    expect(engine.activeRuns()).toHaveLength(0);
  });

  it("cancelAll park etmiş (awaiting_user) koşuyu da kapatır — daemon kapanışı sızıntı bırakmaz (rapor §4.2)", async () => {
    const { engine, bus } = makeEngine([turn([text("cevap")])]);
    await engine.start({ ...START, conversational: true });
    await waitState(bus, "awaiting_user", 1);

    engine.cancelAll();
    await waitState(bus, "cancelled", 1);
    expect(engine.activeRuns()).toHaveLength(0);
  });

  it("agent.say korumaları: bilinmeyen koşu AGENT_UNKNOWN_RUN, beklemeyen koşu AGENT_NOT_AWAITING_USER", async () => {
    const { engine, bus } = makeEngine([
      turn([toolCall("write_file", { path: "say-koruma.txt", content: "x" })]),
    ]);
    const { runId } = await engine.start({ ...START, conversational: true });
    await bus.waitFor("agent.tool.requested"); // koşu awaiting_permission'da, awaiting_user DEĞİL

    expect(() => engine.say({ runId: crypto.randomUUID(), text: "x" })).toThrowError(
      "Aktif koşu bulunamadı",
    );
    expect(() => engine.say({ runId, text: "x" })).toThrowError("kullanıcı turu beklemiyor");

    engine.cancel(runId);
    await waitState(bus, "cancelled", 1);
  });

  it("conversational verilmeyen koşu ESKİ davranışını korur: araçsız tur → completed", async () => {
    const { engine, bus } = makeEngine([turn([text("tek seferlik cevap")])]);
    await engine.start(START);
    const completed = await bus.waitFor("agent.run.completed");
    expect(completed.result).toBe("tek seferlik cevap");
    expect(
      bus.emitted.some(
        (e) =>
          e.type === "agent.run.state" &&
          (e.payload as { state: string }).state === "awaiting_user",
      ),
    ).toBe(false);
  });
});

describe("AgentEngine — rapor §5.4: akış ortasında sağlayıcı hatası", () => {
  it("KABUL: stream ortasında sağlayıcı hatası → agent.run.failed (BOŞ 'completed' sanılmaz); hata öncesi akan metin KAYBOLMAZ", async () => {
    const { engine, bus } = makeEngine([errorTurn(new Error("ağ koptu"), "yarım kalan cev")]);
    await engine.start(START);

    // Bulgu (izole script'le doğrulandı, kaynak okuması yanıltıcıydı): ai@7.0.11'de stream
    // ortasındaki "error" parçası result.response/usage'ı REDDETMEZ, finishReason:"error" ile
    // "normal" döner. Kontrolsüz motor bunu boş bir agent.run.completed sanırdı — engine.ts'e
    // eklenen finishReason denetimi bunu PROVIDER_STREAM_ERROR ile failed'e çevirir.
    const failed = await bus.waitFor("agent.run.failed");
    expect(failed.error.code).toBe("PROVIDER_STREAM_ERROR");
    expect(bus.emitted.some((e) => e.type === "agent.run.completed")).toBe(false);

    // Hata öncesi akan kısmi metin agent.delta'dan KAYBOLMADI (batching flush güvenlik ağı).
    const streamed = bus.emitted
      .filter((e) => e.type === "agent.delta")
      .map((e) => (e.payload as { text: string }).text)
      .join("");
    expect(streamed).toBe("yarım kalan cev");

    // Koşu haritada asılı kalmadı (rapor §4.2'nin genel ilkesi: her çıkış yolu temizler).
    expect(engine.activeRuns()).toHaveLength(0);
  });
});

// ---- Dilim 2.3b: konuşma kalıcılığı (sessions/messages) + resume ----

const transcript = (store: DataStore, sessionId: string): string[] =>
  store.sessionDetail(sessionId)?.messages.map((m) => `${m.role}:${m.content}`) ?? [];

describe("AgentEngine — konuşma kalıcılığı (Dilim 2.3b)", () => {
  it("konuşmalı koşu her asistan turunu sessions'a REPLACE eder; agent.start.ok sessionId döner", async () => {
    const { engine, bus, store } = makeEngine([
      turn([text("İlk cevap")]),
      turn([text("İkinci cevap")]),
    ]);
    const { runId, sessionId } = await engine.start({ ...START, conversational: true });
    expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);

    await waitState(bus, "awaiting_user", 1);
    expect(transcript(store, sessionId)).toEqual(["user:test görevi", "assistant:İlk cevap"]);

    engine.say({ runId, text: "peki ya bu?" });
    await waitState(bus, "awaiting_user", 2);
    expect(transcript(store, sessionId)).toEqual([
      "user:test görevi",
      "assistant:İlk cevap",
      "user:peki ya bu?",
      "assistant:İkinci cevap",
    ]);

    engine.cancel(runId);
    await waitState(bus, "cancelled", 1);
  });

  it("araç turu geçmişe GİRMEZ: transcript yalnız user görev + asistanın NİHAİ metni", async () => {
    const { engine, bus, store } = makeEngine([
      turn([toolCall("read_file", { path: "mevcut.txt" })]), // safe araç — izin yok, transcript'e girmez
      turn([text("dosyayı okudum")]),
    ]);
    const { runId, sessionId } = await engine.start({ ...START, conversational: true });
    await waitState(bus, "awaiting_user", 1);

    // read_file çağrısı/sonucu KAYITTA YOK — yalnız konuşma turları (PROTOKOL §3 notu).
    expect(transcript(store, sessionId)).toEqual(["user:test görevi", "assistant:dosyayı okudum"]);

    engine.cancel(runId);
    await waitState(bus, "cancelled", 1);
  });

  it("sessionId ile başlatınca eski bağlam modele tohumlanır ve AYNI oturuma eklenir (resume)", async () => {
    const { engine, bus, store, adapter } = makeEngine([turn([text("Evet, Deniz")])]);
    const priorSessionId = crypto.randomUUID();
    store.saveConversation({
      sessionId: priorSessionId,
      provider: "fake",
      model: "fake-1",
      messages: [
        { role: "user", content: "adım Deniz" },
        { role: "assistant", content: "memnun oldum" },
      ],
    });

    const { runId, sessionId } = await engine.start({
      ...START,
      conversational: true,
      sessionId: priorSessionId,
      task: "adımı hatırlıyor musun?",
    });
    expect(sessionId).toBe(priorSessionId); // resume: aynı oturuma yazılır

    await waitState(bus, "awaiting_user", 1);
    // Model bu turda eski bağlamı GÖRDÜ (prompt'a tohumlandı).
    const prompt = JSON.stringify(adapter.prompts[0]);
    expect(prompt).toContain("adım Deniz");
    expect(prompt).toContain("memnun oldum");
    // Oturum: eski 2 + yeni 2 mesaj, tek dizide.
    expect(transcript(store, priorSessionId)).toEqual([
      "user:adım Deniz",
      "assistant:memnun oldum",
      "user:adımı hatırlıyor musun?",
      "assistant:Evet, Deniz",
    ]);

    engine.cancel(runId);
    await waitState(bus, "cancelled", 1);
  });

  it("tek-seferlik (conversational olmayan) koşu sessions'a YAZMAZ — eski davranış korunur", async () => {
    const { engine, bus, store } = makeEngine([turn([text("tek seferlik cevap")])]);
    const { sessionId } = await engine.start(START);
    await bus.waitFor("agent.run.completed");
    // Konuşmalı değil → oturum kaydı yok (one-shot task, yalnız agent_runs'ta).
    expect(store.sessionDetail(sessionId)).toBeNull();
  });

  it("rapor2 §3.2: görev metni İLK model turu bitmeden önce zaten kalıcılaşır", async () => {
    // deferredTurn(): stream biz push/finish çağırana dek hiçbir şey üretmez — "thinking"e
    // geçmiş olması, asistan cevabının GELMEDİĞİNİN garantisidir (yarış yok).
    const { engine, bus, store, adapter } = makeEngine([deferredTurn()]);
    const { runId, sessionId } = await engine.start({ ...START, conversational: true });

    // rapor2 §3.3 sonrası "thinking" MCP bağlantısından ÖNCE de ateşlenebiliyor — asıl garanti
    // noktamız modelin GERÇEKTEN çağrıldığı an (deferred stream oluşturulunca).
    await waitUntil(() => adapter.deferred.length > 0);
    // İlk tur hâlâ asılı (deferred) — henüz asistan metni YOK; görev zaten DB'de olmalı.
    expect(transcript(store, sessionId)).toEqual(["user:test görevi"]);

    adapter.deferred[0]?.pushText("cevap");
    adapter.deferred[0]?.finish();
    await waitState(bus, "awaiting_user", 1);
    expect(transcript(store, sessionId)).toEqual(["user:test görevi", "assistant:cevap"]);

    engine.cancel(runId);
    await waitState(bus, "cancelled", 1);
  });

  it("rapor2 §3.2: agent.say kullanıcı turu, SONRAKİ asistan turu bitmeden önce kalıcılaşır", async () => {
    const { engine, bus, store, adapter } = makeEngine([turn([text("İlk cevap")]), deferredTurn()]);
    const { runId, sessionId } = await engine.start({ ...START, conversational: true });
    await waitState(bus, "awaiting_user", 1);

    engine.say({ runId, text: "ikinci mesaj" });
    // İkinci tur "thinking"e geçti ama deferred stream hiçbir şey üretmediği için ASILI —
    // kullanıcı mesajı bu noktada ZATEN yazılmış olmalı (model turu ortasında koşu ölse bile
    // artık kalıcı — kayıp penceresi kapandı).
    await waitState(bus, "thinking", 2);
    expect(transcript(store, sessionId)).toEqual([
      "user:test görevi",
      "assistant:İlk cevap",
      "user:ikinci mesaj",
    ]);

    adapter.deferred[0]?.pushText("İkinci cevap");
    adapter.deferred[0]?.finish();
    await waitState(bus, "awaiting_user", 2);
    expect(transcript(store, sessionId)).toEqual([
      "user:test görevi",
      "assistant:İlk cevap",
      "user:ikinci mesaj",
      "assistant:İkinci cevap",
    ]);

    engine.cancel(runId);
    await waitState(bus, "cancelled", 1);
  });
});
