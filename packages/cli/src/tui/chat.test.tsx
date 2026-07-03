import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { ModelInfo, Usage } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import { Chat } from "./chat.js";

const model: ModelInfo = { provider: "ollama", id: "qwen3:8b", local: true };
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** client.chat'i yakalayan sahte istemci: her tura anında sabit cevap verir. */
function fakeClient(calls: Array<{ sessionId?: string }>): DaemonClient {
  const usage: Usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
  return {
    chat: (params: { sessionId?: string }, onDelta: (text: string) => void): Promise<Usage> => {
      calls.push(params);
      onDelta("Merhaba");
      return Promise.resolve(usage);
    },
  } as unknown as DaemonClient;
}

describe("Chat TUI oturum kimliği", () => {
  it("turlar arasında AYNI sessionId gönderilir (geçmiş tek oturumda birikir)", async () => {
    const calls: Array<{ sessionId?: string }> = [];
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
});
