import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { createMessage, PROTOCOL_VERSION, type Envelope } from "@symphony/shared";
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
});
