import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { WebSocket } from "ws";
import { createMessage, PROTOCOL_VERSION, type Envelope } from "@symphony/shared";
import { DataStore } from "../db/store.js";
import { startDaemon, type RunningDaemon } from "./daemon.js";

const testHome = join(tmpdir(), `symphony-daemon-test-${Date.now()}`);
let daemon: RunningDaemon;
// Sahte Ollama: testler CI'da gerçek Ollama olmadan da deterministik koşar.
let fakeOllama: Server;

const SSE_CHUNKS = [
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{"role":"assistant","content":"Mer"},"finish_reason":null}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{"content":"haba"},"finish_reason":null}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}`,
];

// ADR-013 testi: sağlayıcıya GERÇEKTEN giden istek gövdesini denetlemek için son body'yi tutar.
let lastOllamaRequestBody = "";

beforeAll(async () => {
  fakeOllama = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        lastOllamaRequestBody = Buffer.concat(chunks).toString("utf8");
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const chunk of SSE_CHUNKS) res.write(`data: ${chunk}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => fakeOllama.listen(0, "127.0.0.1", resolve));
  const address = fakeOllama.address();
  const ollamaPort = typeof address === "object" && address !== null ? address.port : 0;
  daemon = await startDaemon({
    port: 0,
    home: testHome,
    ollamaBaseUrl: `http://127.0.0.1:${ollamaPort}`,
    sampleHardware: false, // gerçek nvidia-smi + periyodik yayın testleri bozar
  });
});

