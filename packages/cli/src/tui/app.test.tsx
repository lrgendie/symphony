import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { HistorySessionDetailResponse, ModelInfo, Usage } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import { App } from "./app.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const DOWN = "[B";

const model: ModelInfo = { provider: "ollama", id: "qwen3:8b", local: true };
const totals: Usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
const SESSION_ID = "1f0a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";

const lastSession: HistorySessionDetailResponse = {
  session: {
    sessionId: SESSION_ID,
    provider: "ollama",
    model: "qwen3:8b",
    title: "adım Deniz",
    createdAt: 1,
    updatedAt: 2,
    messageCount: 2,
  },
  messages: [
    { role: "user", content: "adım Deniz", at: 1 },
    { role: "assistant", content: "Memnun oldum Deniz", at: 1 },
  ],
};

interface ChatCall {
  sessionId?: string;
  messages?: Array<{ role: string; content: string }>;
}

function fakeClient(calls: ChatCall[]): DaemonClient {
  const usage: Usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
  return {
    chat: (params: ChatCall, onDelta: (text: string) => void): Promise<Usage> => {
      calls.push(params);
      onDelta("Merhaba");
      return Promise.resolve(usage);
    },
  } as unknown as DaemonClient;
}

function renderApp(calls: ChatCall[], last: HistorySessionDetailResponse | null) {
  return render(
    <App
      client={fakeClient(calls)}
      models={[model]}
      agents={[]}
      providers={[]}
      totals={totals}
      cwd="."
      lastSession={last}
    />,
  );
}

describe("App — oturum sürekliliği akışı", () => {
  it("«önceki sohbete devam» → eski mesajlar görünür, yeni tur ESKİ sessionId ile gider", async () => {
    const calls: ChatCall[] = [];
    const { stdin, lastFrame } = renderApp(calls, lastSession);
    await tick();

    stdin.write("\r"); // mod: Sohbet
    await tick();
    expect(lastFrame()).toContain("Önceki sohbete devam et");
    expect(lastFrame()).toContain("adım Deniz"); // başlık ipucunda

    stdin.write("\r"); // ilk seçenek: devam et → model otomatik çözülür (listede var)
    await tick();
    expect(lastFrame()).toContain("Memnun oldum Deniz"); // eski turlar ekranda

    stdin.write("adımı hatırlıyor musun?");
    await tick();
    stdin.write("\r");
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionId).toBe(SESSION_ID);
    expect(calls[0]?.messages?.map((m) => m.content)).toEqual([
      "adım Deniz",
      "Memnun oldum Deniz",
      "adımı hatırlıyor musun?",
    ]);
  });

  it("«yeni sohbet» → model seçici gelir, tur YENİ sessionId ile gider", async () => {
    const calls: ChatCall[] = [];
    const { stdin, lastFrame } = renderApp(calls, lastSession);
    await tick();

    stdin.write("\r"); // mod: Sohbet
    await tick();
    stdin.write(DOWN); // Yeni sohbet
    await tick();
    stdin.write("\r");
    await tick();
    expect(lastFrame()).not.toContain("Memnun oldum Deniz"); // eski geçmiş tohumlanmadı

    stdin.write("\r"); // model seç (tek model)
    await tick();
    stdin.write("selam");
    await tick();
    stdin.write("\r");
    await tick();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[0]?.sessionId).not.toBe(SESSION_ID);
    expect(calls[0]?.messages?.map((m) => m.content)).toEqual(["selam"]);
  });

  it("kayıtlı sohbet yoksa seçim adımı atlanır (doğrudan model seçici)", async () => {
    const calls: ChatCall[] = [];
    const { stdin, lastFrame } = renderApp(calls, null);
    await tick();

    stdin.write("\r"); // mod: Sohbet
    await tick();
    expect(lastFrame()).not.toContain("Önceki sohbete devam et");
    expect(lastFrame()).toContain("qwen3:8b"); // model seçici listesi
  });
});
