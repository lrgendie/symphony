import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { ModelInfo } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import { AgentRun } from "./agent-run.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const RUN_ID = "11111111-1111-4111-8111-111111111111";

const models: ModelInfo[] = [
  { provider: "anthropic", id: "claude-sonnet-5", local: false },
  { provider: "ollama", id: "qwen3:8b", local: true },
];

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

type Stdin = ReturnType<typeof render>["stdin"];

/** cwd ekranında varsayılanı kabul eder, model ekranında "Router seçsin"i seçer. */
async function skipCwdAndModel(stdin: Stdin): Promise<void> {
  await tick();
  stdin.write("\r"); // cwd: varsayılanı kabul et
  await tick();
  stdin.write("\r"); // model: Router seçsin (ilk seçenek)
  await tick();
}

describe("AgentRun — çalışma dizini ve model adımları", () => {
  it("önce cwd, sonra model, sonra görev sorar (bu sıra)", async () => {
    const fake = fakeClient();
    const { lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await tick();
    expect(lastFrame()).toContain("Çalışma dizini");
  });

  it("cwd ekranında Enter, verilen varsayılan cwd'yi kullanır", async () => {
    const fake = fakeClient();
    const { stdin } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws/varsayilan" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
    stdin.write("görev");
    await tick();
    stdin.write("\r");
    await tick();
    expect(fake.requests[0]?.payload).toMatchObject({ cwd: "/ws/varsayilan" });
  });

  it("model ekranında ↓+Enter belirli bir modeli seçer, request'e provider/model eklenir", async () => {
    const fake = fakeClient();
    const { stdin } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />);
    await tick();
    stdin.write("\r"); // cwd varsayılan
    await tick();
    stdin.write("[B"); // aşağı ok: ilk gerçek model (claude-sonnet-5)
    await tick();
    stdin.write("\r");
    await tick();
    stdin.write("görev");
    await tick();
    stdin.write("\r");
    await tick();
    expect(fake.requests[0]?.payload).toMatchObject({ provider: "anthropic", model: "claude-sonnet-5" });
  });

  it("Router seçilirse request'te provider/model alanı OLMAZ", async () => {
    const fake = fakeClient();
    const { stdin } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />);
    await skipCwdAndModel(stdin);
    stdin.write("görev");
    await tick();
    stdin.write("\r");
    await tick();
    expect(fake.requests[0]?.payload).not.toHaveProperty("provider");
    expect(fake.requests[0]?.payload).not.toHaveProperty("model");
  });
});

