import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { MockLanguageModelV3 } from "ai/test";
import { createMessage, PROTOCOL_VERSION, type Envelope, type ModelInfo } from "@symphony/shared";
import type { ChatStreamRequest, ChatUsageResult, ProviderAdapter } from "../providers/types.js";
import { loadMcpServerConfigs } from "../agent/mcp.js";
import { startDaemon, type RunningDaemon } from "./daemon.js";

const echoFixture = fileURLToPath(
  new URL("../agent/__fixtures__/echo-mcp-server.mjs", import.meta.url),
);

/**
 * Uçtan uca (WS) agent akışı: agent.start → agent.tool.requested →
 * permission.respond(allow) → agent.run.completed. Terminal ⇄ masaüstü
 * eş zamanlılığının agent ayağı: olaylar yayın, izin cevabı tek kapı.
 */

const base = join(tmpdir(), `symphony-agent-ws-test-${Date.now()}`);
const home = join(base, "home");
const workspace = join(base, "ws");
let daemon: RunningDaemon;

type GenerateResult = Awaited<ReturnType<MockLanguageModelV3["doGenerate"]>>;

const script: GenerateResult[] = [
  {
    finishReason: { unified: "tool-calls" },
    usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
    content: [
      {
        type: "tool-call",
        toolCallId: "c1",
        toolName: "write_file",
        input: JSON.stringify({ path: "cikti.txt", content: "agent yazdı\n" }),
      },
    ],
    warnings: [],
  },
  {
    finishReason: { unified: "stop" },
    usage: { inputTokens: { total: 5 }, outputTokens: { total: 3 } },
    content: [{ type: "text", text: "dosyayı yazdım" }],
    warnings: [],
  },
] as unknown as GenerateResult[];

class FakeAdapter implements ProviderAdapter {
  readonly name = "fake";
  readonly forwardsTemperature = true;

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
          const next = script.shift();
          if (next === undefined) throw new Error("senaryo bitti");
          return Promise.resolve(next);
        },
      }),
    );
  }

  async *streamChat(_request: ChatStreamRequest): AsyncGenerator<string, ChatUsageResult, void> {
    throw new Error("kapsam dışı");
  }
}

beforeAll(async () => {
  mkdirSync(join(home, "agents"), { recursive: true });
  mkdirSync(workspace, { recursive: true });
  writeFileSync(
    join(home, "agents", "testci.md"),
    `---\nname: testci\ndescription: ws test\nprovider: fake\nmodel: fake-1\n---\nTest.`,
    "utf8",
  );
  daemon = await startDaemon({ port: 0, home, testProviders: [new FakeAdapter()] });
});

afterAll(async () => {
  await daemon.close();
  rmSync(base, { recursive: true, force: true });
});

interface Client {
  ws: WebSocket;
  /** Gelen TÜM zarflar — olay, waiter takılmadan önce gelse de kaybolmaz (yarış yok). */
  received: Envelope[];
}

function connect(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/ws`);
    const client: Client = { ws, received: [] };
    ws.on("message", (raw) => client.received.push(JSON.parse(String(raw)) as Envelope));
    ws.on("open", () => {
      ws.send(
        JSON.stringify(
          createMessage("hello", {
            token: daemon.token,
            client: "cli",
            protocolVersion: PROTOCOL_VERSION,
          }),
        ),
      );
    });
    ws.once("message", () => resolve(client)); // hello.ok
    ws.once("error", reject);
  });
}

async function waitFor(client: Client, predicate: (env: Envelope) => boolean): Promise<Envelope> {
  const deadline = Date.now() + 8000;
  let cursor = 0;
  while (Date.now() < deadline) {
    for (; cursor < client.received.length; cursor++) {
      const env = client.received[cursor];
      if (env !== undefined && predicate(env)) return env;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("olay zamanında gelmedi");
}

describe("daemon agent akışı (PROTOKOL §8 örneği)", () => {
  it("agents.list varsayılan coder + testci döndürür", async () => {
    const client = await connect();
    client.ws.send(JSON.stringify(createMessage("agents.list", {})));
    const reply = await waitFor(client, (env) => env.type === "agents.list.ok");
    const agents = (reply.payload as { agents: Array<{ id: string }> }).agents;
    const ids = agents.map((a) => a.id);
    expect(ids).toContain("coder"); // daemon açılışta varsayılanı ekti
    expect(ids).toContain("testci");
    client.ws.close();
  });

  it("start → izin iste → allow → completed; snapshot bekleyen izni gösterir", async () => {
    const client = await connect();

    client.ws.send(
      JSON.stringify(
        createMessage("agent.start", {
          agentId: "testci",
          task: "dosya yaz",
          cwd: workspace,
        }),
      ),
    );
    const startOk = await waitFor(client, (env) => env.type === "agent.start.ok");
    const runId = (startOk.payload as { runId: string }).runId;

    const requested = (await waitFor(client, (env) => env.type === "agent.tool.requested"))
      .payload as { requestId: string; diff?: string };
    expect(requested.diff).toContain("+agent yazdı");
    expect(existsSync(join(workspace, "cikti.txt"))).toBe(false); // onay öncesi yazılmadı

    // Yeniden bağlanan istemci bekleyen izni snapshot'tan görür (PROTOKOL §6)
    client.ws.send(JSON.stringify(createMessage("state.sync", {})));
    const sync = await waitFor(client, (env) => env.type === "state.sync.ok");
    const snapshot = (
      sync.payload as {
        snapshot: { runs: unknown[]; pendingPermissions: Array<{ requestId: string }> };
      }
    ).snapshot;
    expect(snapshot.runs).toHaveLength(1);
    expect(snapshot.pendingPermissions[0]?.requestId).toBe(requested.requestId);

    client.ws.send(
      JSON.stringify(
        createMessage("permission.respond", {
          requestId: requested.requestId,
          decision: "allow",
        }),
      ),
    );
    const completed = await waitFor(client, (env) => env.type === "agent.run.completed");
    const done = completed.payload as { runId: string; result: string };
    expect(done.runId).toBe(runId);
    expect(done.result).toContain("yazdım");
    expect(readFileSync(join(workspace, "cikti.txt"), "utf8")).toBe("agent yazdı\n");
    client.ws.close();
  }, 15_000);

  it("bilinmeyen koşu iptali AGENT_UNKNOWN_RUN hatası döndürür", async () => {
    const client = await connect();
    client.ws.send(
      JSON.stringify(
        createMessage("agent.cancel", { runId: "11111111-1111-4111-8111-111111111111" }),
      ),
    );
    const reply = await waitFor(client, (env) => env.type === "error");
    expect((reply.payload as { code: string }).code).toBe("AGENT_UNKNOWN_RUN");
    client.ws.close();
  });

  it("mcp.addServer: gerçek sunucuya bağlanıp doğrular ve mcp-servers.json'a kaydeder", async () => {
    const client = await connect();
    client.ws.send(
      JSON.stringify(
        createMessage("mcp.addServer", {
          name: "echo-test",
          command: process.execPath,
          args: [echoFixture],
        }),
      ),
    );
    const reply = await waitFor(
      client,
      (env) => env.type === "mcp.addServer.ok" || env.type === "error",
    );
    expect(reply.type).toBe("mcp.addServer.ok");
    const payload = reply.payload as { name: string; tools: string[] };
    expect(payload.name).toBe("echo-test");
    expect(payload.tools).toEqual(["echo"]);
    expect(loadMcpServerConfigs(join(home, "mcp-servers.json"))["echo-test"]).toEqual({
      command: process.execPath,
      args: [echoFixture],
    });
    client.ws.close();
  }, 15_000);
});
