import { describe, expect, it } from "vitest";
import {
  AGENT_RUN_STATES,
  TERMINAL_STATES,
  VALID_TRANSITIONS,
  canTransition,
  isTerminalState,
} from "./agent-state.js";

describe("agent durum makinesi (PROTOKOL §5)", () => {
  it("mutlu yol geçişleri geçerlidir", () => {
    expect(canTransition("queued", "thinking")).toBe(true);
    expect(canTransition("thinking", "awaiting_permission")).toBe(true);
    expect(canTransition("awaiting_permission", "executing_tool")).toBe(true);
    expect(canTransition("executing_tool", "thinking")).toBe(true);
    expect(canTransition("thinking", "completed")).toBe(true);
  });

  it("izin reddi modeli düşünmeye geri döndürür (SPEC-AGENT §5)", () => {
    expect(canTransition("awaiting_permission", "thinking")).toBe(true);
  });

  it("her durumdan iptal mümkündür (terminal olmayanlardan)", () => {
    for (const state of AGENT_RUN_STATES) {
      if (!isTerminalState(state)) {
        expect(canTransition(state, "cancelled"), `${state} → cancelled`).toBe(true);
      }
    }
  });

  it("geçersiz geçişler reddedilir", () => {
    expect(canTransition("queued", "executing_tool")).toBe(false);
    expect(canTransition("queued", "completed")).toBe(false);
    expect(canTransition("awaiting_permission", "completed")).toBe(false);
  });

  it("terminal durumlardan çıkış yoktur", () => {
    for (const state of TERMINAL_STATES) {
      expect(VALID_TRANSITIONS[state]).toHaveLength(0);
    }
  });

  it("tüm durumların geçiş tanımı vardır (unutulan durum yok)", () => {
    for (const state of AGENT_RUN_STATES) {
      expect(VALID_TRANSITIONS[state]).toBeDefined();
    }
  });
});