describe("AgentRun (TUI agent modu — görev ve sonrası)", () => {
  it("görev girilip Enter'a basılınca agent.start gönderir", async () => {
    const fake = fakeClient();
    const { stdin } = render(<AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />);
    await skipCwdAndModel(stdin);
    stdin.write("bug'ı düzelt");
    await tick();
    stdin.write("\r");
    await tick();
    expect(fake.requests).toHaveLength(1);
    expect(fake.requests[0]).toEqual({
      type: "agent.start",
      // conversational (ADR-012, dilim 2.2): TUI koşuları konuşmalı başlar.
      payload: { agentId: "coder", task: "bug'ı düzelt", cwd: "/ws", conversational: true },
    });
  });

  it("awaiting_user'da devam girişi gösterir; gönderim agent.say'i AYNI runId ile atar", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
    stdin.write("dosyaları listele");
    await tick();
    stdin.write("\r");
    await tick();

    // İlk tur: akış metni gelir, sonra koşu kullanıcıya park eder.
    fake.emit("agent.delta", { runId: RUN_ID, text: "5 dosya buldum" });
    fake.emit("agent.run.state", { runId: RUN_ID, state: "awaiting_user" });
    // Dış olayla (stdin dışı) tetiklenen render'da yeni TextInput'un input aboneliği
    // tek tick'te oturmuyor — ek tick'ler effect'lerin bağlanmasını garantiler.
    await tick();
    await tick();
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("5 dosya buldum"); // agent cevabı ekranda kalır
    expect(frame).toContain("devam yaz"); // devam girişi açık

    stdin.write("ilkini oku");
    await tick();
    stdin.write("\r");
    await tick();

    const say = fake.requests.find((r) => r.type === "agent.say");
    expect(say?.payload).toEqual({ runId: RUN_ID, text: "ilkini oku" });
    // Biten tur dökümde kalır; koşu bitmediği için outcome yok.
    expect(lastFrame()).toContain("🤖 5 dosya buldum");
    expect(lastFrame()).not.toContain("koşu tamamlandı");
  });

  it("agent.tool.requested → izin kutusu render eder (risk sınıfı + diff renkli)", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
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
    expect(frame).toContain("[b]u koşu boyunca");
    expect(frame).toContain("[d]aima izin ver");
  });

  it("'b' tuşu → permission.respond allow_for_run gönderir, kutu kapanır", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
    stdin.write("dosya yaz");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.tool.requested", {
      runId: RUN_ID,
      requestId: "req-b",
      tool: "write_file",
      args: {},
      riskClass: "mutating",
    });
    await tick();

    stdin.write("b");
    await tick();

    const respond = fake.requests.find((r) => r.type === "permission.respond");
    expect(respond?.payload).toEqual({ requestId: "req-b", decision: "allow_for_run" });
    expect(lastFrame()).not.toContain("izin isteği");
  });

  it("'e' tuşu → permission.respond allow gönderir, kutu kapanır", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
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

  it("destructive risk sınıfında 'daima'/'bu koşu boyunca' seçenekleri sunulmaz", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
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
    expect(lastFrame()).not.toContain("bu koşu boyunca");

    stdin.write("d"); // her ihtimale karşı: destructive'de 'd' hiçbir şey yapmamalı
    await tick();
    stdin.write("b"); // ve 'b' de hiçbir şey yapmamalı
    await tick();
    expect(fake.requests.some((r) => r.type === "permission.respond")).toBe(false);

    stdin.write("h");
    await tick();
    const respond = fake.requests.find((r) => r.type === "permission.respond");
    expect(respond?.payload).toEqual({ requestId: "req-destructive", decision: "deny" });
  });

  it("agent.delta → akışlı asistan metnini gösterir; araç başlayınca sıfırlanır (ADR-012)", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
    stdin.write("selam ver");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.delta", { runId: RUN_ID, text: "Merhaba " });
    fake.emit("agent.delta", { runId: RUN_ID, text: "dünya" });
    await tick();
    expect(lastFrame()).toContain("Merhaba dünya");

    // Araç başlayınca önceki turun metni temizlenir (yeni tur taze akar).
    fake.emit("agent.tool.started", { runId: RUN_ID, tool: "read_file", argsSummary: "a.txt" });
    await tick();
    expect(lastFrame()).not.toContain("Merhaba dünya");
  });

  it("agent.run.completed → sonuç ve token/maliyet satırını gösterir", async () => {
    const fake = fakeClient();
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
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
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="coder" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
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
    const { stdin, lastFrame } = render(
      <AgentRun client={fake.client} agentId="yok-boyle" cwd="/ws" models={models} onExit={() => {}} />,
    );
    await skipCwdAndModel(stdin);
    stdin.write("görev");
    await tick();
    stdin.write("\r");
    await tick();

    expect(lastFrame()).toContain("AGENT_UNKNOWN");
  });

  it("koşu bitince Enter → yeni göreve döner (TUI kapanmaz, tek-seferlik değil)", async () => {
    const fake = fakeClient();
    let exited = false;
    const { stdin, lastFrame } = render(
      <AgentRun
        client={fake.client}
        agentId="coder"
        cwd="/ws"
        models={models}
        onExit={() => {
          exited = true;
        }}
      />,
    );
    await skipCwdAndModel(stdin);
    stdin.write("ilk görev");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.run.completed", {
      runId: RUN_ID,
      result: "bitti",
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    });
    await tick();
    expect(lastFrame()).toContain("Enter: yeni görev");

    stdin.write("\r"); // Enter → yeni görev
    await tick();
    expect(lastFrame()).toContain("Görev nedir?");
    expect(exited).toBe(false);
  });

  it("koşu bitince Esc → onExit çağrılır (ana menüye dönüş)", async () => {
    const fake = fakeClient();
    let exited = false;
    const { stdin } = render(
      <AgentRun
        client={fake.client}
        agentId="coder"
        cwd="/ws"
        models={models}
        onExit={() => {
          exited = true;
        }}
      />,
    );
    await skipCwdAndModel(stdin);
    stdin.write("görev");
    await tick();
    stdin.write("\r");
    await tick();

    fake.emit("agent.run.completed", {
      runId: RUN_ID,
      result: "ok",
      usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 },
    });
    await tick();

    stdin.write(""); // Esc → ana menü (lone ESC)
    await new Promise((resolve) => setTimeout(resolve, 20)); // ink lone-ESC debounce'unu bekle
    expect(exited).toBe(true);
  });
});
