import { describe, expect, it } from "vitest";
import { render } from "ink-testing-library";
import type { ModelInfo, Usage } from "@symphony/shared";
import type { DaemonClient } from "../client/daemon-client.js";
import { Chat } from "./chat.js";

const model: ModelInfo = { provider: "ollama", id: "qwen3:8b", local: true };
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** client.chat'i yakalayan sahte istemci: her tura anında sabit cevap verir. */
function fakeClient(
  calls: Array<{ sessionId?: string }>,
  requests: Array<{ type: string; payload: unknown }> = [],
  requestImpl?: (type: string, payload: unknown) => Promise<unknown>,
): DaemonClient {
  const usage: Usage = { inputTokens: 1, outputTokens: 1, costUsd: 0 };
  return {
    chat: (params: { sessionId?: string }, onDelta: (text: string) => void): Promise<Usage> => {
      calls.push(params);
      onDelta("Merhaba");
      return Promise.resolve(usage);
    },
    request: (type: string, payload: unknown) => {
      requests.push({ type, payload });
      return requestImpl !== undefined ? requestImpl(type, payload) : Promise.resolve({ nodeId: "n1" });
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

describe("Chat TUI /harita (ADR-019 Karar 6, Dilim H4)", () => {
  it("/harita girilince modele GÖNDERİLMEZ — map.pin{ref:session} atılır, onay satırı basılır", async () => {
    const calls: Array<{ sessionId?: string }> = [];
    const requests: Array<{ type: string; payload: unknown }> = [];
    const { stdin, lastFrame } = render(<Chat client={fakeClient(calls, requests)} model={model} />);
    await tick();

    stdin.write("/harita");
    await tick();
    stdin.write("\r");
    await tick();

    expect(calls).toHaveLength(0); // client.chat HİÇ çağrılmadı
    expect(requests).toHaveLength(1);
    expect(requests[0]?.type).toBe("map.pin");
    expect(requests[0]?.payload).toMatchObject({ ref: { kind: "session" } });
    expect(lastFrame()).toContain("Haritaya sabitlendi");
  });

  it("/harita <başlık> ile açık başlık title alanına geçer", async () => {
    const calls: Array<{ sessionId?: string }> = [];
    const requests: Array<{ type: string; payload: unknown }> = [];
    const { stdin, lastFrame } = render(<Chat client={fakeClient(calls, requests)} model={model} />);
    await tick();

    stdin.write("/harita tasarım kararı");
    await tick();
    stdin.write("\r");
    await tick();

    expect(requests[0]?.payload).toMatchObject({ title: "tasarım kararı" });
    expect(lastFrame()).toContain('"tasarım kararı"');
  });

  it("map.pin reddedilirse hata satırı gösterir (örn. henüz hiç mesaj yok → REF_UNKNOWN)", async () => {
    const calls: Array<{ sessionId?: string }> = [];
    const requests: Array<{ type: string; payload: unknown }> = [];
    const { stdin, lastFrame } = render(
      <Chat
        client={fakeClient(calls, requests, () => Promise.reject(new Error("Bilinmeyen referans")))}
        model={model}
      />,
    );
    await tick();

    stdin.write("/harita");
    await tick();
    stdin.write("\r");
    await tick();

    expect(lastFrame()).toContain("Haritaya sabitlenemedi");
  });

  it("/haritalamaya (tam eşleşme değil) NORMAL mesaj olarak modele gönderilir", async () => {
    const calls: Array<{ sessionId?: string }> = [];
    const requests: Array<{ type: string; payload: unknown }> = [];
    const { stdin } = render(<Chat client={fakeClient(calls, requests)} model={model} />);
    await tick();

    stdin.write("/haritalamaya devam edelim");
    await tick();
    stdin.write("\r");
    await tick();

    expect(calls).toHaveLength(1); // model'e gitti
    expect(requests).toHaveLength(0); // map.pin ÇAĞRILMADI
  });
});
