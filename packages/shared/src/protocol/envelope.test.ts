import { describe, expect, it } from "vitest";
import { createMessage, parseMessage } from "./envelope.js";
import { PROTOCOL_VERSION } from "./constants.js";

const uuid = () => crypto.randomUUID();

describe("zarf (envelope)", () => {
  it("geçerli bir hello mesajını ayrıştırır", () => {
    const result = parseMessage({
      id: uuid(),
      type: "hello",
      ts: Date.now(),
      replyTo: null,
      payload: { token: "gizli", client: "cli", protocolVersion: PROTOCOL_VERSION },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("hello");
    }
  });

  it("replyTo verilmezse null varsayılır", () => {
    const result = parseMessage({
      id: uuid(),
      type: "state.sync",
      ts: Date.now(),
      payload: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message.replyTo).toBeNull();
  });

  it("bilinmeyen mesaj tipini VALIDATION_UNKNOWN_TYPE ile reddeder", () => {
    const result = parseMessage({
      id: uuid(),
      type: "boyle.bir.mesaj.yok",
      ts: Date.now(),
      payload: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_UNKNOWN_TYPE");
  });

  it("şemaya uymayan payload'ı VALIDATION_PAYLOAD ile reddeder", () => {
    const result = parseMessage({
      id: uuid(),
      type: "hello",
      ts: Date.now(),
      payload: { client: "cli" }, // token ve protocolVersion eksik
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_PAYLOAD");
  });

  it("zarf bozuksa VALIDATION_ENVELOPE döner", () => {
    const result = parseMessage({ type: "hello" }); // id/ts yok
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("VALIDATION_ENVELOPE");
  });

  it("bilinmeyen fazla alanları sessizce atar (ileri uyumluluk, PROTOKOL §7)", () => {
    const result = parseMessage({
      id: uuid(),
      type: "chat.cancel",
      ts: Date.now(),
      payload: { sessionId: uuid(), gelecektenGelenAlan: 42 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.payload).not.toHaveProperty("gelecektenGelenAlan");
    }
  });

  it("createMessage geçerli zarf üretir ve kendi çıktısı parse edilebilir", () => {
    const msg = createMessage("agent.cancel", { runId: uuid() });
    expect(msg.id).toMatch(/^[0-9a-f-]{36}$/);
    const parsed = parseMessage(msg);
    expect(parsed.ok).toBe(true);
  });

  it("createMessage şemaya uymayan payload'da fırlatır (garbage-out önlemi)", () => {
    expect(() =>
      // @ts-expect-error — bilinçli hatalı payload
      createMessage("agent.cancel", { runId: "uuid-degil" }),
    ).toThrow();
  });
});
