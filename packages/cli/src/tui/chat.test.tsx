import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { ModelInfo, Usage } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import { Chat } from "./chat.js";

const model: ModelInfo = { provider: "ollama", id: "qwen3:8b", local: true };
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

interface ChatCall {
  sessionId?: string;
  messages?: Array<{ role: string; content: string }>;
}

/** client.chat'i yakalayan sahte istemci: her tura anında sabit cevap verir. */
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

describe("Chat TUI oturum kimliği", () => {
  it("turlar arasında AYNI sessionId gönderilir (geçmiş tek oturumda birikir)", async () => {
    const calls: ChatCall[] = [];
    const { stdin } = render(<Chat client={fakeClient(calls)} model={model} />);
    await tick();

    stdin.write("merhaba");
    await tick();
    stdin.write("\r");
    await tick();
    await tick(); // chat promise'i çözülsün

    stdin.write("nasılsın");
    await tick();
    stdin.write("\r");
    await tick();

    expect(calls).toHaveLength(2);
    const first = calls[0]?.sessionId;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(calls[1]?.sessionId).toBe(first);
  });

  it("initialSessionId + initialHistory ile eski oturum sürdürülür (dilim: oturum sürekliliği)", async () => {
    const calls: ChatCall[] = [];
    const oldId = "1f0a2b3c-4d5e-4f60-8a7b-9c0d1e2f3a4b";
    const { stdin, lastFrame } = render(
      <Chat
        client={fakeClient(calls)}
        model={model}
        initialSessionId={oldId}
        initialHistory={[
          { role: "user", content: "adım Deniz" },
          { role: "assistant", content: "Memnun oldum Deniz" },
        ]}
      />,
    );
    await tick();

    // Eski turlar açılışta ekranda
    expect(lastFrame()).toContain("adım Deniz");
    expect(lastFrame()).toContain("Memnun oldum Deniz");

    stdin.write("adımı hatırlıyor musun?");
    await tick();
    stdin.write("\r");
    await tick();

    // Yeni tur ESKİ sessionId ile gider ve model bağlamı eski mesajları içerir
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sessionId).toBe(oldId);
    expect(calls[0]?.messages?.map((m) => m.content)).toEqual([
      "adım Deniz",
      "Memnun oldum Deniz",
      "adımı hatırlıyor musun?",
    ]);
  });
});
