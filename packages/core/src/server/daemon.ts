import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { WebSocketServer, WebSocket } from "ws";
import { pino } from "pino";
import {
  ChatStartPayloadSchema,
  DAEMON_HOST,
  PROTOCOL_VERSION,
  createMessage,
  parseMessage,
  type ErrorPayload,
  type GpuSample,
  type ModelInfo,
  type ProviderHealth,
  type RequestPayload,
  type Snapshot,
  type Usage,
} from "@symphony/shared";
import { ensureSymphonyHome } from "../config/paths.js";
import { loadConfig } from "../config/config.js";
import { createSecretStore } from "../secrets/secret-store.js";
import { AnthropicAdapter } from "../providers/anthropic.js";
import { GoogleAdapter } from "../providers/google.js";
import { OllamaAdapter } from "../providers/ollama.js";
import { OpenAIAdapter } from "../providers/openai.js";
import type { ProviderAdapter } from "../providers/types.js";
import { DataStore } from "../db/store.js";
import { detectVramGb, sampleGpus } from "../router/hardware.js";
import { suggestModels } from "../router/router.js";
import { AgentEngine } from "../agent/engine.js";
import { ensureDefaultAgent } from "../agent/definition.js";
import { registerMcpServer } from "../agent/mcp.js";
import { ensureProfileScaffold, loadProfile } from "../memory/profile.js";
import { EventBus } from "./bus.js";
import { DeltaBatcher } from "./delta-batcher.js";
import { generateDaemonToken, loadExistingToken, persistDaemonToken } from "./token.js";

export const DAEMON_VERSION = "0.1.0";

export interface DaemonOptions {
  /** Test/geliştirme: 0 verilirse boş bir port seçilir. */
  port?: number;
  /** Test: `~/.symphony` yerine kullanılacak dizin. */
  home?: string;
  /** Test: sahte Ollama sunucusuna yönlendirme. Varsayılan: http://127.0.0.1:11434 */
  ollamaBaseUrl?: string;
  /** YALNIZ test: gerçek adapter'ların yerine geçer (agent motoru senaryoları için). */
  testProviders?: ProviderAdapter[];
  /**
   * GPU vital örneklemesi (`hardware.updated`). Testlerde kapatılır: gerçek nvidia-smi
   * çağrısı + periyodik yayın, olay dizisi bekleyen testleri bozar. Varsayılan: true.
   */
  sampleHardware?: boolean;
}

export interface RunningDaemon {
  port: number;
  token: string;
  close(): Promise<void>;
}

