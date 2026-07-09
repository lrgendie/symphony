import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { HistorySessionDetailResponse, HistorySessionSummary, ModelInfo } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import { AgentFlow } from "./app.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const DOWN = String.fromCharCode(27, 91, 66); // aşağı ok
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const model: ModelInfo = { provider: "ollama", id: "qwen3:8b", local: true };

const lastSession: HistorySessionSummary = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  provider: "ollama",
  model: "qwen3:8b",
  title: "eski konuşma",
  createdAt: 1,
  updatedAt: 2,
  messageCount: 2,
};

const detail: HistorySessionDetailResponse = {
  session: lastSession,
  messages: [
    { role: "user", content: "eski soru", at: 1 },
    { role: "assistant", content: "eski cevap", at: 2 },
  ],
};

interface StartCall {
  type: string;
  payload: { sessionId?: string; conversational?: boolean; cwd?: string };
}

/** on/request + sessionDetail taklit eden sahte istemci (agent.start'ı yakalar). */
function fakeClient(calls: StartCall[]): DaemonClient {
  return {
    sessionDetail: () => Promise.resolve(detail),
    on: () => () => undefined,
    request: (type: string, payload: StartCall["payload"]) => {
      calls.push({ type, payload });
      if (type === "agent.start") {
        return Promise.resolve({ runId: RUN_ID, sessionId: lastSession.sessionId });
      }
      return Promise.resolve({});
    },
  } as unknown as DaemonClient;
}

describe("AgentFlow — agent konuşması resume (Dilim 2.3c)", () => {
  it("devam seçilince: eski konuşma ekranda + agent.start ESKİ sessionId ile (model sabit)", async () => {
    const calls: StartCall[] = [];
    const { stdin, lastFrame } = render(
      <AgentFlow client={fakeClient(calls)} agentId="coder" cwd="/ws" models={[model]} lastSession={lastSession} onExit={() => {}} />,
    );
    await tick();
    stdin.write(DOWN); // "önceki sohbete devam et"e in
    await tick();
    stdin.write("\r"); // devam seç
    await tick();
    await tick(); // sessionDetail çözülsün → run stage
    await tick();

    // Resume'da model sabit → model seçici ATLANIR; doğrudan cwd sorulur.
    stdin.write("\r"); // cwd varsayılanı kabul et
    await tick();
    stdin.write("adımı hatırlıyor musun"); // "görev" = bir sonraki mesaj
    await tick();
    stdin.write("\r");
    await tick();
    await tick();

    const start = calls.find((c) => c.type === "agent.start");
    expect(start?.payload.sessionId).toBe(lastSession.sessionId); // AYNI oturuma devam
    expect(start?.payload.conversational).toBe(true);
    // Eski konuşma ekrana tohumlandı.
    expect(lastFrame()).toContain("eski soru");
    expect(lastFrame()).toContain("eski cevap");
  });

  it("yeni seçilince: agent.start sessionId'SİZ (temiz konuşma) + model seçici gelir", async () => {
    const calls: StartCall[] = [];
    const { stdin, lastFrame } = render(
      <AgentFlow client={fakeClient(calls)} agentId="coder" cwd="/ws" models={[model]} lastSession={lastSession} onExit={() => {}} />,
    );
    await tick();
    stdin.write("\r"); // varsayılan "Yeni sohbet"
    await tick();

    // Yeni → model sabit DEĞİL → cwd sonrası model seçici gelir.
    stdin.write("\r"); // cwd varsayılan
    await tick();
    expect(lastFrame()).toContain("Hangi model?");
    stdin.write("\r"); // router/ilk seçenek
    await tick();
    stdin.write("selam");
    await tick();
    stdin.write("\r");
    await tick();
    await tick();

    const start = calls.find((c) => c.type === "agent.start");
    expect(start?.payload.sessionId).toBeUndefined(); // temiz başlangıç
    expect(start?.payload.conversational).toBe(true);
  });

  it("kayıtlı konuşma yoksa doğrudan AgentRun (cwd sorusu), resume seçici YOK", async () => {
    const { lastFrame } = render(
      <AgentFlow client={fakeClient([])} agentId="coder" cwd="/ws" models={[model]} lastSession={null} onExit={() => {}} />,
    );
    await tick();
    expect(lastFrame()).toContain("Çalışma dizini");
    expect(lastFrame()).not.toContain("devam et");
  });
});
