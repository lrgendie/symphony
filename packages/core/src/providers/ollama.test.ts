import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { OllamaAdapter } from "./ollama.js";

/**
 * Sahte Ollama: gerçek sunucu/model gerektirmeden adapter'ı uçtan uca test eder
 * (CI'da Ollama yok). /api/tags ve OpenAI-uyumlu /v1/chat/completions taklit edilir.
 */
let server: Server;
let baseUrl: string;
const chatBodies: Array<Record<string, unknown>> = [];

const SSE_CHUNKS = [
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{"role":"assistant","content":"Mer"},"finish_reason":null}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{"content":"haba"},"finish_reason":null}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}`,
  `{"id":"c1","object":"chat.completion.chunk","created":1,"model":"qwen3:8b","choices":[],"usage":{"prompt_tokens":7,"completion_tokens":2,"total_tokens":9}}`,
];

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/api/tags") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ models: [{ name: "qwen3:8b" }, { name: "llama3.1:8b" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/v1/chat/completions") {
      let raw = "";
      req.on("data", (chunk: Buffer) => (raw += String(chunk)));
      req.on("end", () => {
        chatBodies.push(JSON.parse(raw) as Record<string, unknown>);
        res.writeHead(200, { "content-type": "text/event-stream" });
        for (const chunk of SSE_CHUNKS) res.write(`data: ${chunk}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      });
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) throw new Error("port alınamadı");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

describe("OllamaAdapter", () => {
  it("listModels /api/tags'ten dinamik listeyi ModelInfo'ya çevirir", async () => {
    const adapter = new OllamaAdapter(baseUrl);
    const models = await adapter.listModels();
    expect(models).toEqual([
      { provider: "ollama", id: "qwen3:8b", displayName: "qwen3:8b", local: true },
      { provider: "ollama", id: "llama3.1:8b", displayName: "llama3.1:8b", local: true },
    ]);
    expect(await adapter.isConfigured()).toBe(true);
  });

  it("sunucu yoksa: isConfigured=false, listModels=[] (hata fırlatmaz)", async () => {
    // Az önce kapatılmış ephemeral port = kesin ulaşılamaz adres
    const dead = createServer();
    await new Promise<void>((resolve) => dead.listen(0, "127.0.0.1", resolve));
    const address = dead.address();
    const deadPort = typeof address === "object" && address !== null ? address.port : 1;
    await new Promise<void>((resolve) => dead.close(() => resolve()));

    const adapter = new OllamaAdapter(`http://127.0.0.1:${deadPort}`);
    expect(await adapter.isConfigured()).toBe(false);
    expect(await adapter.listModels()).toEqual([]);
  });

  it("streamChat delta'ları akıtır, kullanım döndürür, maliyet 0 (yerel)", async () => {
    const adapter = new OllamaAdapter(baseUrl);
    const stream = adapter.streamChat({
      model: "qwen3:8b",
      messages: [{ role: "user", content: "selam" }],
      temperature: 0,
    });

    const chunks: string[] = [];
    let usage;
    for (;;) {
      const next = await stream.next();
      if (next.done) {
        usage = next.value;
        break;
      }
      chunks.push(next.value);
    }

    expect(chunks.join("")).toBe("Merhaba");
    expect(usage).toEqual({ inputTokens: 7, outputTokens: 2, costUsd: 0 });

    // ADR-008: Ollama sampling destekler → temperature=0 API'ye GİTMELİ
    const body = chatBodies.at(-1);
    expect(body?.["model"]).toBe("qwen3:8b");
    expect(body?.["temperature"]).toBe(0);
    expect(body?.["stream"]).toBe(true);
  });
});