export async function startDaemon(options: DaemonOptions = {}): Promise<RunningDaemon> {
  const paths = ensureSymphonyHome(options.home);
  const config = loadConfig(paths);
  const port = options.port ?? config.daemon.port;

  // Tek-kopya kilidi (2026-07-03 dersi): çalışan bir symphonyd varken ikinci
  // kopya, token dosyasına DOKUNMADAN burada durdurulur. (port 0 = test/ephemeral,
  // çakışamaz.) Sondanın yakalayamadığı yabancı süreçlerde EADDRINUSE yine erken
  // fırlar — token dinleme başarılı olana dek yazılmadığı için dosya güvendedir.
  if (port !== 0) {
    const running = await probeRunningDaemon(port);
    if (running !== null) {
      throw makeError(
        "DAEMON_ALREADY_RUNNING",
        `Port ${port}'de zaten bir symphonyd çalışıyor (v${running.daemonVersion}). ` +
          "İkinci kopya başlatılmadı; mevcut daemon'ı kullan veya önce onu durdur.",
      );
    }
  }

  // Diskteki geçerli token'ı yeniden kullan (daemon restart'ında istemciler kopmasın); yoksa üret.
  const token = loadExistingToken(paths.daemonTokenFile) ?? generateDaemonToken();
  const log = pino({ name: "symphonyd" });

  const secrets = await createSecretStore();
  const store = new DataStore(paths.databaseFile);
  // SPEC-AGENT §4: önceki ömürden yarım kalan koşular failed(AGENT_DAEMON_RESTART).
  const interrupted = store.markInterruptedAgentRuns();
  if (interrupted > 0) log.warn({ interrupted }, "yarım kalmış agent koşuları failed işaretlendi");
  ensureDefaultAgent(paths.agentsDir);
  // ADR-013: dosya yoksa yalnız boş iskelet (başlıklar) yazılır — gerçek içerik hep kullanıcıdan.
  ensureProfileScaffold(paths.profileFile);

  /** Taze okur (µs-ölçek, cache gereksiz); `memory.enabled=false` acil kapatma anahtarıdır. */
  const loadMemoryProfile = (): string | null => {
    if (!config.memory.enabled) return null;
    const loaded = loadProfile(paths.profileFile);
    if (loaded === null) return null;
    if (loaded.truncated) {
      log.warn({ file: paths.profileFile }, "kullanıcı profili MAX_PROFILE_CHARS'ı aştı, kesildi");
    }
    return loaded.text;
  };

  const providers = new Map<string, ProviderAdapter>();
  for (const adapter of options.testProviders ?? [
    new AnthropicAdapter(secrets),
    new OpenAIAdapter(secrets),
    new GoogleAdapter(secrets),
    new OllamaAdapter(options.ollamaBaseUrl),
  ]) {
    providers.set(adapter.name, adapter);
  }

  const bus = new EventBus();
  const activeChats = new Map<string, AbortController>();
  // rapor §5.1: chat.delta de agent.delta ile aynı desende toplu yayınlanır (anahtar = sessionId).
  const chatDeltaBatcher = new DeltaBatcher((sessionId, text) =>
    bus.broadcast("chat.delta", { sessionId, text }),
  );

  // Yerel GPU vitalleri (TASARIM §2): periyodik örneklenir, hardware.updated ile TÜM istemcilere
  // yayınlanır; yeni bağlanan istemciye son örnek anında gönderilir. Snapshot GPU taşımaz —
  // bu canlı telemetri, geçmiş değil. GPU yoksa (nvidia-smi başarısız) hiç yayınlanmaz.
  const HARDWARE_POLL_MS = 2000;
  let latestHardware: { gpus: GpuSample[]; sampledAt: number } | null = null;
  let hardwareTimer: NodeJS.Timeout | null = null;
  if (options.sampleHardware ?? true) {
    const pollHardware = async (): Promise<void> => {
      const gpus = await sampleGpus();
      latestHardware = { gpus, sampledAt: Date.now() };
      if (gpus.length > 0) bus.broadcast("hardware.updated", latestHardware);
    };
    void pollHardware();
    // unref: yalnız GPU örneklemek için süreç ayakta tutulmaz (kapanışı geciktirmez).
    hardwareTimer = setInterval(() => void pollHardware(), HARDWARE_POLL_MS);
    hardwareTimer.unref();
  }

  // VRAM bir kez tespit edilir (alt süreç maliyeti); ilk router.suggest'te tembel başlar.
  let vramProbe: Promise<number | null> | null = null;
  const getVramGb = (): Promise<number | null> => (vramProbe ??= detectVramGb());

  /** Router yalnız KULLANILABİLİR sağlayıcıların modellerini görür. */
  async function availableModels(): Promise<ModelInfo[]> {
    const lists = await Promise.all(
      [...providers.values()].map(async (provider) =>
        (await provider.isConfigured()) ? provider.listModels() : [],
      ),
    );
    return lists.flat();
  }

  async function providerStatuses(): Promise<ProviderHealth[]> {
    const statuses: ProviderHealth[] = [];
    for (const provider of providers.values()) {
      statuses.push({
        provider: provider.name,
        status: (await provider.isConfigured()) ? "up" : "down",
      });
    }
    return statuses;
  }

  const engine = new AgentEngine({
    providers,
    bus,
    store,
    log,
    agentsDir: paths.agentsDir,
    permissionsFile: paths.permissionsFile,
    mcpServersFile: paths.mcpServersFile,
    // "boşsa router seçer" (SPEC-AGENT §1): ilk öneri kullanılır.
    pickModel: async (task) => {
      const [models, vramGb] = await Promise.all([availableModels(), getVramGb()]);
      const suggestions = suggestModels(task, undefined, { models, vramGb });
      const first = suggestions[0];
      return first === undefined ? null : { provider: first.provider, model: first.model };
    },
    loadMemoryProfile,
  });

  async function buildSnapshot(): Promise<Snapshot> {
    return {
      runs: engine.activeRuns(),
      providers: await providerStatuses(),
      pendingPermissions: engine.pendingPermissions(),
    };
  }

  /**
   * WS ve REST'in ortak sohbet yolu: delta'lar TÜM istemcilere yayınlanır.
   * Her istek — başarı, hata, iptal — `requests` tablosuna kayıt düşer;
   * gerçek hatalar (iptal değil) ayrıca telemetriye yazılır (ROADMAP Faz 1).
   */
  async function runChat(
    payload: RequestPayload<"chat.start">,
    sessionId: string,
    onDelta?: (text: string) => void,
  ): Promise<Usage> {
    const startedAt = Date.now();
    const abort = new AbortController();
    activeChats.set(sessionId, abort);
    try {
      const provider = providers.get(payload.provider);
      if (!provider) {
        throw makeError("PROVIDER_UNKNOWN", `Bilinmeyen sağlayıcı: ${payload.provider}`);
      }
      // ADR-013: profil `instructions` ile taşınır (AI SDK v7 `messages` içinde system KABUL
      // ETMEZ — engine.ts'teki agent yoluyla aynı desen). `payload.messages` DEĞİŞMEZ; aşağıda
      // `saveChatTurn`'a giden de budur (kalıcı geçmişe profil asla girmez).
      const profile = loadMemoryProfile();
      const stream = provider.streamChat({
        model: payload.model,
        messages: payload.messages,
        temperature: payload.options.temperature,
        ...(payload.options.maxTokens !== undefined
          ? { maxTokens: payload.options.maxTokens }
          : {}),
        ...(profile !== null
          ? { instructions: `## Kullanıcı profili (salt-okunur bağlam)\n${profile}` }
          : {}),
        abortSignal: abort.signal,
      });
      let usageResult;
      let answer = "";
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          usageResult = next.value;
          break;
        }
        answer += next.value;
        // rapor §5.1: WS broadcast'i chunk başına DEĞİL, kısa bir pencerede toplu yapar.
        chatDeltaBatcher.push(sessionId, next.value);
        onDelta?.(next.value);
      }
      // Tur bitti — kalanı chat.completed'DAN ÖNCE yayınla (istemcide sıra bozulmasın, rapor §5.1).
      chatDeltaBatcher.flush(sessionId);
      const usage: Usage = {
        inputTokens: usageResult.inputTokens,
        outputTokens: usageResult.outputTokens,
        costUsd: usageResult.costUsd,
      };
      store.recordRequest({
        id: randomUUID(),
        sessionId,
        provider: payload.provider,
        model: payload.model,
        startedAt,
        durationMs: Date.now() - startedAt,
        usage,
        status: "ok",
      });
      // Sohbet geçmişi (PROTOKOL §3): yalnız başarılı tur oturumu günceller.
      store.saveChatTurn({
        sessionId,
        provider: payload.provider,
        model: payload.model,
        messages: payload.messages,
        assistantText: answer,
      });
      bus.broadcast("chat.completed", { sessionId, usage });
      bus.broadcast("usage.updated", {
        provider: payload.provider,
        model: payload.model,
        deltaTokens: usage.inputTokens + usage.outputTokens,
        deltaCostUsd: usage.costUsd,
        totals: store.usageTotals(payload.provider, payload.model),
        ...(usageResult.cacheReadTokens !== undefined
          ? { cacheReadTokens: usageResult.cacheReadTokens }
          : {}),
        ...(usageResult.cacheCreationTokens !== undefined
          ? { cacheCreationTokens: usageResult.cacheCreationTokens }
          : {}),
      });
      if (usageResult.limits !== undefined) {
        bus.broadcast("provider.limits", {
          provider: payload.provider,
          ...usageResult.limits,
          at: Date.now(),
        });
      }
      log.info({ sessionId, model: payload.model, ...usage }, "sohbet tamamlandı");
      return usage;
    } catch (error) {
      // Güvenlik ağı: hata/iptal döngüyü erken kesmiş olabilir (normal yoldaki explicit flush
      // hiç çalışmamıştır) — kalıntı kaybolmasın (rapor §5.1/§5.4, agent.delta ile aynı desen).
      chatDeltaBatcher.flush(sessionId);
      const cancelled = abort.signal.aborted;
      const errorPayload = toErrorPayload(error);
      store.recordRequest({
        id: randomUUID(),
        sessionId,
        provider: payload.provider,
        model: payload.model,
        startedAt,
        durationMs: Date.now() - startedAt,
        usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
        status: cancelled ? "cancelled" : "error",
        errorCode: errorPayload.code,
      });
      if (!cancelled) {
        store.recordTelemetry({
          scope: "chat",
          code: errorPayload.code,
          message: errorPayload.message,
          ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
          // Girdi ÖZETİ — ham mesaj içeriği asla yazılmaz (SPEC-AGENT §7).
          context: {
            provider: payload.provider,
            model: payload.model,
            sessionId,
            messageCount: payload.messages.length,
          },
        });
      }
      throw error;
    } finally {
      activeChats.delete(sessionId);
    }
  }

  // ---- REST ----

  const app = Fastify({ logger: false });

  app.get("/api/health", async () => ({
    ok: true,
    daemonVersion: DAEMON_VERSION,
    protocolVersion: PROTOCOL_VERSION,
  }));

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/api/health") return;
    if (request.headers.authorization !== `Bearer ${token}`) {
      await reply
        .code(401)
        .send({ code: "AUTH_TOKEN_INVALID", message: "Geçersiz veya eksik daemon token'ı" });
    }
  });

  // curl ile kabul testi için SSE ucu: data: {"type":"delta"|"completed"|"error", ...}
  app.post("/api/chat", async (request, reply) => {
    const parsed = ChatStartPayloadSchema.safeParse(request.body);
    if (!parsed.success) {
      await reply.code(400).send({
        code: "VALIDATION_PAYLOAD",
        message: "chat.start şemasına uymuyor",
        details: { issues: parsed.error.issues },
      });
      return;
    }
    const sessionId = parsed.data.sessionId ?? randomUUID();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    const send = (event: unknown): void => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    send({ type: "session", sessionId });
    try {
      const usage = await runChat(parsed.data, sessionId, (text) => send({ type: "delta", text }));
      send({ type: "completed", usage });
    } catch (error) {
      send({ type: "error", ...toErrorPayload(error) });
    }
    reply.raw.end();
  });

  // Sohbet geçmişi REST ile sorgulanır (PROTOKOL §1.1) — olay replay'i yok (ADR-011).
  app.get("/api/history/sessions", async (request) => {
    const rawLimit = Number((request.query as { limit?: string }).limit ?? 50);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 500) : 50;
    return { sessions: store.listSessions(limit) };
  });

  app.get("/api/history/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const detail = store.sessionDetail(id);
    if (detail === null) {
      return reply.code(404).send({
        code: "VALIDATION_SESSION_NOT_FOUND",
        message: `Oturum bulunamadı: ${id}`,
      });
    }
    return detail;
  });

  // ---- WebSocket ----

  const wss = new WebSocketServer({ noServer: true });

  app.server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws));
  });

  wss.on("connection", (ws: WebSocket) => {
    let authed = false;
    /** hello.client — permission.resolved.resolvedBy bu bilgiyle doldurulur. */
    let clientKind: "cli" | "desktop" | "web" = "cli";
    const helloTimer = setTimeout(() => {
      if (!authed) ws.close(4001, "hello zaman aşımı");
    }, 3000);

    const sendError = (error: ErrorPayload, replyTo: string | null = null): void => {
      ws.send(JSON.stringify(createMessage("error", error, replyTo)));
    };

    ws.on("close", () => {
      clearTimeout(helloTimer);
      bus.remove(ws);
    });

    ws.on("message", (raw) => {
      void (async () => {
        let input: unknown;
        try {
          input = JSON.parse(String(raw));
        } catch {
          sendError({ code: "VALIDATION_ENVELOPE", message: "Geçersiz JSON" });
          return;
        }
        const result = parseMessage(input);
        if (!result.ok) {
          sendError(result.error);
          return;
        }
        const message = result.message;

        if (!authed) {
          if (message.type !== "hello") {
            sendError({ code: "AUTH_HELLO_REQUIRED", message: "İlk mesaj hello olmalı" });
            ws.close(4002, "hello bekleniyor");
            return;
          }
          const hello = message.payload as RequestPayload<"hello">;
          if (hello.token !== token) {
            sendError({ code: "AUTH_TOKEN_INVALID", message: "Geçersiz token" }, message.id);
            ws.close(4003, "kimlik doğrulanamadı");
            return;
          }
          if (hello.protocolVersion !== PROTOCOL_VERSION) {
            sendError(
              {
                code: "AUTH_PROTOCOL_MISMATCH",
                message: `Daemon protokol v${PROTOCOL_VERSION}, istemci v${hello.protocolVersion} — istemciyi güncelle`,
              },
              message.id,
            );
            ws.close(4004, "protokol uyuşmazlığı");
            return;
          }
          authed = true;
          clientKind = hello.client;
          clearTimeout(helloTimer);
          bus.add(ws);
          bus.sendTo(
            ws,
            "hello.ok",
            {
              daemonVersion: DAEMON_VERSION,
              protocolVersion: PROTOCOL_VERSION,
              snapshot: await buildSnapshot(),
            },
            message.id,
          );
          // Son GPU örneğini anında ver (bir sonraki periyodik tik'i beklemesin).
          if (latestHardware !== null && latestHardware.gpus.length > 0) {
            bus.sendTo(ws, "hardware.updated", latestHardware);
          }
          return;
        }

        switch (message.type) {
          case "state.sync": {
            bus.sendTo(ws, "state.sync.ok", { snapshot: await buildSnapshot() }, message.id);
            return;
          }
          case "chat.start": {
            const payload = message.payload as RequestPayload<"chat.start">;
            const sessionId = payload.sessionId ?? randomUUID();
            bus.sendTo(ws, "chat.start.ok", { sessionId }, message.id);
            runChat(payload, sessionId).catch((error: unknown) => {
              sendError(toErrorPayload(error), message.id);
            });
            return;
          }
          case "chat.cancel": {
            const payload = message.payload as RequestPayload<"chat.cancel">;
            activeChats.get(payload.sessionId)?.abort();
            bus.sendTo(ws, "chat.cancel.ok", {}, message.id);
            return;
          }
          case "models.list": {
            const lists = await Promise.all([...providers.values()].map((p) => p.listModels()));
            bus.sendTo(ws, "models.list.ok", { models: lists.flat() }, message.id);
            return;
          }
          case "agents.list": {
            bus.sendTo(ws, "agents.list.ok", { agents: engine.listAgents() }, message.id);
            return;
          }
          case "agent.start": {
            const payload = message.payload as RequestPayload<"agent.start">;
            try {
              const { runId, sessionId } = await engine.start(payload);
              bus.sendTo(ws, "agent.start.ok", { runId, sessionId }, message.id);
            } catch (error) {
              // Beklenen doğrulama hataları (AGENT_UNKNOWN, PERMISSION_JAIL...) —
              // telemetriye değil, isteği yapana gider.
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "agent.cancel": {
            const payload = message.payload as RequestPayload<"agent.cancel">;
            try {
              engine.cancel(payload.runId);
              bus.sendTo(ws, "agent.cancel.ok", {}, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "agent.say": {
            // Konuşmalı koşunun sonraki turu (ADR-012) — motor awaiting_user dışında reddeder.
            const payload = message.payload as RequestPayload<"agent.say">;
            try {
              engine.say(payload);
              bus.sendTo(ws, "agent.say.ok", {}, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "permission.respond": {
            const payload = message.payload as RequestPayload<"permission.respond">;
            try {
              engine.respond(payload, clientKind);
              bus.sendTo(ws, "permission.respond.ok", {}, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          case "providers.status": {
            bus.sendTo(
              ws,
              "providers.status.ok",
              { providers: await providerStatuses() },
              message.id,
            );
            return;
          }
          case "usage.query": {
            const payload = message.payload as RequestPayload<"usage.query">;
            bus.sendTo(ws, "usage.query.ok", store.usageQuery(payload), message.id);
            return;
          }
          case "router.suggest": {
            const payload = message.payload as RequestPayload<"router.suggest">;
            const [models, vramGb] = await Promise.all([availableModels(), getVramGb()]);
            const suggestions = suggestModels(payload.task, payload.constraints, {
              models,
              vramGb,
            });
            if (suggestions.length === 0) {
              sendError(
                {
                  code: "PROVIDER_NONE_AVAILABLE",
                  message:
                    "Önerilecek model yok: hiçbir sağlayıcı yapılandırılmamış/erişilebilir değil " +
                    "ya da bütçe sınırı tüm seçenekleri eledi",
                },
                message.id,
              );
              return;
            }
            bus.sendTo(ws, "router.suggest.ok", { suggestions }, message.id);
            return;
          }
          case "mcp.addServer": {
            const payload = message.payload as RequestPayload<"mcp.addServer">;
            try {
              const tools = await registerMcpServer(paths.mcpServersFile, payload.name, {
                command: payload.command,
                args: payload.args,
              });
              bus.sendTo(ws, "mcp.addServer.ok", { name: payload.name, tools }, message.id);
            } catch (error) {
              sendError(toErrorPayload(error), message.id);
            }
            return;
          }
          default: {
            sendError(
              {
                code: "VALIDATION_NOT_IMPLEMENTED",
                message: `'${message.type}' bu fazda desteklenmiyor (bkz. ROADMAP.md)`,
              },
              message.id,
            );
          }
        }
      })().catch((error: unknown) => {
        // Buraya düşen her şey beklenmeyen daemon hatasıdır → telemetriye yaz.
        // (runChat kendi hatasını zaten kaydediyor; o yol buradan geçmez.)
        const errorPayload = toErrorPayload(error);
        store.recordTelemetry({
          scope: "ws.message",
          code: errorPayload.code,
          message: errorPayload.message,
          ...(error instanceof Error && error.stack !== undefined ? { stack: error.stack } : {}),
        });
        sendError(errorPayload);
      });
    });
  });

  await app.listen({ port, host: DAEMON_HOST });
  // Token dosyası ancak dinleme BAŞARILI olunca yazılır (tek-kopya kilidinin ikinci yarısı).
  persistDaemonToken(paths.daemonTokenFile, token);
  const address = app.server.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : port;
  log.info({ port: boundPort, protocolVersion: PROTOCOL_VERSION }, "symphonyd dinliyor");

  return {
    port: boundPort,
    token,
    close: async () => {
      if (hardwareTimer !== null) clearInterval(hardwareTimer);
      engine.cancelAll();
      for (const abort of activeChats.values()) abort.abort();
      // Açık istemci soketleri koparılmazsa app.close() sonsuza dek bekleyebilir.
      for (const client of wss.clients) client.terminate();
      wss.close();
      await app.close();
      store.close();
    },
  };
}

function makeError(code: string, message: string): Error {
  const error = new Error(message);
  error.name = code;
  return error;
}

/** Portta çalışan bir symphonyd var mı? Sağlık ucu authsuz olduğu için sondalanabilir. */
async function probeRunningDaemon(port: number): Promise<{ daemonVersion: string } | null> {
  try {
    const response = await fetch(`http://${DAEMON_HOST}:${port}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { ok?: boolean; daemonVersion?: string };
    return body.ok === true ? { daemonVersion: body.daemonVersion ?? "?" } : null;
  } catch {
    return null;
  }
}

function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof Error) {
    const code = /^(AUTH|PROVIDER|AGENT|PERMISSION|VALIDATION|INTERNAL)_[A-Z0-9_]+$/.test(
      error.name,
    )
      ? error.name
      : error.message.startsWith("PROVIDER_NOT_CONFIGURED")
        ? "PROVIDER_NOT_CONFIGURED"
        : "INTERNAL_ERROR";
    return { code, message: error.message };
  }
  return { code: "INTERNAL_ERROR", message: String(error) };
}
