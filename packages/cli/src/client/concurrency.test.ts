import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startDaemon, type RunningDaemon } from "@lrgendie/core";
import { DaemonClient } from "./daemon-client.js";
import { attachWatchOutput } from "../commands/watch.js";

/**
 * Faz 2 kabul testi: "aynı anda açık ikinci istemci aynı olayları görüyor".
 * İstemci A sohbeti başlatır; istemci B (watch aboneliğiyle) aynı delta ve
 * tamamlanma olaylarını daemon yayınından eş zamanlı alır (PROTOKOL §4).
 */
let home: string;
let daemon: RunningDaemon;
let fakeOllama: Server;

const SSE_CHUNKS = [
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{"role":"assistant","content":"Mer"},"finish_reason":null}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{"content":"haba"},"finish_reason":null}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}`,
];

beforeAll(async () => {
  fakeOllama = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      req.resume();
      req.on("end", () => {
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

  home = mkdtempSync(join(tmpdir(), "symphony-concurrency-test-"));
  daemon = await startDaemon({
    port: 0,
    home,
    ollamaBaseUrl: `http://127.0.0.1:${ollamaPort}`,
  });
});

afterAll(async () => {
  await daemon.close();
  await new Promise<void>((resolve, reject) =>
    fakeOllama.close((err) => (err ? reject(err) : resolve())),
  );
  rmSync(home, { recursive: true, force: true });
});

async function openClient(): Promise<DaemonClient> {
  const client = new DaemonClient({ port: daemon.port, token: daemon.token, reconnect: false });
  await client.open();
  return client;
}

describe("ikinci istemci eş zamanlılığı", () => {
  it("A'nın başlattığı sohbetin delta ve tamamlanma olaylarını B de görür", async () => {
    const clientA = await openClient();
    const clientB = await openClient();
    try {
      const seenByB: Array<{ type: string; sessionId: string; text?: string }> = [];
      clientB.on("chat.delta", ({ sessionId, text }) => {
        seenByB.push({ type: "delta", sessionId, text });
      });
      const completedAtB = new Promise<{ sessionId: string }>((resolve) => {
        clientB.on("chat.completed", (payload) => {
          seenByB.push({ type: "completed", sessionId: payload.sessionId });
          resolve(payload);
        });
      });

      const deltasAtA: string[] = [];
      const usage = await clientA.chat(
        {
          provider: "ollama",
          model: "qwen3:8b",
          messages: [{ role: "user", content: "selam" }],
        },
        (text) => deltasAtA.push(text),
      );
      await completedAtB;

      // A kendi akışını gördü; B aynı oturumun AYNI olaylarını yayından aldı
      expect(deltasAtA.join("")).toBe("Merhaba");
      expect(usage).toEqual({ inputTokens: 7, outputTokens: 2, costUsd: 0 });
      const deltaTextAtB = seenByB
        .filter((e) => e.type === "delta")
        .map((e) => e.text)
        .join("");
      expect(deltaTextAtB).toBe("Merhaba");
      const sessionIds = new Set(seenByB.map((e) => e.sessionId));
      expect(sessionIds.size).toBe(1);
    } finally {
      clientA.close();
      clientB.close();
    }
  });

  it("watch aboneliği akışı okunur biçimde yazar ve abonelikten çıkabilir", async () => {
    const clientA = await openClient();
    const clientB = await openClient();
    try {
      let output = "";
      const detach = attachWatchOutput(clientB, (text) => (output += text));

      const completedAtB = new Promise<void>((resolve) => {
        clientB.on("chat.completed", () => resolve());
      });
      await clientA.chat(
        {
          provider: "ollama",
          model: "qwen3:8b",
          messages: [{ role: "user", content: "selam" }],
        },
        () => undefined,
      );
      await completedAtB;

      expect(output).toContain("▶ sohbet");
      expect(output).toContain("Merhaba");
      expect(output).toContain("token");
      expect(output).toContain("ollama/qwen3:8b"); // usage.updated toplam satırı

      // Abonelikten çıkınca yeni olay yazılmaz
      detach();
      const before = output;
      const completedAgain = new Promise<void>((resolve) => {
        clientB.on("chat.completed", () => resolve());
      });
      await clientA.chat(
        {
          provider: "ollama",
          model: "qwen3:8b",
          messages: [{ role: "user", content: "tekrar" }],
        },
        () => undefined,
      );
      await completedAgain;
      expect(output).toBe(before);
    } finally {
      clientA.close();
      clientB.close();
    }
  });
});