afterAll(async () => {
  await daemon.close();
  await new Promise<void>((resolve, reject) =>
    fakeOllama.close((err) => (err ? reject(err) : resolve())),
  );
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
    expect(payload.snapshot.providers.map((p) => p.provider)).toContain("ollama");

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

  it("router.suggest örnek göreve gerekçeli öneri verir (Faz 1 kabul testi)", async () => {
    const { reply, ws } = await roundTrip(
      createMessage("hello", {
        token: daemon.token,
        client: "cli",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    expect(reply.type).toBe("hello.ok");

    const suggestReply = await request(
      ws,
      createMessage("router.suggest", { task: "bu metni özetle" }),
    );
    expect(suggestReply.type).toBe("router.suggest.ok");
    const { suggestions } = suggestReply.payload as {
      suggestions: Array<{ provider: string; model: string; reason: string; local: boolean }>;
    };
    expect(suggestions.length).toBeGreaterThan(0);
    // Hızlı iş → yerel model önde (sahte Ollama'daki qwen3:8b) ve gerekçesi dolu
    expect(suggestions[0]).toMatchObject({ provider: "ollama", model: "qwen3:8b", local: true });
    expect(suggestions[0]?.reason).toContain("yerel");
    ws.close();
  });

  it("router.suggest v2 (ADR-016 Karar 1/2, Dilim Z1): geçmiş koşu kanıtı VARSA reason'a yazılır", async () => {
    // Aynı (provider, model, tür) için ≥MIN_SAMPLES tamamlanmış koşu SEED et — ayrı bir
    // DataStore ile aynı dosyayı aç (kabul testi deseni: satır ~380 "usage.query" testinde de
    // kullanılıyor). Görev metni bilerek üstteki testle AYNI ("bu metni özetle" → quick) —
    // v2'nin gerçekten O testin sonraki çağrısında devreye girdiğini göstermek için.
    const db = new DataStore(join(testHome, "data", "symphony.db"));
    try {
      for (let i = 0; i < 4; i++) {
        const id = crypto.randomUUID();
        db.createAgentRun({
          id,
          agentId: "asistan",
          task: "bu metni özetle",
          provider: "ollama",
          model: "qwen3:8b",
          cwd: testHome,
          startedAt: Date.now(),
        });
        db.finishAgentRun(id, {
          state: "completed",
          result: "özet",
          errorCode: null,
          usage: { inputTokens: 10, outputTokens: 5, costUsd: 0 },
          steps: 1,
        });
      }
    } finally {
      db.close();
    }

    const { reply, ws } = await roundTrip(
      createMessage("hello", {
        token: daemon.token,
        client: "cli",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    expect(reply.type).toBe("hello.ok");

    const suggestReply = await request(
      ws,
      createMessage("router.suggest", { task: "bu metni özetle" }),
    );
    const { suggestions } = suggestReply.payload as {
      suggestions: Array<{ provider: string; model: string; reason: string }>;
    };
    const local = suggestions.find((s) => s.provider === "ollama" && s.model === "qwen3:8b");
    expect(local?.reason).toContain("4 koşuda %100 başarı");
    ws.close();
  });

  it("tek-kopya kilidi: ikinci kopya reddedilir ve token dosyası EZİLMEZ", async () => {
    const tokenFile = join(testHome, "daemon.token");
    const tokenBefore = readFileSync(tokenFile, "utf8");
    expect(tokenBefore).toBe(daemon.token);

    // Aynı portta ikinci kopya: token dosyasına dokunmadan çökmeli (2026-07-03 dersi)
    await expect(startDaemon({ port: daemon.port, home: testHome })).rejects.toThrow(
      /zaten bir symphonyd çalışıyor/,
    );
    expect(readFileSync(tokenFile, "utf8")).toBe(tokenBefore);

    // Çalışan daemon hâlâ sağlıklı
    const res = await fetch(`http://127.0.0.1:${daemon.port}/api/health`);
    expect(res.status).toBe(200);
  });

  it("iki turlu sohbet TEK oturum olarak geçmişe yazılır; REST geçmiş uçları çalışır", async () => {
    const { reply, ws } = await roundTrip(
      createMessage("hello", {
        token: daemon.token,
        client: "cli",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    expect(reply.type).toBe("hello.ok");

    const sessionId = crypto.randomUUID();
    const runTurn = async (messages: Array<{ role: string; content: string }>): Promise<void> => {
      const completed = waitFor(
        ws,
        (env) =>
          env.type === "chat.completed" &&
          (env.payload as { sessionId: string }).sessionId === sessionId,
      );
      const ack = await request(
        ws,
        createMessage("chat.start", { sessionId, provider: "ollama", model: "qwen3:8b", messages }),
      );
      expect(ack.type).toBe("chat.start.ok");
      await completed;
    };

    await runTurn([{ role: "user", content: "merhaba" }]);
    await runTurn([
      { role: "user", content: "merhaba" },
      { role: "assistant", content: "Merhaba" },
      { role: "user", content: "nasılsın?" },
    ]);

    const auth = { headers: { authorization: `Bearer ${daemon.token}` } };
    const listRes = await fetch(`http://127.0.0.1:${daemon.port}/api/history/sessions`, auth);
    expect(listRes.status).toBe(200);
    const list = (await listRes.json()) as {
      sessions: Array<{ sessionId: string; title: string; messageCount: number }>;
    };
    const session = list.sessions.find((s) => s.sessionId === sessionId);
    expect(session).toMatchObject({ title: "merhaba", messageCount: 4 }); // tek oturum, replace

    const detailRes = await fetch(
      `http://127.0.0.1:${daemon.port}/api/history/sessions/${sessionId}`,
      auth,
    );
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(detail.messages.map((m) => m.content)).toEqual([
      "merhaba",
      "Merhaba",
      "nasılsın?",
      "Merhaba", // asistanın 2. tur cevabı (sahte Ollama hep "Merhaba" der)
    ]);

    // Bilinmeyen oturum 404; token'sız istek 401
    const missing = await fetch(
      `http://127.0.0.1:${daemon.port}/api/history/sessions/${crypto.randomUUID()}`,
      auth,
    );
    expect(missing.status).toBe(404);
    const unauthorized = await fetch(`http://127.0.0.1:${daemon.port}/api/history/sessions`);
    expect(unauthorized.status).toBe(401);
    ws.close();
  });

  it("kullanıcı profili (ADR-013, Dilim M2): auth'suz 401 · GET/PUT roundtrip", async () => {
    const unauthorizedGet = await fetch(`http://127.0.0.1:${daemon.port}/api/memory`);
    expect(unauthorizedGet.status).toBe(401);
    const unauthorizedPut = await fetch(`http://127.0.0.1:${daemon.port}/api/memory`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    });
    expect(unauthorizedPut.status).toBe(401);

    const auth = { headers: { authorization: `Bearer ${daemon.token}` } };
    // Bu daemon'ın home'unda henüz kimse dokunmadı → iskelet (ensureProfileScaffold, daemon açılışı).
    const scaffoldRes = await fetch(`http://127.0.0.1:${daemon.port}/api/memory`, auth);
    expect(scaffoldRes.status).toBe(200);
    const scaffold = (await scaffoldRes.json()) as {
      content: string;
      chars: number;
      truncated: boolean;
      updatedAt: number | null;
    };
    expect(scaffold.content).toContain("Kullanıcı Profili");
    expect(scaffold.chars).toBe(scaffold.content.length);
    expect(scaffold.truncated).toBe(false);
    expect(scaffold.updatedAt).not.toBeNull();

    const putRes = await fetch(`http://127.0.0.1:${daemon.port}/api/memory`, {
      method: "PUT",
      headers: { authorization: `Bearer ${daemon.token}`, "content-type": "application/json" },
      body: JSON.stringify({ content: "## Kimlik\nAdım Deniz.\n" }),
    });
    expect(putRes.status).toBe(200);
    const putBody = (await putRes.json()) as { content: string; chars: number };
    expect(putBody.content).toBe("## Kimlik\nAdım Deniz.\n");

    const afterGet = await fetch(`http://127.0.0.1:${daemon.port}/api/memory`, auth);
    const after = (await afterGet.json()) as { content: string };
    expect(after.content).toBe("## Kimlik\nAdım Deniz.\n"); // yazma kalıcı
  });

  it("yol haritası (ADR-015 Karar 3, Dilim P2): auth'suz 401 · dir eksikse 400 · yoksa 404 · varsa ayrıştırılmış cevap", async () => {
    const unauthorized = await fetch(`http://127.0.0.1:${daemon.port}/api/roadmap?dir=x`);
    expect(unauthorized.status).toBe(401);

    const auth = { headers: { authorization: `Bearer ${daemon.token}` } };

    const missingDir = await fetch(`http://127.0.0.1:${daemon.port}/api/roadmap`, auth);
    expect(missingDir.status).toBe(400);

    const emptyProjectDir = mkdtempSync(join(tmpdir(), "symphony-roadmap-test-empty-"));
    const notFound = await fetch(
      `http://127.0.0.1:${daemon.port}/api/roadmap?dir=${encodeURIComponent(emptyProjectDir)}`,
      auth,
    );
    expect(notFound.status).toBe(404);
    rmSync(emptyProjectDir, { recursive: true, force: true });

    const projectDir = mkdtempSync(join(tmpdir(), "symphony-roadmap-test-"));
    writeFileSync(
      join(projectDir, "ROADMAP.md"),
      "### Faz 0 — Temel Atma ✅ 2026-07-03\n- [x] adım bir\n\n### Faz 1 — Devam\n- [ ] adım iki\n",
      "utf8",
    );
    const res = await fetch(
      `http://127.0.0.1:${daemon.port}/api/roadmap?dir=${encodeURIComponent(projectDir)}`,
      auth,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      phases: { title: string; done: number; total: number; state: string }[];
    };
    expect(body.phases).toEqual([
      { title: "Faz 0 — Temel Atma ✅ 2026-07-03", done: 1, total: 1, state: "done" },
      { title: "Faz 1 — Devam", done: 0, total: 1, state: "todo" },
    ]);
    rmSync(projectDir, { recursive: true, force: true });
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
        provider: "yok-boyle-saglayici",
        model: "hayalet-model",
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
    expect(usage.rows.map((r) => r.key)).toContain("yok-boyle-saglayici");

    // Dosyaya gerçekten yazılmış mı? (kabul testi: her istek SQLite'a kayıt düşüyor)
    const db = new DataStore(join(testHome, "data", "symphony.db"));
    try {
      const failed = db
        .recentRequests()
        .find((r) => r.provider === "yok-boyle-saglayici" && r.model === "hayalet-model");
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

  it("ADR-013: kullanıcı profili sağlayıcıya giden isteğe eklenir ama kalıcı geçmişe GİRMEZ", async () => {
    const profileFile = join(testHome, "memory", "profil.md");
    writeFileSync(profileFile, "## Kimlik\nKullanıcının adı Deniz, TypeScript tercih eder.\n", "utf8");

    const { reply, ws } = await roundTrip(
      createMessage("hello", {
        token: daemon.token,
        client: "cli",
        protocolVersion: PROTOCOL_VERSION,
      }),
    );
    expect(reply.type).toBe("hello.ok");

    const sessionId = crypto.randomUUID();
    const completed = waitFor(
      ws,
      (env) =>
        env.type === "chat.completed" &&
        (env.payload as { sessionId: string }).sessionId === sessionId,
    );
    const ack = await request(
      ws,
      createMessage("chat.start", {
        sessionId,
        provider: "ollama",
        model: "qwen3:8b",
        messages: [{ role: "user", content: "beni tanıyor musun?" }],
      }),
    );
    expect(ack.type).toBe("chat.start.ok");
    await completed;

    // Sağlayıcıya giden GERÇEK istekte profil VAR.
    expect(lastOllamaRequestBody).toContain("Kullanıcının adı Deniz");

    // Kalıcı geçmişte (REST) profil YOK — yalnız kullanıcı/asistan metni.
    const auth = { headers: { authorization: `Bearer ${daemon.token}` } };
    const detailRes = await fetch(
      `http://127.0.0.1:${daemon.port}/api/history/sessions/${sessionId}`,
      auth,
    );
    const detail = (await detailRes.json()) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(detail.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(JSON.stringify(detail.messages)).not.toContain("Kullanıcının adı Deniz");

    ws.close();
  });
});
