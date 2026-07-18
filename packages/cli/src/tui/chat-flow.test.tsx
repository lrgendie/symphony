import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type {
  HistorySessionDetailResponse,
  HistorySessionSummary,
  ModelInfo,
  Usage,
} from "@lrgendie/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import { ChatFlow } from "./app.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
const DOWN = String.fromCharCode(27, 91, 66); // aşağı ok: ESC [ B
const model: ModelInfo = { provider: "ollama", id: "qwen3:8b", local: true };

const lastSession: HistorySessionSummary = {
  sessionId: "11111111-1111-4111-8111-111111111111",
  provider: "ollama",
  model: "qwen3:8b",
  title: "eski konu",
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

interface ChatCall {
  sessionId?: string;
  messages?: Array<{ role: string; content: string }>;
}

/** sessionDetail + chat'i yakalayan sahte istemci. */
function fakeClient(
  chatCalls: ChatCall[],
  sessionDetail: () => Promise<HistorySessionDetailResponse | null> = () => Promise.resolve(detail),
): DaemonClient {
  const usage: Usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
  return {
    sessionDetail,
    chat: (params: ChatCall, onDelta: (text: string) => void): Promise<Usage> => {
      chatCalls.push(params);
      onDelta("yeni cevap");
      return Promise.resolve(usage);
    },
  } as unknown as DaemonClient;
}

describe("ChatFlow — oturum sürekliliği", () => {
  it("devam seçilince eski mesajlar render + yeni mesaj ESKİ sessionId ile gönderilir", async () => {
    const chatCalls: ChatCall[] = [];
    const { stdin, lastFrame } = render(
      <ChatFlow client={fakeClient(chatCalls)} models={[model]} lastSession={lastSession} />,
    );
    await tick();
    stdin.write(DOWN); // "önceki sohbete devam et"e in
    await tick();
    stdin.write("\r"); // seç
    await tick();
    await tick(); // sessionDetail çözülsün → Chat tohumlansın
    await tick();

    expect(lastFrame()).toContain("eski soru");
    expect(lastFrame()).toContain("eski cevap");

    stdin.write("bugün nasıl");
    await tick();
    stdin.write("\r");
    await tick();

    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0]?.sessionId).toBe(lastSession.sessionId);
    // Bağlam yeniden gönderilir: 2 eski + 1 yeni kullanıcı mesajı.
    expect(chatCalls[0]?.messages).toHaveLength(3);
    expect(chatCalls[0]?.messages?.[0]).toEqual({ role: "user", content: "eski soru" });
    expect(chatCalls[0]?.messages?.[2]).toEqual({ role: "user", content: "bugün nasıl" });
  });

  it("yeni sohbet seçilince model seçtirir ve YENİ sessionId üretir", async () => {
    const chatCalls: ChatCall[] = [];
    const { stdin, lastFrame } = render(
      <ChatFlow client={fakeClient(chatCalls)} models={[model]} lastSession={lastSession} />,
    );
    await tick();
    stdin.write("\r"); // varsayılan "Yeni sohbet"
    await tick();
    expect(lastFrame()).toContain("Model seç");
    stdin.write("\r"); // tek modeli seç
    await tick();

    stdin.write("selam");
    await tick();
    stdin.write("\r");
    await tick();

    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0]?.sessionId).not.toBe(lastSession.sessionId);
    expect(chatCalls[0]?.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("kayıtlı sohbet yoksa doğrudan model seçiciye gider", async () => {
    const { lastFrame } = render(
      <ChatFlow client={fakeClient([])} models={[model]} lastSession={null} />,
    );
    await tick();
    expect(lastFrame()).toContain("Model seç");
    expect(lastFrame()).not.toContain("devam et");
  });
});
