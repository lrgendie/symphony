import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { DaemonClient } from "../client/daemon-client.js";
import { AgentRun } from "./agent-run.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const RUN_ID = "11111111-1111-4111-8111-111111111111";

interface FakeClient {
  client: DaemonClient;
  requests: Array<{ type: string; payload: unknown }>;
  emit: (type: string, payload: unknown) => void;
}

/** Gerçek DaemonClient'ın on/request'ini taklit eder — olayları elle tetikleyebiliriz. */
function fakeClient(startResolves = true): FakeClient {
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const requests: Array<{ type: string; payload: unknown }> = [];
  const client = {
    on(type: string, handler: (payload: unknown) => void) {
      const set = listeners.get(type) ?? new Set();
      set.add(handler);
      listeners.set(type, set);
      return () => set.delete(handler);
    },
    request(type: string, payload: unknown) {
      requests.push({ type, payload });
      if (type === "agent.start") {
        return startResolves
          ? Promise.resolve({ runId: RUN_ID })
          : Promise.reject(new Error("AGENT_UNKNOWN: bilinmeyen agent"));
      }
      return Promise.resolve({});
    },
  } as unknown as DaemonClient;
  return {
    client,
    requests,
    emit: (type, payload) => {
      for (const handler of listeners.get(type) ?? new Set()) handler(payload);
    },
  };
}

describe("AgentRun (TUI agent modu)", () => {
  it("görev girilip Enter'a basılınca agent.start gönderir", async () => {
    const fake = fakeClient();
    const { stdin } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" />);
    await tick();
    stdin.write("bug'ı düzelt");
    await tick();
    stdin.write("\r");
    await tick();
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toEqual({
      type: "agent.start",
      payload: { agentId: "coder", task: "bug'ı düzelt", cwd: "/ws" },
    });
  });

  it("agent.tool.requested → izin kutusu render eder (risk sınıfı + diff renkli)", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" />);
    await tick();
    stdin.write("dosya yaz");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.tool.requested", {
      runId: RUN_ID,
      requestId: "22222222-2222-4222-8222-222222222222",
      tool: "write_file",
      args: { path: "a.txt" },
      riskClass: "mutating",
      diff: "--- a.txt\n+++ a.txt\n+yeni satır",
    });
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("izin isteği: write_file");
    expect(frame).toContain("mutating");
    expect(frame).toContain("+yeni satır");
    expect(frame).toContain("[d]aima izin ver");
  });

  it("'e' tuşu → permission.respond allow gönderir, kutu kapanır", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" />);
    await tick();
    stdin.write("dosya yaz");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.tool.requested", {
      runId: RUN_ID,
      requestId: "req-1",
      tool: "write_file",
      args: {},
      riskClass: "mutating",
    });
    await tick();

    stdin.write("e");
    await tick();

    const respond = fake.requests.find((r) => r.type === "permission.respond");
    expect(respond?.payload).toEqual({ requestId: "req-1", decision: "allow" });
    expect(lastFrame()).not.toContain("izin isteği");
  });

  it("destructive risk sınıfında 'daima' seçeneği sunulmaz", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" />);
    await tick();
    stdin.write("sil");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.tool.requested", {
      runId: RUN_ID,
      requestId: "req-destructive",
      tool: "run_command",
      args: { command: "rm -rf x" },
      riskClass: "destructive",
    });
    await tick();

    expect(lastFrame()).not.toContain("daima izin ver");

    stdin.write("d"); // her ihtimale karşı: destructive'de 'd' hiçbir şey yapmamalı
    await tick();
    expect(fake.requests.some((r) => r.type === "permission.respond")).toBe(false);

    stdin.write("h");
    await tick();
    const respond = fake.requests.find((r) => r.type === "permission.respond");
    expect(respond?.payload).toEqual({ requestId: "req-destructive", decision: "deny" });
  });

  it("agent.run.completed → sonuç ve token/maliyet satırını gösterir", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" />);
    await tick();
    stdin.write("özet çıkar");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.run.completed", {
      runId: RUN_ID,
      result: "özet: her şey yolunda",
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.001 },
    });
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("koşu tamamlandı");
    expect(frame).toContain("özet: her şey yolunda");
    expect(frame).toContain("10+5 token");
  });

  it("agent.run.failed → hata kodunu gösterir", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" />);
    await tick();
    stdin.write("imkansız görev");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.run.failed", {
      runId: RUN_ID,
      error: { code: "AGENT_MAX_STEPS", message: "adım sınırı aşıldı" },
    });
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("koşu başarısız: AGENT_MAX_STEPS");
    expect(frame).toContain("adım sınırı aşıldı");
  });

  it("agent.start reddedilirse (örn. AGENT_UNKNOWN) hata satırı gösterir", async () => {
    const fake = fakeClient(false);
    const { stdin, lastFrame } = render(<AgentRun client={fake.client} agentId="yok-boyle" cwd="/ws" />);
    await tick();
    stdin.write("görev");
    await tick();
    stdin.write("\r");
    await tick();

    expect(lastFrame()).toContain("AGENT_UNKNOWN");
  });
});
