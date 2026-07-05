import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { z } from "zod";
import type { ToolContext } from "./tools.js";
import {
  connectMcpServers,
  loadMcpServerConfigs,
  registerMcpServer,
  wrapMcpTool,
  type McpCallToolFn,
} from "./mcp.js";

const echoFixture = fileURLToPath(new URL("./__fixtures__/echo-mcp-server.mjs", import.meta.url));

/**
 * MCP istemcisi testleri (ADR-007, SPEC-AGENT §2). `wrapMcpTool` sahte `callTool`
 * ile test edilir (SDK'yı mock'lamadan); alt bölümde gerçek `Client`+`McpServer`
 * çifti `InMemoryTransport` üzerinden konuşturularak sarmalamanın gerçek protokol
 * cevaplarını doğru yorumladığı kanıtlanır — hiçbir alt süreç başlatılmaz.
 */

const base = join(tmpdir(), `symphony-mcp-test-${Date.now()}`);
const fakeCtx = {} as ToolContext;

const descriptor = {
  name: "read_text_file",
  description: "Bir dosyayı okur.",
  inputSchema: { type: "object" as const, properties: { path: { type: "string" } } },
};

describe("loadMcpServerConfigs", () => {
  it("dosya yoksa boş nesne döner", () => {
    expect(loadMcpServerConfigs(join(base, "hic-yok.json"))).toEqual({});
  });

  it("geçerli dosyayı ayrıştırır", () => {
    mkdirSync(base, { recursive: true });
    const file = join(base, "mcp-servers.json");
    writeFileSync(
      file,
      JSON.stringify({
        servers: { filesystem: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem"] } },
      }),
      "utf8",
    );
    expect(loadMcpServerConfigs(file)["filesystem"]).toEqual({
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem"],
    });
  });
});

describe("wrapMcpTool", () => {
  it("adı mcp__<sunucu>__<araç> biçiminde kurar, risk sınıfı her zaman mutating'dir", () => {
    const spec = wrapMcpTool("filesystem", descriptor, () =>
      Promise.resolve({ content: [{ type: "text", text: "ok" }] }),
    );
    expect(spec.name).toBe("mcp__filesystem__read_text_file");
    expect(spec.riskClass({})).toBe("mutating");
  });

  it("başarılı çağrıda content metinlerini birleştirip döner ve doğru argümanla çağırır", async () => {
    const calls: unknown[] = [];
    const callTool: McpCallToolFn = (params) => {
      calls.push(params);
      return Promise.resolve({
        content: [
          { type: "text", text: "satır1" },
          { type: "text", text: "satır2" },
        ],
      });
    };
    const spec = wrapMcpTool("filesystem", descriptor, callTool);
    const result = await spec.execute({ path: "a.txt" }, fakeCtx, new AbortController().signal);
    expect(result).toBe("satır1\nsatır2");
    expect(calls).toEqual([{ name: "read_text_file", arguments: { path: "a.txt" } }]);
  });

  it("content boşsa structuredContent'i JSON olarak döner", async () => {
    const spec = wrapMcpTool("filesystem", descriptor, () =>
      Promise.resolve({ structuredContent: { count: 3 } }),
    );
    const result = await spec.execute({}, fakeCtx, new AbortController().signal);
    expect(result).toBe(JSON.stringify({ count: 3 }));
  });

  it("isError: true → AGENT_MCP_TOOL_ERROR fırlatır", async () => {
    const spec = wrapMcpTool("filesystem", descriptor, () =>
      Promise.resolve({ isError: true, content: [{ type: "text", text: "dosya yok" }] }),
    );
    await expect(
      spec.execute({}, fakeCtx, new AbortController().signal),
    ).rejects.toMatchObject({ name: "AGENT_MCP_TOOL_ERROR", message: "dosya yok" });
  });
});

describe("connectMcpServers", () => {
  it("sunucu listesi boşsa hiç bağlanmaz", async () => {
    expect(await connectMcpServers(join(base, "hic-yok.json"), [])).toEqual([]);
  });

  it("tanımsız sunucu adı → AGENT_MCP_SERVER_UNKNOWN", async () => {
    const file = join(base, "empty-mcp-servers.json");
    writeFileSync(file, JSON.stringify({ servers: {} }), "utf8");
    await expect(connectMcpServers(file, ["yok-boyle"])).rejects.toMatchObject({
      name: "AGENT_MCP_SERVER_UNKNOWN",
    });
  });

  it("bağlanamayan komut → AGENT_MCP_CONNECT_FAILED", async () => {
    const file = join(base, "bad-mcp-servers.json");
    writeFileSync(
      file,
      JSON.stringify({ servers: { bozuk: { command: "symphony-test-olmayan-komut-xyz" } } }),
      "utf8",
    );
    await expect(connectMcpServers(file, ["bozuk"])).rejects.toMatchObject({
      name: "AGENT_MCP_CONNECT_FAILED",
    });
  }, 10_000);
});

describe("registerMcpServer (symphony add, gerçek stdio alt süreç)", () => {
  it("başarılı bağlantıda kayıt defterine yazar ve HAM araç adlarını döner", async () => {
    const file = join(base, "register-success.json");
    const toolNames = await registerMcpServer(file, "echo-server", {
      command: process.execPath,
      args: [echoFixture],
    });
    expect(toolNames).toEqual(["echo"]);
    expect(loadMcpServerConfigs(file)["echo-server"]).toEqual({
      command: process.execPath,
      args: [echoFixture],
    });
  }, 15_000);

  it("bağlantı başarısızsa kayıt defterine hiç yazmaz", async () => {
    const file = join(base, "register-fail.json");
    await expect(
      registerMcpServer(file, "bozuk", { command: "symphony-test-olmayan-komut-xyz", args: [] }),
    ).rejects.toMatchObject({ name: "AGENT_MCP_CONNECT_FAILED" });
    expect(existsSync(file)).toBe(false);
  }, 15_000);

  it("var olan kayıt defterine EKLER, diğer sunucuları silmez", async () => {
    const file = join(base, "register-merge.json");
    writeFileSync(
      file,
      JSON.stringify({ servers: { onceki: { command: "npx", args: ["-y", "onceki-paket"] } } }),
      "utf8",
    );
    await registerMcpServer(file, "echo-server", { command: process.execPath, args: [echoFixture] });
    const configs = loadMcpServerConfigs(file);
    expect(Object.keys(configs).sort()).toEqual(["echo-server", "onceki"]);
  }, 15_000);
});

describe("gerçek MCP protokolü uçtan uca (in-memory transport, alt süreç yok)", () => {
  it("McpServer'ın kaydettiği araç listTools + callTool ile doğru sarmalanır", async () => {
    const server = new McpServer({ name: "test-server", version: "1.0.0" });
    server.registerTool(
      "echo",
      { description: "Girdiyi geri döndürür.", inputSchema: { text: z.string() } },
      ({ text }) => Promise.resolve({ content: [{ type: "text" as const, text: `yankı: ${text}` }] }),
    );

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test-client", version: "1.0.0" });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    try {
      const { tools } = await client.listTools();
      expect(tools).toHaveLength(1);

      const callTool: McpCallToolFn = (params, signal) =>
        client.callTool({ name: params.name, arguments: params.arguments }, undefined, { signal });
      const spec = wrapMcpTool("mem", tools[0]!, callTool);
      const result = await spec.execute({ text: "merhaba" }, fakeCtx, new AbortController().signal);
      expect(result).toBe("yankı: merhaba");
    } finally {
      await client.close();
      await server.close();
    }
  });
});
