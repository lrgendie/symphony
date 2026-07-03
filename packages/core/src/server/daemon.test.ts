import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { createMessage, PROTOCOL_VERSION, type Envelope } from "@symphony/shared";
import { DataStore } from "../db/store.js";
import { startDaemon, type RunningDaemon } from "./daemon.js";

const testHome = join(tmpdir(), `symphony-daemon-test-${Date.now()}`);
let daemon: RunningDaemon;

beforeAll(async () => {
  daemon = await startDaemon({ port: 0, home: testHome });
});

afterAll(async () => {
  await daemon.close();
  rmSync(testHome, { recursive: true, force: true });
});

/** WS aç, mesajı gönder, ilk cevabı bekle. */
function roundTrip(send: Envelope): Promise<{ reply: Envelope; ws: WebSocket }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`);
    ws.on("open", () => ws.send(JSON.stringify(send)));
    ws.on("message", (raw) => resolve({ reply: JSON.parse(String(raw)) as Envelope, ws }));
    ws.on("error", reject);
  });
}

function request(ws: WebSocket, send: Envelope): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    ws.once("message", (raw) => resolve(JSON.parse(String(raw)) as Envelope));
    ws.once("error", reject);
    ws.send(JSON.stringify(send));
  });
}

/** Koşulu sağlayan ilk mesajı bekler (aradaki diğer olayları atlar). */
function waitFor(ws: WebSocket, predicate: (env: Envelope) => boolean): Promise<Envelope> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: unknown): void => {
      const env = JSON.parse(String(raw)) as Envelope;
      if (predicate(env)) {
        ws.off("message", onMessage);
        resolve(env);
      }
    };
    ws.on("message", onMessage);
    ws.once("error", reject);
  });
}

describe("symphonyd", () => {
  it("sağlık ucu token istemez ve protokol sürümünü bildirir", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/api/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; protocolVersion: number };
    expect(body.ok).toBe(true);
    expect(body.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  it("REST, token'sız isteği 401 ile reddeder", async () => {
    const res = await fetch(`http://127.0.0.1:${daemon.port}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("yanlış token'lı hello reddedilir", async () => {
    const { reply, ws } = await roundTrip(
      createMessage("hello", {
        token: "sahte-token",
        client: "cli",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    expect(reply.type).toBe("error");
    expect((reply.payload as { code: string }).code).toBe("AUTH_TOKEN_INVALID");
    ws.close();
  });

  it("doğru hello → hello.ok + snapshot; ardından models.list çalışır", async () => {
    const hello = createMessage("hello", {
      token: daemon.token,
      client: "cli",
      protocolVersion: PROTOCOL_VERSION,
    });
    const { reply, ws } = await roundTrip(hello);
    expect(reply.type).toBe("hello.ok");
    expect(reply.replyTo).toBe(hello.id);
    const payload = reply.payload as {
      protocolVersion: number;
      snapshot: { providers: Array<{ provider: string }> };
    };
    expect(payload.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(payload.snapshot.providers.map((p) => p.provider)).toContain("anthropic");

    const modelsReply = await request(ws, createMessage("models.list", {}));
    expect(modelsReply.type).toBe("models.list.ok");
    const models = (modelsReply.payload as { models: Array<{ id: string }> }).models;
    expect(models.map((m) => m.id)).toContain("claude-opus-4-8");
    ws.close();
  });

  it("hello'suz istek bağlantıyı düşürür", async () => {
    const { reply, ws } = await roundTrip(createMessage("models.list", {}));
    expect(reply.type).toBe("error");
    expect((reply.payload as { code: string }).code).toBe("AUTH_HELLO_REQUIRED");
    await new Promise<void>((resolve) => ws.once("close", () => resolve()));
  });

  it("başarısız sohbet SQLite'a istek kaydı + telemetri düşürür; usage.query cevaplar", async () => {
    const { reply, ws } = await roundTrip(
      createMessage("hello", {
        token: daemon.token,
        client: "cli",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    expect(reply.type).toBe("hello.ok");

    // Kayıtlı olmayan sağlayıcı → PROVIDER_UNKNOWN (gerçek API'ye dokunmadan hata yolu)
    const errorReply = waitFor(ws, (env) => env.type === "error");
    const ack = await request(
      ws,
      createMessage("chat.start", {
        provider: "openai",
        model: "gpt-test",
        messages: [{ role: "user", content: "merhaba" }],
      }),
    );
    expect(ack.type).toBe("chat.start.ok");
    expect(((await errorReply).payload as { code: string }).code).toBe("PROVIDER_UNKNOWN");

    // usage.query protokol üzerinden cevap veriyor ve kayıt görünüyor
    const usageReply = await request(ws, createMessage("usage.query", { groupBy: "provider" }));
    expect(usageReply.type).toBe("usage.query.ok");
    const usage = usageReply.payload as {
      rows: Array<{ key: string }>;
      totals: { inputTokens: number };
    };
    expect(usage.rows.map((r) => r.key)).toContain("openai");

    // Dosyaya gerçekten yazılmış mı? (kabul testi: her istek SQLite'a kayıt düşüyor)
    const db = new DataStore(join(testHome, "data", "symphony.db"));
    try {
      const failed = db
        .recentRequests()
        .find((r) => r.provider === "openai" && r.model === "gpt-test");
      expect(failed?.status).toBe("error");
      expect(failed?.errorCode).toBe("PROVIDER_UNKNOWN");
      const telemetry = db.recentTelemetry();
      expect(telemetry.some((t) => t.scope === "chat" && t.code === "PROVIDER_UNKNOWN")).toBe(true);
      // Telemetri girdi ÖZETİ taşır, ham mesaj içeriği taşımaz
      const entry = telemetry.find((t) => t.scope === "chat");
      expect(entry?.context?.["messageCount"]).toBe(1);
      expect(JSON.stringify(entry?.context)).not.toContain("merhaba");
    } finally {
      db.close();
    }
    ws.close();
  });
});
