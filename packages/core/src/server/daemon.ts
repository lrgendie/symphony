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
import { detectVramGb } from "../router/hardware.js";
import { suggestModels } from "../router/router.js";
import { EventBus } from "./bus.js";
import { generateDaemonToken, persistDaemonToken } from "./token.js";

export const DAEMON_VERSION = "0.1.0";

export interface DaemonOptions {
  /** Test/geliştirme: 0 verilirse boş bir port seçilir. */
  port?: number;
  /** Test: `~/.symphony` yerine kullanılacak dizin. */
  home?: string;
  /** Test: sahte Ollama sunucusuna yönlendirme. Varsayılan: http://127.0.0.1:11434 */
  ollamaBaseUrl?: string;
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

  const token = generateDaemonToken();
  const log = pino({ name: "symphonyd" });

  const secrets = await createSecretStore();
  const store = new DataStore(paths.databaseFile);
  const providers = new Map<string, ProviderAdapter>();
  for (const adapter of [
    new AnthropicAdapter(secrets),
    new OpenAIAdapter(secrets),
    new GoogleAdapter(secrets),
    new OllamaAdapter(options.ollamaBaseUrl),
  ]) {
    providers.set(adapter.name, adapter);
  }

  const bus = new EventBus();
  const activeChats = new Map<string, AbortController>();

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

  async function buildSnapshot(): Promise<Snapshot> {
    return { runs: [], providers: await providerStatuses(), pendingPermissions: [] };
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
      const stream = provider.streamChat({
        model: payload.model,
        messages: payload.messages,
        temperature: payload.options.temperature,
        ...(payload.options.maxTokens !== undefined
          ? { maxTokens: payload.options.maxTokens }
          : {}),
        abortSignal: abort.signal,
      });
      let usageResult;
      for (;;) {
        const next = await stream.next();
        if (next.done) {
          usageResult = next.value;
          break;
        }
        bus.broadcast("chat.delta", { sessionId, text: next.value });
        onDelta?.(next.value);
      }
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
      bus.broadcast("chat.completed", { sessionId, usage });
      bus.broadcast("usage.updated", {
        provider: payload.provider,
        model: payload.model,
        deltaTokens: usage.inputTokens + usage.outputTokens,
        deltaCostUsd: usage.costUsd,
        totals: store.usageTotals(payload.provider, payload.model),
      });
      log.info({ sessionId, model: payload.model, ...usage }, "sohbet tamamlandı");
      return usage;
    } catch (error) {
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
