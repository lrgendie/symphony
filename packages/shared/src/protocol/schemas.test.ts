import { describe, expect, it } from "vitest";
import { ChatStartPayloadSchema } from "./requests.js";
import { AgentToolRequestedPayloadSchema } from "./events.js";
import { ErrorPayloadSchema } from "./common.js";

const uuid = () => crypto.randomUUID();

describe("chat.start", () => {
  it("temperature verilmezse 0 varsayılır — ADR-008 şemada zorlanır", () => {
    const parsed = ChatStartPayloadSchema.parse({
      provider: "anthropic",
      model: "claude-sonnet-5",
      messages: [{ role: "user", content: "merhaba" }],
    });
    expect(parsed.options.temperature).toBe(0);
  });

  it("bilinçli istisna mümkündür", () => {
    const parsed = ChatStartPayloadSchema.parse({
      provider: "ollama",
      model: "llama3.1:8b",
      messages: [{ role: "user", content: "bir şiir yaz" }],
      options: { temperature: 0.7 },
    });
    expect(parsed.options.temperature).toBe(0.7);
  });

  it("boş mesaj listesi reddedilir", () => {
    expect(() =>
      ChatStartPayloadSchema.parse({ provider: "x", model: "y", messages: [] }),
    ).toThrow();
  });
});

describe("agent.tool.requested", () => {
  it("riskClass zorunludur", () => {
    expect(() =>
      AgentToolRequestedPayloadSchema.parse({
        runId: uuid(),
        requestId: uuid(),
        tool: "write_file",
        args: { path: "a.txt" },
      }),
    ).toThrow();
  });

  it("diff'li dosya yazma isteği geçerlidir", () => {
    const parsed = AgentToolRequestedPayloadSchema.parse({
      runId: uuid(),
      requestId: uuid(),
      tool: "write_file",
      args: { path: "a.txt" },
      riskClass: "mutating",
      diff: "--- a/a.txt\n+++ b/a.txt\n",
    });
    expect(parsed.riskClass).toBe("mutating");
  });
});

describe("hata kod uzayı (PROTOKOL §2)", () => {
  it("tanımlı önekler kabul edilir", () => {
    for (const code of ["AUTH_TOKEN_INVALID", "PERMISSION_JAIL", "AGENT_MAX_STEPS"]) {
      expect(ErrorPayloadSchema.safeParse({ code, message: "x" }).success).toBe(true);
    }
  });

  it("uzay dışı kodlar reddedilir", () => {
    for (const code of ["OOPS_BAD", "auth_lower", "AUTH-TIRE"]) {
      expect(ErrorPayloadSchema.safeParse({ code, message: "x" }).success).toBe(false);
    }
  });
});
